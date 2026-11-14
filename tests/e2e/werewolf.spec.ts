import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  activate,
  baseURL,
  bootstrapHost,
  expectNoHorizontalOverflow,
  invite,
  newClient,
  shareSession,
  type Guest,
} from "./support/party";
import { acceptConfirmation } from "./support/confirm";
import {
  expectSavedAnnouncement,
  openSettingsSection,
} from "./support/settings";
import {
  createWerewolf,
  dayPaint,
  gameFrom,
  givePortrait,
  joinGame,
  nightPaint,
  paint,
  roleName,
  rootTransition,
  sendToGame,
  setGameMaster,
  type Werewolf,
  type WerewolfEvent,
} from "./support/werewolf";

let host: APIRequestContext;
const eventIDs: number[] = [];
const contexts: BrowserContext[] = [];
const clients: APIRequestContext[] = [];

const phone = { width: 390, height: 844 };

test.use({ viewport: phone, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Werewolf Test Host");
});

test.afterEach(async ({ page }) => {
  // Deleting a game sends every page still showing it back to the programme.
  // Closing a browser context in the middle of that navigation can hang
  // Chrome, so the pages leave before their game goes.
  await page.goto("about:blank");
  for (const context of contexts.splice(0)) await context.close();
  for (const client of clients.splice(0)) await client.dispose();
  for (const id of eventIDs.splice(0)) {
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  }
});

test.afterAll(async () => {
  await host?.dispose();
});

type Participant = { guest: Guest; client: APIRequestContext };

/** Creates a guest with a session; their pages share that session. */
async function participant(name: string): Promise<Participant> {
  const { guest, invitationUrl } = await invite(host, name);
  const client = await newClient();
  clients.push(client);
  await activate(client, invitationUrl);
  return { guest, client };
}

/** Opens a page signed in as someone who already has a session. */
async function pageFor(
  browser: Browser,
  client: APIRequestContext,
  viewport = phone,
) {
  const context = await browser.newContext({
    baseURL,
    locale: "fr-CH",
    viewport,
  });
  contexts.push(context);
  await shareSession(context, client);
  return context.newPage();
}

/** A game the game master has started through the API, one role per player. */
async function runningGame(title: string, names: string[]) {
  const master = await participant(`${title} — maître du jeu`);
  const players: Participant[] = [];
  for (const name of names) players.push(await participant(name));
  const event = await createWerewolf(host, {
    title,
    gameMasterId: master.guest.id,
  });
  eventIDs.push(event.id);
  for (const player of players)
    expect((await joinGame(player.client, event.id)).status()).toBe(200);
  const lobby = await gameFrom(master.client, event.id);
  // Four different roles, so a role seen on a page identifies its player.
  const dealtKeys = ["werewolf", "villager", "seer", "witch"];
  const saved = await sendToGame(master.client, event.id, "PUT", "/roles", {
    revision: lobby.revision,
    roles: lobby.roles!.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      count: dealtKeys.slice(0, players.length).includes(role.key ?? "")
        ? 1
        : 0,
    })),
  });
  expect(saved.status()).toBe(200);
  const started = await sendToGame(master.client, event.id, "POST", "/state", {
    revision: ((await saved.json()) as Werewolf).revision,
    action: "start",
  });
  expect(started.status()).toBe(200);
  const dealt: Werewolf = await started.json();
  const roleOf = (guest: Guest) =>
    roleName(dealt.players.find((player) => player.id === guest.id)!.role!);
  return { event, master, players, dealt, roleOf };
}

/** The row of one player in the lists of the game page. */
function row(page: Page, name: string) {
  return page
    .locator(".werewolf-player")
    .filter({ has: page.getByText(name, { exact: true }) });
}

/** The players under one heading: "Joueurs", "En vie" or "Morts". */
function list(page: Page, title: string) {
  return page.getByRole("list", { name: title, exact: true });
}

/** The quantity of a role in the game master's editor. */
function quantity(page: Page, role: string) {
  return page
    .getByRole("group", { name: role, exact: true })
    .locator(".werewolf-quantity");
}

/** Everything a viewer can read on the page, hidden statuses included. */
function pageText(page: Page) {
  return page.locator("body").innerText();
}

/** At the end of the page, the dock must not cover the last control. */
async function expectClearOfDock(page: Page, control: Locator) {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const box = await control.boundingBox();
  const dock = await page.locator(".navigation").boundingBox();
  expect(box && dock && box.y + box.height <= dock.y).toBe(true);
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: test.info().outputPath(name),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
}

const seerText =
  "Chaque nuit, tu découvres le rôle d’un joueur de ton choix. À toi de t’en servir sans te faire repérer.";
const witchText =
  "Tu as deux potions, chacune à usage unique : l’une sauve la victime de la nuit, l’autre élimine un joueur.";

test("the host picks a game master, guests join, and only the game master sets the roles and starts", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const title = "Partie de minuit";
  const master = await participant("Maïa — mène la partie");
  const lou = await participant("Lou — première arrivée");
  const noe = await participant("Noé — deuxième arrivé");
  const zoe = await participant("Zoé — troisième arrivée");
  const tom = await participant("Tom — quatrième arrivé");
  await shareSession(page.context(), lou.client);
  await page.goto("about:blank");
  await givePortrait(page, master.client, 280);
  await givePortrait(page, lou.client, 20);
  await givePortrait(page, zoe.client, 160);

  // The host adds the event from the type chooser and picks the game master.
  const settings = await pageFor(browser, host, { width: 1280, height: 900 });
  await settings.goto("/parametres");
  await openSettingsSection(settings, "programme");
  await settings
    .getByRole("button", { name: "Ajouter un événement", exact: true })
    .click();
  const choice = settings.getByRole("button", { name: /^Loup-garou/ });
  await expect(choice).toContainText(
    "Un rôle secret sur chaque téléphone, et le plateau pour le maître du jeu.",
  );
  await choice.click();
  await expect(settings.locator("#event-title")).toHaveValue("Loup-garou");
  const picker = settings.getByLabel("Maître du jeu", { exact: true });
  await expect(picker).toHaveValue("");
  await expect(picker.locator("option").first()).toHaveText(
    "Personne pour l’instant",
  );
  const created = settings.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/programme") &&
      response.request().method() === "POST",
  );
  await picker.selectOption({ label: master.guest.name });
  const creation = await created;
  expect(creation.status()).toBe(201);
  const event: WerewolfEvent = await creation.json();
  eventIDs.push(event.id);
  expect(event.type).toBe("werewolf");
  expect(event.werewolf).toMatchObject({
    status: "lobby",
    gameMaster: { id: master.guest.id, name: master.guest.name },
    players: 0,
  });
  const renamed = settings.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/admin/programme/${event.id}`) &&
      response.request().method() === "PUT",
  );
  await settings.locator("#event-title").fill(title);
  await settings.getByLabel("Détails", { exact: true }).click();
  expect((await renamed).status()).toBe(200);
  const saved = settings
    .locator(".programme-admin-events > li")
    .filter({ hasText: title });
  await expect(saved).toContainText("Inscriptions ouvertes · 0 joueur");
  await expect(saved).toContainText(`Maître du jeu : ${master.guest.name}`);
  await expect(
    saved.getByRole("link", { name: "Ouvrir la partie", exact: true }),
  ).toBeVisible();
  const gameURL = `/programme/${event.id}`;
  await capture(settings, "werewolf-settings-desktop.png");

  // The Schedule shows the game as a card that leads to its page.
  await page.goto("/programme");
  const card = page.getByRole("article", { name: title, exact: true });
  await expect(
    card.getByText("Inscriptions ouvertes · 0 joueur", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, "werewolf-schedule-card-mobile.png");
  await card
    .getByRole("link", { name: "Ouvrir la partie", exact: true })
    .click();
  await expect(page).toHaveURL(gameURL);
  await expect(
    page.locator('.navigation a[href="/programme"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".werewolf-master")).toContainText(
    master.guest.name,
  );
  await expect(page.locator(".werewolf-master .avatar img")).toBeVisible();
  await expect(
    page.getByText("Aucun joueur pour l’instant.", { exact: true }),
  ).toBeVisible();

  // One main button joins; it then becomes a quieter way out.
  const join = page.getByRole("button", {
    name: "Rejoindre la partie",
    exact: true,
  });
  const leave = page.getByRole("button", {
    name: "Quitter la partie",
    exact: true,
  });
  await expect(join).toHaveClass(/primary/);
  await join.click();
  await expect(leave).toHaveClass(/secondary/);
  await expectSavedAnnouncement(page, "Tu as rejoint la partie.");
  await expect(row(page, lou.guest.name)).toContainText("Toi");
  await leave.click();
  await expect(join).toBeVisible();
  await expect(row(page, lou.guest.name)).toHaveCount(0);
  await join.click();
  await expect(leave).toBeVisible();
  for (const player of [noe, zoe, tom])
    expect((await joinGame(player.client, event.id)).status()).toBe(200);
  await expect(list(page, "Joueurs").locator("li")).toHaveCount(4);

  // A guest who is not the game master has no editor, in the page or the API.
  await expect(
    page.getByRole("heading", { name: "Rôles", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.locator(".werewolf-stepper")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lancer la partie", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Retirer .+ de la partie$/ }),
  ).toHaveCount(0);
  const guestLobby = await gameFrom(page.request, event.id);
  expect(guestLobby).toMatchObject({
    isGameMaster: false,
    joined: true,
    roles: null,
    messages: null,
    myRole: null,
  });
  // Being the party's host does not make anyone the game master.
  for (const client of [page.request, host]) {
    const refused = await sendToGame(client, event.id, "POST", "/state", {
      revision: guestLobby.revision,
      action: "start",
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe("game_master_required");
  }
  await expectNoHorizontalOverflow(page);
  await capture(page, "werewolf-lobby-guest-mobile.png");

  // The game master does not play: players, roles, variants and the start.
  const board = await pageFor(browser, master.client);
  await board.goto(gameURL);
  await expect(
    board.getByRole("heading", { name: "Rôles", exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "Rejoindre la partie", exact: true }),
  ).toHaveCount(0);
  await expect(list(board, "Joueurs").locator("li")).toHaveCount(4);
  await board
    .getByRole("button", {
      name: `Retirer ${tom.guest.name} de la partie`,
      exact: true,
    })
    .click();
  await expect(row(board, tom.guest.name)).toHaveCount(0);
  await expect(row(page, tom.guest.name)).toHaveCount(0);
  expect((await joinGame(tom.client, event.id)).status()).toBe(200);
  await expect(list(board, "Joueurs").locator("li")).toHaveCount(4);

  // A new game deals one werewolf: the line says what is missing.
  const editor = board.locator(".werewolf-roles");
  const countLine = board.locator(".werewolf-count-line");
  const complete = board.getByRole("button", {
    name: "Compléter avec des villageois",
    exact: true,
  });
  const start = board.getByRole("button", {
    name: "Lancer la partie",
    exact: true,
  });
  await expect(quantity(board, "Loup-garou")).toHaveText("1");
  await expect(quantity(board, "Villageois")).toHaveText("0");
  await expect(countLine).toHaveText("1 rôle pour 4 joueurs");
  await expect(start).toBeDisabled();
  await board
    .getByRole("button", { name: "Plus de Voyante", exact: true })
    .click();
  await expect(quantity(board, "Voyante")).toHaveText("1");
  await expect(countLine).toHaveText("2 rôles pour 4 joueurs");
  await complete.click();
  await expect(quantity(board, "Villageois")).toHaveText("2");
  await expect(countLine).toBeHidden();
  await expect(complete).toHaveCount(0);
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(start).toBeEnabled();
  // Nothing confirms the save in view; the quantities are the result.
  await expect(editor.locator(".status-notice")).toHaveText("");
  await expectSavedAnnouncement(editor, "Rôles enregistrés.");

  // A custom role waits for its name, then saves with the rest.
  await board
    .getByRole("button", { name: "Ajouter un rôle", exact: true })
    .click();
  const roleNameField = board.getByLabel("Nom du rôle", { exact: true });
  const explanation = board.getByLabel("Explication", { exact: true });
  await expect(roleNameField).toBeFocused();
  await roleNameField.blur();
  await expect(
    board.getByText("Donne un nom à ce rôle.", { exact: true }),
  ).toBeVisible();
  expect((await gameFrom(master.client, event.id)).roles).toHaveLength(7);
  await roleNameField.fill("Bouffon");
  await explanation.fill("Tu gagnes seul si le village t’élimine.");
  await explanation.blur();
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(
    board.getByText("Donne un nom à ce rôle.", { exact: true }),
  ).toHaveCount(0);
  await expect(quantity(board, "Bouffon")).toHaveText("1");
  await expect(countLine).toHaveText("5 rôles pour 4 joueurs");
  await capture(board, "werewolf-role-fields-mobile.png");
  await expect(complete).toHaveCount(0);
  await expect(start).toBeDisabled();
  await board
    .getByRole("button", { name: "Moins de Villageois", exact: true })
    .click();
  await expect(countLine).toBeHidden();

  // A built-in explanation can be rewritten, and put back.
  await board
    .getByRole("button", { name: "Modifier Voyante", exact: true })
    .click();
  await expect(roleNameField).toHaveCount(0);
  await expect(explanation).toHaveValue(seerText);
  const restore = board.getByRole("button", {
    name: "Revenir au texte d’origine",
    exact: true,
  });
  await expect(restore).toHaveCount(0);
  await explanation.fill("Chaque nuit, tu regardes la carte d’un joueur.");
  await explanation.blur();
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(restore).toBeVisible();
  await board
    .getByRole("button", { name: "Modifier Sorcière", exact: true })
    .click();
  await explanation.fill("Texte provisoire.");
  await explanation.blur();
  await expect(editor).not.toHaveAttribute("data-dirty");
  await restore.click();
  await expect(explanation).toHaveValue(witchText);
  await expect(restore).toHaveCount(0);
  await expect(editor).not.toHaveAttribute("data-dirty");
  await board
    .getByRole("button", { name: "Modifier Sorcière", exact: true })
    .click();
  await expect(explanation).toHaveCount(0);
  // A failed save keeps the draft and offers a retry.
  const rolesURL = `**/api/programme/${event.id}/werewolf/roles`;
  const more = board.getByRole("button", {
    name: "Plus de Garde",
    exact: true,
  });
  const fewer = board.getByRole("button", {
    name: "Moins de Garde",
    exact: true,
  });
  const failure = editor.getByRole("alert");
  let answers: number[] = [503];
  await board.route(rolesURL, async (route) => {
    const status = answers.shift();
    if (status === undefined) return route.continue();
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        code: status === 409 ? "activity_conflict" : "internal_error",
        error: "Test failure",
      }),
    });
  });
  await more.click();
  await expect(failure).toBeVisible();
  await expect(quantity(board, "Garde")).toHaveText("1");
  await expect(editor).toHaveAttribute("data-dirty");
  await editor.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(failure).toHaveCount(0);
  await expect(quantity(board, "Garde")).toHaveText("1");

  // One conflict is a revision that moved: the save reads the game and goes
  // out again, without a message.
  answers = [409];
  await fewer.click();
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(quantity(board, "Garde")).toHaveText("0");
  await expect(failure).toHaveCount(0);
  expect(
    (await gameFrom(master.client, event.id)).roles!.find(
      (role) => role.key === "guard",
    )!.count,
  ).toBe(0);

  // A conflict that stays is the game itself: the saved roles come back.
  answers = [409, 409];
  await more.click();
  await expect(failure).toHaveText(
    "Cette activité a changé. Vérifie son état et réessaie.",
  );
  await expect(editor).not.toHaveAttribute("data-dirty");
  await expect(quantity(board, "Garde")).toHaveText("0");
  await board.unroute(rolesURL);

  const lobby = await gameFrom(master.client, event.id);
  expect(
    lobby.roles!.map((role) => [
      role.key,
      role.name,
      role.description,
      role.count,
    ]),
  ).toEqual([
    ["werewolf", null, null, 1],
    ["villager", null, null, 1],
    ["seer", null, "Chaque nuit, tu regardes la carte d’un joueur.", 1],
    ["witch", null, null, 0],
    ["hunter", null, null, 0],
    ["cupid", null, null, 0],
    ["guard", null, null, 0],
    [null, "Bouffon", "Tu gagnes seul si le village t’élimine.", 1],
  ]);

  await expectNoHorizontalOverflow(board);
  await expectClearOfDock(board, start);
  await capture(board, "werewolf-lobby-master-mobile.png");
  await board.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(board);
  await expectClearOfDock(board, start);
  await capture(board, "werewolf-lobby-master-narrow.png");
  await board.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(board);
  await capture(board, "werewolf-lobby-master-desktop.png");
  await board.setViewportSize(phone);

  // The longest labels still fit a narrow phone: built-in roles follow the
  // viewer's language, authored ones stay as written.
  const germanContext = await browser.newContext({
    baseURL,
    locale: "de-CH",
    viewport: { width: 320, height: 740 },
  });
  contexts.push(germanContext);
  await shareSession(germanContext, master.client);
  const german = await germanContext.newPage();
  await german.goto(gameURL);
  await expect(quantity(german, "Dorfbewohner")).toHaveText("1");
  await expect(quantity(german, "Bouffon")).toHaveText("1");
  await german
    .getByRole("button", { name: "Seherin bearbeiten", exact: true })
    .click();
  await expect(german.getByLabel("Erklärung", { exact: true })).toHaveValue(
    "Chaque nuit, tu regardes la carte d’un joueur.",
  );
  await expectNoHorizontalOverflow(german);
  await capture(german, "werewolf-lobby-master-german-narrow.png");
  await german.close();

  // A game without enough players says so and does not start.
  for (const player of [zoe, tom]) {
    await board
      .getByRole("button", {
        name: `Retirer ${player.guest.name} de la partie`,
        exact: true,
      })
      .click();
    await expect(row(board, player.guest.name)).toHaveCount(0);
  }
  await expect(
    board.getByText("Il faut au moins 3 joueurs.", { exact: true }),
  ).toBeVisible();
  await expect(start).toBeDisabled();
  for (const player of [zoe, tom])
    expect((await joinGame(player.client, event.id)).status()).toBe(200);
  await expect(
    board.getByText("Il faut au moins 3 joueurs.", { exact: true }),
  ).toHaveCount(0);

  // The start deals the roles; the game master is then fixed in settings.
  await expect(picker).toBeEnabled();
  await start.click();
  await expect(
    board.getByText("Partie en cours", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Partie en cours", { exact: true }),
  ).toBeVisible();
  await expect(leave).toHaveCount(0);
  await expect(picker).toBeDisabled();
  await expect(
    settings.getByText(
      "La partie est en cours : le maître du jeu ne peut pas changer.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(saved).toContainText("Partie en cours · 4 joueurs");
  const refused = await setGameMaster(host, event, lou.guest.id);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("activity_conflict");
  const dealt = await gameFrom(master.client, event.id);
  expect(dealt.players.map((player) => roleName(player.role!)).sort()).toEqual([
    "Bouffon",
    "Loup-garou",
    "Villageois",
    "Voyante",
  ]);
  // Nobody joins a game that has started.
  const late = await participant("Eva — arrivée trop tard");
  const tooLate = await joinGame(late.client, event.id);
  expect(tooLate.status()).toBe(409);
  expect((await tooLate.json()).code).toBe("activity_conflict");
});

test("a player sees day or night, their role on request, their own state and the dead, while the game master runs the board", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const { event, master, players, dealt, roleOf } = await runningGame(
    "Veillée du samedi",
    [
      "Lou — joue sur son téléphone",
      "Noé — joue sur le sien",
      "Zoé — joue sans écran",
      "Tom — joue sans écran",
    ],
  );
  const [lou, noe, zoe, tom] = players;
  const onlooker = await participant("Eva — regarde sans jouer");
  const dealtRoles = dealt.players.map((player) => roleName(player.role!));
  expect([...dealtRoles].sort()).toEqual([
    "Loup-garou",
    "Sorcière",
    "Villageois",
    "Voyante",
  ]);
  const gameURL = `/programme/${event.id}`;
  await shareSession(page.context(), lou.client);
  const second = await pageFor(browser, noe.client);

  // A player's response carries their own seat and role, and nobody else.
  for (const player of [lou, noe]) {
    const view = await gameFrom(player.client, event.id);
    expect(view.roles).toBeNull();
    expect(view.messages).toBeNull();
    expect(view.isGameMaster).toBe(false);
    expect(roleName(view.myRole!)).toBe(roleOf(player.guest));
    expect(view.players.map((seat) => seat.id)).toEqual([player.guest.id]);
  }
  expect((await gameFrom(onlooker.client, event.id)).players).toEqual([]);

  for (const [viewer, own] of [
    [page, lou],
    [second, noe],
  ] as const) {
    await viewer.goto(gameURL);
    const reveal = viewer.getByRole("button", {
      name: "Voir mon rôle",
      exact: true,
    });
    // Hidden by default: no role is written anywhere on the page.
    await expect(reveal).toHaveAttribute("aria-expanded", "false");
    await expect(viewer.locator(".werewolf-role-name")).toHaveCount(0);
    // Day or night, and nothing about the others while nobody died.
    await expect(viewer.locator(".werewolf-phase")).toHaveText("Jour");
    await expect(viewer.locator(".werewolf-player")).toHaveCount(0);
    await expect(viewer.locator(".werewolf-master")).toHaveCount(0);
    await expect(viewer.locator(".werewolf-self")).toHaveCount(0);
    const text = await pageText(viewer);
    for (const other of players)
      if (other !== own) expect(text).not.toContain(other.guest.name);
    for (const role of dealtRoles) expect(text).not.toContain(role);
    await expectNoHorizontalOverflow(viewer);
    if (viewer === page) await capture(page, "werewolf-player-day-mobile.png");

    // Shown on demand: the viewer's role, and still nobody else's.
    await reveal.click();
    await expect(viewer.locator(".werewolf-role-name")).toHaveText(
      roleOf(own.guest),
    );
    await expect(viewer.locator(".werewolf-role-text")).not.toBeEmpty();
    for (const role of dealtRoles)
      if (role !== roleOf(own.guest))
        expect(await pageText(viewer)).not.toContain(role);
    await expectNoHorizontalOverflow(viewer);
    if (viewer === page) await capture(page, "werewolf-role-shown-mobile.png");

    // And hidden again.
    const hide = viewer.getByRole("button", {
      name: "Cacher mon rôle",
      exact: true,
    });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await hide.click();
    await expect(viewer.locator(".werewolf-role-name")).toHaveCount(0);
    await expect(reveal).toBeVisible();
    for (const role of dealtRoles)
      expect(await pageText(viewer)).not.toContain(role);
    // A player has none of the game master's controls.
    await expect(viewer.getByRole("switch")).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "Terminer la partie", exact: true }),
    ).toHaveCount(0);
    await expect(viewer.locator(".werewolf-player-actions")).toHaveCount(0);
    // The pointer leaves the button, so its colour is not the hovered one.
    await viewer.mouse.move(0, 0);
  }

  // A guest who did not join sees the same, without a role or a state.
  const watcher = await pageFor(browser, onlooker.client);
  await watcher.goto(gameURL);
  await expect(watcher.locator(".werewolf-phase")).toHaveText("Jour");
  await expect(
    watcher.getByRole("button", { name: "Voir mon rôle", exact: true }),
  ).toHaveCount(0);
  await expect(watcher.locator(".werewolf-self")).toHaveCount(0);
  await expect(watcher.locator(".werewolf-player")).toHaveCount(0);

  // The game master's board shows every role beside its player.
  const board = await pageFor(browser, master.client);
  await board.goto(gameURL);
  await expect(
    board.getByRole("button", { name: "Voir mon rôle", exact: true }),
  ).toHaveCount(0);
  for (const player of players)
    await expect(row(board, player.guest.name)).toContainText(
      roleOf(player.guest),
    );

  // A mayor is named without a confirmation; only the mayor reads it.
  await board
    .getByRole("button", {
      name: `Nommer ${lou.guest.name} maire`,
      exact: true,
    })
    .click();
  await expect(row(board, lou.guest.name)).toContainText("Maire");
  const own = page.locator(".werewolf-self");
  await expect(own).toHaveText("Tu es maire");
  await expect(own).toHaveAttribute("data-state", "mayor");
  await expect(own.locator("svg")).toBeVisible();
  await expect(
    board.getByRole("button", {
      name: `Retirer le titre de maire à ${lou.guest.name}`,
      exact: true,
    }),
  ).toBeVisible();
  const othersView = await gameFrom(noe.client, event.id);
  expect(othersView.players).toEqual([
    expect.objectContaining({ id: noe.guest.id, alive: true, mayor: false }),
  ]);
  await expect(second.locator(".werewolf-self")).toHaveCount(0);
  expect(await pageText(second)).not.toMatch(/maire/i);

  // A death is confirmed, because it shows the dead player's role to all.
  await board
    .getByRole("button", {
      name: `Annoncer la mort de ${zoe.guest.name}`,
      exact: true,
    })
    .click();
  await acceptConfirmation(
    board,
    `Annoncer la mort de ${zoe.guest.name} ? Son rôle sera dévoilé à tout le monde.`,
  );
  await expect(list(board, "Morts").locator("li")).toHaveCount(1);
  await expect(list(board, "En vie").locator("li")).toHaveCount(3);
  for (const viewer of [page, second, watcher]) {
    const dead = list(viewer, "Morts").locator("li");
    await expect(dead).toHaveCount(1);
    await expect(dead).toContainText(zoe.guest.name);
    await expect(dead).toContainText(roleOf(zoe.guest));
    await expect(dead.locator(".werewolf-skull")).toBeVisible();
    // The living stay off the page.
    await expect(viewer.locator(".werewolf-player")).toHaveCount(1);
    await expect(list(viewer, "En vie")).toHaveCount(0);
    expect(await pageText(viewer)).not.toContain(tom.guest.name);
  }
  expect(
    (await gameFrom(lou.client, event.id)).players.map((player) =>
      player.id === lou.guest.id ? "own" : player.role && roleName(player.role),
    ),
  ).toEqual(["own", roleOf(zoe.guest)]);
  expect(
    (await gameFrom(onlooker.client, event.id)).players.map(
      (player) => player.id,
    ),
  ).toEqual([zoe.guest.id]);
  await expectNoHorizontalOverflow(watcher);
  await capture(watcher, "werewolf-onlooker-mobile.png");

  // With secret deaths on, the dead keep their role until the end.
  const secret = board.getByRole("switch", {
    name: "Garder le rôle des morts caché jusqu’à la fin",
    exact: true,
  });
  await expect(secret).not.toBeChecked();
  await secret.check();
  await expect(row(page, zoe.guest.name)).not.toContainText(roleOf(zoe.guest));
  await board
    .getByRole("button", {
      name: `Annoncer la mort de ${tom.guest.name}`,
      exact: true,
    })
    .click();
  await acceptConfirmation(
    board,
    `Annoncer la mort de ${tom.guest.name} ? Son rôle reste caché jusqu’à la fin.`,
  );
  await expect(list(page, "Morts").locator("li")).toHaveCount(2);
  await expect(row(page, tom.guest.name)).not.toContainText(roleOf(tom.guest));
  for (const role of dealtRoles)
    expect(await pageText(page)).not.toContain(role);
  const secretView = await gameFrom(lou.client, event.id);
  expect(secretView.hideRolesOfDead).toBe(true);
  for (const other of secretView.players)
    if (other.id !== lou.guest.id) expect(other.role).toBeNull();
  // The game master still reads every role.
  await expect(row(board, tom.guest.name)).toContainText(roleOf(tom.guest));

  // A mistake is undone without a confirmation; the living leave the list.
  await board
    .getByRole("button", {
      name: `Ramener ${zoe.guest.name} en jeu`,
      exact: true,
    })
    .click();
  await expect(list(page, "Morts").locator("li")).toHaveCount(1);
  await expect(row(page, zoe.guest.name)).toHaveCount(0);
  await secret.uncheck();
  await expect(row(page, tom.guest.name)).toContainText(roleOf(tom.guest));
  await expectNoHorizontalOverflow(board);
  const finish = board.getByRole("button", {
    name: "Terminer la partie",
    exact: true,
  });
  await expectClearOfDock(board, finish);
  await capture(board, "werewolf-board-master-mobile.png");
  await board.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(board);
  await expectClearOfDock(board, finish);
  await capture(board, "werewolf-board-master-narrow.png");
  await board.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(board);
  await capture(board, "werewolf-board-master-desktop.png");
  await board.setViewportSize(phone);

  // Day and night exist without the ghosts: everybody follows the switch,
  // and the whole app turns to its night colours.
  await expect(
    board.getByRole("switch", {
      name: "Les morts écrivent au maire pendant la nuit",
      exact: true,
    }),
  ).not.toBeChecked();
  const reveal = page.getByRole("button", {
    name: "Voir mon rôle",
    exact: true,
  });
  const toNight = board.getByRole("button", {
    name: "Faire tomber la nuit",
    exact: true,
  });
  const toDay = board.getByRole("button", {
    name: "Lever le jour",
    exact: true,
  });
  await expect(page.locator("html")).toHaveAttribute("data-phase", "day");
  expect(await paint(page, reveal)).toEqual(dayPaint);
  expect(await rootTransition(page)).toBe(0.6);
  await toNight.click();
  await board.mouse.move(0, 0);
  for (const viewer of [page, second, watcher, board]) {
    await expect(viewer.locator(".werewolf-phase")).toHaveText("Nuit");
    await expect(viewer.locator("html")).toHaveAttribute("data-phase", "night");
  }
  // One frame of the crossfade, for review.
  await page.waitForTimeout(300);
  await page.screenshot({
    path: test.info().outputPath("werewolf-player-dusk-mobile.png"),
    style: "nextjs-portal { visibility: hidden; }",
  });
  await expect.poll(() => paint(page, reveal)).toEqual(nightPaint);
  await expect.poll(() => paint(board, toDay)).toEqual(nightPaint);
  await capture(page, "werewolf-player-night-mobile.png");
  await capture(board, "werewolf-board-night-mobile.png");
  await board.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(board);
  await capture(board, "werewolf-board-night-desktop.png");
  await board.setViewportSize(phone);

  // Night belongs to the game's page: leaving it restores the theme at once.
  await watcher.locator(".activity-back").click();
  await expect(watcher).toHaveURL("/programme");
  await expect(watcher.locator("html")).not.toHaveAttribute("data-phase");
  await expect
    .poll(
      () =>
        watcher.evaluate(() => getComputedStyle(document.body).backgroundColor),
      { timeout: 400 },
    )
    .toBe(dayPaint.background);

  // Under reduced motion the colours switch at once.
  await second.emulateMedia({ reducedMotion: "reduce" });
  const secondReveal = second.getByRole("button", {
    name: "Voir mon rôle",
    exact: true,
  });
  expect(await rootTransition(second)).toBeLessThan(0.001);
  expect(await paint(second, secondReveal)).toEqual(nightPaint);
  await toDay.click();
  await expect(second.locator("html")).toHaveAttribute("data-phase", "day");
  await expect
    .poll(() => paint(second, secondReveal), { timeout: 400 })
    .toEqual(dayPaint);
  // By day, everything is back to the normal theme.
  await expect(page.locator(".werewolf-phase")).toHaveText("Jour");
  await expect.poll(() => paint(page, reveal)).toEqual(dayPaint);
  // Without the variant, nothing was written or delivered.
  expect((await gameFrom(master.client, event.id)).messages).toEqual([]);

  // Only the game master commands the board.
  const refused = await sendToGame(lou.client, event.id, "PUT", "/mayor", {
    guestId: lou.guest.id,
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("game_master_required");
});

test("a ghost's message reaches the mayor alone, the end reveals every role and a new game keeps the players", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const { event, master, players, roleOf } = await runningGame(
    "Nuit des fantômes",
    [
      "Lou — sera maire",
      "Noé — sera fantôme",
      "Zoé — reste en vie",
      "Tom — reste en vie",
    ],
  );
  const [lou, noe, zoe, tom] = players;
  const gameURL = `/programme/${event.id}`;
  await shareSession(page.context(), lou.client);
  await page.goto(gameURL);
  const ghost = await pageFor(browser, noe.client);
  await ghost.goto(gameURL);
  const board = await pageFor(browser, master.client);
  await board.goto(gameURL);

  for (const [path, data] of [
    ["/mayor", { guestId: lou.guest.id }],
    [`/players/${noe.guest.id}`, { alive: false }],
  ] as const)
    expect(
      (await sendToGame(master.client, event.id, "PUT", path, data)).status(),
    ).toBe(200);
  await expect(list(page, "Morts")).toContainText(noe.guest.name);
  // The mayor and the ghost each read their own state.
  await expect(page.locator(".werewolf-self")).toHaveText("Tu es maire");
  const ghostState = ghost.locator(".werewolf-self");
  await expect(ghostState).toHaveText("Tu fais partie des morts");
  await expect(ghostState).toHaveAttribute("data-state", "dead");

  // Without the variant, day and night are there already; the dead write
  // nothing.
  for (const viewer of [page, ghost, board])
    await expect(viewer.locator(".werewolf-phase")).toHaveText("Jour");
  await expect(
    board.getByRole("button", { name: "Faire tomber la nuit", exact: true }),
  ).toBeVisible();
  await board
    .getByRole("switch", {
      name: "Les morts écrivent au maire pendant la nuit",
      exact: true,
    })
    .check();
  for (const viewer of [page, ghost, board])
    await expect(viewer.locator(".werewolf-phase")).toHaveText("Jour");
  const field = ghost.getByRole("textbox", {
    name: "Ton message pour le maire",
    exact: true,
  });
  await expect(field).toHaveCount(0);

  // By night, the dead may write; the living may not.
  await board
    .getByRole("button", { name: "Faire tomber la nuit", exact: true })
    .click();
  for (const viewer of [page, ghost, board]) {
    await expect(viewer.locator(".werewolf-phase")).toHaveText("Nuit");
    await expect(viewer.locator("html")).toHaveAttribute("data-phase", "night");
  }
  await expect(field).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const forbidden = await sendToGame(lou.client, event.id, "PUT", "/message", {
    text: "Je suis en vie.",
  });
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).code).toBe("werewolf_message_forbidden");

  // The counter appears near the limit only, and the limit holds the send.
  const send = ghost.getByRole("button", { name: "Envoyer", exact: true });
  const counter = ghost.locator(".werewolf-counter");
  await field.fill("Un indice.");
  await expect(counter).toBeHidden();
  await field.fill("a".repeat(250));
  await expect(counter).toHaveText("250 / 280");
  await field.fill("a".repeat(281));
  await expect(counter).toHaveText("281 / 280");
  await expect(send).toBeDisabled();
  const first = "Regarde du côté de la fenêtre.";
  await field.fill(first);
  await expectNoHorizontalOverflow(ghost);
  await expectClearOfDock(ghost, list(ghost, "Morts"));
  await capture(ghost, "werewolf-ghost-form-mobile.png");
  await send.click();

  // The sent message shows as text, and can be replaced or removed.
  const written = ghost.locator(".werewolf-ghost .werewolf-message-text");
  await expect(written).toHaveText(first);
  await expect(field).toHaveCount(0);
  await expectSavedAnnouncement(ghost, "Ton message est enregistré.");
  await ghost.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(
    board.getByText("Aucun message.", { exact: true }),
  ).toBeVisible();
  const second = "Méfie-toi de ton voisin de gauche.";
  await field.fill("Un brouillon.");
  await send.click();
  await ghost.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(field).toHaveValue("Un brouillon.");
  await field.fill(second);
  await send.click();
  await expect(written).toHaveText(second);
  await capture(ghost, "werewolf-ghost-sent-mobile.png");

  // The game master reads every message; nobody else does before day.
  const messages = board.locator(".werewolf-message");
  await expect(messages).toHaveCount(1);
  await expect(messages).toContainText(noe.guest.name);
  await expect(messages).toContainText(second);
  await expect(messages).not.toContainText("Remis au maire");
  await expectNoHorizontalOverflow(board);
  await capture(board, "werewolf-board-night-mobile.png");
  await expect(page.locator(".werewolf-mayor-message")).toHaveCount(0);
  expect((await gameFrom(lou.client, event.id)).mayorMessage).toBeNull();

  // Day draws the message and delivers it to the mayor, with its writer.
  await board
    .getByRole("button", { name: "Lever le jour", exact: true })
    .click();
  await expect(messages).toContainText("Remis au maire");
  const delivered = page.locator(".werewolf-mayor-message");
  await expect(
    delivered.getByRole("heading", { name: "Un message des morts" }),
  ).toBeVisible();
  await expect(delivered).toContainText(second);
  await expect(delivered).toContainText(noe.guest.name);
  await expect(delivered).not.toContainText(roleOf(noe.guest));
  await expect(page.locator(".werewolf-phase")).toHaveText("Jour");
  await expect(page.locator(".werewolf-self")).toHaveText("Tu es maire");
  await expect(page.locator("html")).toHaveAttribute("data-phase", "day");
  await expectNoHorizontalOverflow(page);
  await capture(page, "werewolf-mayor-message-mobile.png");

  // No other player sees it, in their page or in their response.
  await expect(ghost.locator(".werewolf-mayor-message")).toHaveCount(0);
  await expect(field).toHaveCount(0);
  expect(await pageText(ghost)).not.toContain(second);
  for (const other of [noe, zoe, tom]) {
    const view = await gameFrom(other.client, event.id);
    expect(view.mayorMessage).toBeNull();
    expect(view.messages).toBeNull();
  }
  expect((await gameFrom(lou.client, event.id)).mayorMessage).toEqual({
    from: { id: noe.guest.id, name: noe.guest.name, avatarUrl: null },
    text: second,
  });

  // The end is confirmed and reveals every role to everyone.
  await board
    .getByRole("button", { name: "Terminer la partie", exact: true })
    .click();
  await acceptConfirmation(
    board,
    "Terminer la partie ? Tous les rôles seront dévoilés à tout le monde.",
  );
  for (const viewer of [page, ghost]) {
    await expect(
      viewer.getByText("Partie terminée", { exact: true }),
    ).toBeVisible();
    for (const player of players)
      await expect(row(viewer, player.guest.name)).toContainText(
        roleOf(player.guest),
      );
    await expect(viewer.locator(".werewolf-phase")).toHaveCount(0);
    await expect(viewer.locator(".werewolf-self")).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "Nouvelle partie", exact: true }),
    ).toHaveCount(0);
  }
  await expect(page.locator(".werewolf-mayor-message")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await capture(page, "werewolf-finished-mobile.png");

  // A new game returns to the lobby with the same players; others may join.
  const late = await participant("Eva — rejoint la suivante");
  expect((await joinGame(late.client, event.id)).status()).toBe(409);
  await board
    .getByRole("button", { name: "Nouvelle partie", exact: true })
    .click();
  await expect(
    page.getByText("Inscriptions ouvertes", { exact: true }),
  ).toBeVisible();
  await expect(list(page, "Joueurs").locator("li")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Quitter la partie", exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("heading", { name: "Rôles", exact: true }),
  ).toBeVisible();
  expect((await joinGame(late.client, event.id)).status()).toBe(200);
  await expect(list(page, "Joueurs").locator("li")).toHaveCount(5);
  const lobby = await gameFrom(master.client, event.id);
  expect(lobby).toMatchObject({
    status: "lobby",
    phase: "day",
    ghostMessages: true,
    messages: [],
  });
  expect(
    lobby.players.every(
      (player) => player.alive && !player.mayor && player.role === null,
    ),
  ).toBe(true);
  expect(lobby.roles!.filter((role) => role.count === 1)).toHaveLength(4);
});

test("the page follows a game without a game master, a change of game master and a deleted game", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const lou = await participant("Lou — attend la partie");
  const noe = await participant("Noé — mènera la partie");
  const event = await createWerewolf(host, {
    title: "Partie à préparer",
    gameMasterId: null,
  });
  eventIDs.push(event.id);
  const gameURL = `/programme/${event.id}`;
  await shareSession(page.context(), lou.client);

  // Nobody leads the game yet: guests can join, nobody can start.
  await page.goto(gameURL);
  await expect(
    page.getByText(
      "Personne ne peut lancer la partie tant qu’aucun maître du jeu n’est choisi.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choisir le maître du jeu" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Rejoindre la partie", exact: true })
    .click();
  await expect(row(page, lou.guest.name)).toContainText("Toi");

  // The host gets the way to the event's settings.
  const hostPage = await pageFor(browser, host);
  await hostPage.goto(gameURL);
  const choose = hostPage.getByRole("link", {
    name: "Choisir le maître du jeu",
    exact: true,
  });
  await expect(choose).toHaveAttribute("href", "/parametres?section=programme");
  await expect(
    hostPage.getByRole("button", { name: "Lancer la partie", exact: true }),
  ).toHaveCount(0);

  // Another guest becomes game master, and removes the viewer from the game.
  expect((await setGameMaster(host, event, noe.guest.id)).status()).toBe(200);
  await expect(page.locator(".werewolf-master")).toContainText(noe.guest.name);
  await expect(choose).toHaveCount(0);
  await expect(
    hostPage.getByRole("link", { name: "Gérer le programme", exact: true }),
  ).toBeVisible();
  expect(
    (
      await sendToGame(
        noe.client,
        event.id,
        "DELETE",
        `/players/${lou.guest.id}`,
      )
    ).status(),
  ).toBe(200);
  await expect(row(page, lou.guest.name)).toHaveCount(0);
  const join = page.getByRole("button", {
    name: "Rejoindre la partie",
    exact: true,
  });
  await expect(join).toBeVisible();
  await join.click();
  await expect(row(page, lou.guest.name)).toBeVisible();

  // The viewer becomes game master with the page open: they stop playing
  // and get the game master's lobby.
  expect((await setGameMaster(host, event, lou.guest.id)).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Rôles", exact: true }),
  ).toBeVisible();
  await expect(join).toHaveCount(0);
  await expect(row(page, lou.guest.name)).toHaveCount(0);
  await expect(page.locator(".werewolf-master")).toContainText(lou.guest.name);
  await expect(
    page.getByText("Aucun joueur pour l’instant.", { exact: true }),
  ).toBeVisible();

  // A failed read keeps the page and offers a retry.
  await page.route(`**/api/programme/${event.id}/werewolf`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "internal_error", error: "Test failure" }),
    }),
  );
  expect((await joinGame(noe.client, event.id)).status()).toBe(200);
  await expect(page.locator(".werewolf-feedback [role=alert]")).toBeVisible();
  await expect(row(page, noe.guest.name)).toHaveCount(0);
  await page.unroute(`**/api/programme/${event.id}/werewolf`);
  await page
    .locator(".werewolf-feedback")
    .getByRole("button", { name: "Réessayer", exact: true })
    .click();
  await expect(row(page, noe.guest.name)).toBeVisible();
  await expect(page.locator(".werewolf-feedback")).toHaveCount(0);

  // Deleting the event sends its page back to the Schedule.
  eventIDs.splice(eventIDs.indexOf(event.id), 1);
  expect((await host.delete(`/api/admin/programme/${event.id}`)).status()).toBe(
    204,
  );
  await expect(page).toHaveURL("/programme");
  await expect(hostPage).toHaveURL("/programme");
  await page.goto(gameURL);
  await expect(
    page.getByRole("heading", { name: "Cette page n’existe pas." }),
  ).toBeVisible();
});
