import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  activate,
  baseURL,
  bootstrapHost,
  expectNoHorizontalOverflow,
  invite,
  newClient,
  type Guest,
} from "./support/party";
import { acceptConfirmation } from "./support/confirm";
import {
  addAvatar,
  castVote,
  castWriteIn,
  createVote,
  eventFrom,
  optionOf,
  programme,
  setVoteStatus,
  voteFrom,
  voteSettings,
  type VoteSource,
} from "./support/votes";

let host: APIRequestContext;
const eventIDs: number[] = [];
const contexts: BrowserContext[] = [];
const clients: APIRequestContext[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Vote Test Host");
});

test.afterEach(async ({ page }) => {
  // Deleting a vote sends every page still showing it back to the programme.
  // Closing a browser context in the middle of that navigation can hang
  // Chrome, so the page leaves before its vote goes.
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

/** Creates a guest who only takes part through the API. */
async function apiGuest(name: string) {
  const { guest, invitationUrl } = await invite(host, name);
  const client = await newClient();
  clients.push(client);
  await activate(client, invitationUrl);
  return { guest, client };
}

async function openVote(title: string, question: string, source: VoteSource) {
  const event = await createVote(host, { title, question, source });
  eventIDs.push(event.id);
  await setVoteStatus(host, event.id, "open");
  return event;
}

/** Votes through the API for the option with this label. */
async function voteFor(
  client: APIRequestContext,
  eventID: number,
  label: string,
) {
  const { id } = optionOf(await voteFrom(client, eventID), label);
  expect((await castVote(client, eventID, id)).status()).toBe(200);
}

/** The card of one option on the vote page. */
function option(page: Page, label: string) {
  return page
    .locator(".vote-option")
    .filter({ has: page.getByText(label, { exact: true }) });
}

function radio(page: Page, label: string) {
  return page.getByRole("radio", { name: label, exact: true });
}

/** The count of an option as assistive technology reads it. */
function votes(page: Page, label: string) {
  return option(page, label).locator(".vote-option-count .visually-hidden");
}

function labels(page: Page) {
  return page.locator(".vote-option-label").allTextContents();
}

/** Resolves once the page has read the programme again. */
function programmeRead(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/programme" &&
      response.request().method() === "GET",
  );
}

// Everything a vote response may carry: counts and the viewer's own choice.
const voteFields = [
  "allowSelfVote",
  "allowWriteIns",
  "canVote",
  "choices",
  "myOptionId",
  "options",
  "question",
  "status",
];
const optionFields = [
  "active",
  "avatarUrl",
  "guestId",
  "id",
  "label",
  "votes",
  "writeIn",
];

test("guests reach a vote only once it is open and unlocked, then vote on its page with live counts", async ({
  page,
}) => {
  const mila = await invite(host, "Mila — piste de danse");
  const alix = await invite(host, "Alix — piste de danse");
  const camille = await invite(host, "Camille — piste de danse");
  const robin = await invite(host, "Robin — piste de danse");
  const candidates = [mila.guest, alix.guest, camille.guest, robin.guest];
  const avatarURL = await addAvatar(page, camille);
  await activate(page.request, mila.invitationUrl);
  const sacha = await apiGuest("Sacha — premier bulletin");
  const noa = await apiGuest("Noa — deuxième bulletin");
  const eli = await apiGuest("Eli — troisième bulletin");
  const question = "Qui nous a donné envie de danser ?";
  const event = await createVote(host, {
    title: "Sur la piste de danse",
    question,
    source: { candidates },
    unlockAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  eventIDs.push(event.id);
  const votePath = `/programme/${event.id}`;

  // A draft does not exist for guests, whatever the address.
  await page.goto(votePath);
  await expect(
    page.getByRole("heading", { name: "Cette page n’existe pas." }),
  ).toBeVisible();
  let realtimeReady = false;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/api/realtime") return;
    socket.on("framereceived", ({ payload }) => {
      if (JSON.parse(payload.toString()).type === "ready") realtimeReady = true;
    });
  });
  await page.goto("/programme");
  await expect.poll(() => realtimeReady).toBe(true);
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toHaveCount(0);
  expect(
    (await programme(page.request)).some((item) => item.id === event.id),
  ).toBe(false);

  // Open but still locked: only the teaser shows, and the page stays closed.
  await setVoteStatus(host, event.id, "open");
  await expect(page.getByText(event.teaser, { exact: true })).toBeVisible();
  expect(await eventFrom(page.request, event.id)).toMatchObject({
    title: event.teaser,
    description: "",
    locked: true,
    vote: null,
  });
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
  await expect(page.getByText(camille.guest.name, { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Voter" })).toHaveCount(0);
  const probe = await page.context().newPage();
  await probe.goto(votePath);
  await expect(probe).toHaveURL("/programme");
  await expect(probe.getByText(question, { exact: true })).toHaveCount(0);
  await probe.close();
  const locked = await voteFrom(host, event.id, true);
  expect(
    (
      await castVote(
        page.request,
        event.id,
        optionOf(locked, robin.guest.name).id,
      )
    ).status(),
  ).toBe(404);

  const current = await eventFrom(host, event.id, true);
  const unlocked = await host.put(`/api/admin/programme/${event.id}`, {
    data: {
      type: current.type,
      revision: current.revision,
      title: current.title,
      description: current.description,
      teaser: current.teaser,
      startsAt: current.startsAt,
      unlockAt: null,
      vote: voteSettings(question, { candidates }),
    },
  });
  expect(unlocked.status()).toBe(200);

  // The Programme tab only previews the vote and leads to its page.
  const featured = page.getByRole("article", {
    name: event.title,
    exact: true,
  });
  await expect(
    featured.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await expect(
    featured.getByText("Vote ouvert", { exact: true }),
  ).toBeVisible();
  await expect(featured.getByRole("radio")).toHaveCount(0);
  await expect(featured.locator(".programme-vote-preview .avatar")).toHaveCount(
    3,
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("programme-featured-vote-mobile.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
  await featured.getByRole("link", { name: "Voter", exact: true }).click();
  await expect(page).toHaveURL(votePath);
  await expect(
    page.locator('.navigation a[href="/programme"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect.poll(() => realtimeReady).toBe(true);

  // Every option is listed with its portrait and count; the list is a ballot.
  await expect(
    page.getByRole("heading", { level: 1, name: question, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vote ouvert", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Votes reçus : 0", { exact: true }),
  ).toBeVisible();
  expect(await labels(page)).toEqual([
    alix.guest.name,
    camille.guest.name,
    mila.guest.name,
    robin.guest.name,
  ]);
  await expect(page.getByRole("radio")).toHaveCount(4);
  const portrait = option(page, camille.guest.name).locator(".avatar");
  await expect(portrait.locator(`img[src="${avatarURL}"]`)).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  expect(await portrait.boundingBox()).toMatchObject({ width: 72, height: 72 });
  // Without a photo, the initial stands in at the same size.
  await expect(option(page, robin.guest.name).locator(".avatar")).toHaveText(
    "R",
  );
  await expect(radio(page, mila.guest.name)).toBeDisabled();
  await expect(radio(page, mila.guest.name)).toHaveAccessibleDescription(
    /Tu ne peux pas voter pour toi/,
  );
  await expect(
    option(page, mila.guest.name).getByText("Tu ne peux pas voter pour toi", {
      exact: true,
    }),
  ).toBeVisible();
  const submit = page.getByRole("button", { name: "Voter", exact: true });
  await expect(submit).toBeDisabled();

  // A selection is not a vote until it is confirmed.
  await option(page, camille.guest.name)
    .getByText(camille.guest.name, { exact: true })
    .click();
  await expect(radio(page, camille.guest.name)).toBeChecked();
  await expect(submit).toBeEnabled();
  expect((await voteFrom(page.request, event.id)).myOptionId).toBeNull();
  // Arrow keys move within the group and skip what cannot be chosen.
  await radio(page, camille.guest.name).focus();
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, robin.guest.name)).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(radio(page, camille.guest.name)).toBeChecked();
  await expect(radio(page, camille.guest.name)).toBeFocused();

  // An unrelated update keeps the unsent selection.
  let read = programmeRead(page);
  const other = await host.post("/api/admin/programme", {
    data: {
      type: "event",
      title: "Un autre rendez-vous",
      description: "",
      teaser: "",
      startsAt: null,
      unlockAt: null,
      vote: null,
    },
  });
  expect(other.status()).toBe(201);
  eventIDs.push((await other.json()).id);
  await read;
  await expect(radio(page, camille.guest.name)).toBeChecked();

  // Other guests' votes arrive live: counts change and the list reorders,
  // while the selection and the keyboard focus stay on the same option.
  await voteFor(sacha.client, event.id, robin.guest.name);
  await expect(votes(page, robin.guest.name)).toHaveText("1 voix");
  await expect(
    page.getByText("Votes reçus : 1", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => labels(page))
    .toEqual([
      robin.guest.name,
      alix.guest.name,
      camille.guest.name,
      mila.guest.name,
    ]);
  await expect(radio(page, camille.guest.name)).toBeChecked();
  await expect(radio(page, camille.guest.name)).toBeFocused();
  await voteFor(noa.client, event.id, robin.guest.name);
  await expect(votes(page, robin.guest.name)).toHaveText("2 voix");
  expect((await voteFrom(page.request, event.id)).myOptionId).toBeNull();

  // Confirming records the vote without leaving or resetting the page.
  await page.evaluate(() => window.scrollTo(0, 120));
  const scrolled = await page.evaluate(() => window.scrollY);
  await submit.click();
  await expect(
    page.getByText(`Ton vote pour ${camille.guest.name} est enregistré.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(votePath);
  // The browser may shift by a card's growth to keep what is on screen still.
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - scrolled),
  ).toBeLessThan(60);
  await expect(
    option(page, camille.guest.name).getByText("Ton vote", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ton vote", { exact: true })).toHaveCount(1);
  await expect(votes(page, camille.guest.name)).toHaveText("1 voix");
  const change = page.getByRole("button", {
    name: "Changer mon vote",
    exact: true,
  });
  await expect(change).toBeDisabled();
  expect((await voteFrom(page.request, event.id)).myOptionId).toBe(
    optionOf(await voteFrom(page.request, event.id), camille.guest.name).id,
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("vote-page-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("vote-page-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });

  // The vote can be replaced, here with the keyboard.
  await radio(page, robin.guest.name).press("Space");
  await expect(change).toBeEnabled();
  await change.click();
  await expect(
    page.getByText(`Ton vote pour ${robin.guest.name} est enregistré.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(votes(page, robin.guest.name)).toHaveText("3 voix");
  await expect(votes(page, camille.guest.name)).toHaveText("0 voix");
  await expect(
    option(page, robin.guest.name).getByText("Ton vote", { exact: true }),
  ).toBeVisible();

  // The server refuses what the ballot does not offer.
  const open = await voteFrom(page.request, event.id);
  for (const [optionId, code] of [
    [optionOf(open, mila.guest.name).id, "self_vote_forbidden"],
    [999_999_999, "invalid_vote_option"],
  ] as const) {
    const refused = await castVote(page.request, event.id, optionId);
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe(code);
  }
  expect(
    (await castWriteIn(page.request, event.id, "Quelqu’un d’autre")).status(),
  ).toBe(403);

  // Nobody learns who voted for whom: guests and the host get the same
  // counts, and only the viewer's own choice.
  for (const [client, asHost] of [
    [page.request, false],
    [host, true],
  ] as const) {
    const visible = await eventFrom(client, event.id, asHost);
    expect(Object.keys(visible.vote!).sort()).toEqual(voteFields);
    for (const item of visible.vote!.options)
      expect(Object.keys(item).sort()).toEqual(optionFields);
    const body = JSON.stringify(visible);
    for (const voter of [sacha, noa, eli])
      expect(body).not.toContain(voter.guest.name);
  }
  expect((await voteFrom(host, event.id, true)).myOptionId).toBeNull();
  expect((await voteFrom(sacha.client, event.id)).myOptionId).toBe(
    optionOf(open, robin.guest.name).id,
  );

  // A candidate who loses access stays listed but can no longer be chosen.
  expect(
    (await host.delete(`/api/admin/guests/${alix.guest.id}`)).status(),
  ).toBe(204);
  await page.reload();
  await expect(radio(page, robin.guest.name)).toBeChecked();
  await expect(radio(page, alix.guest.name)).toBeDisabled();
  await expect(
    option(page, alix.guest.name).getByText("Indisponible", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await castVote(page.request, event.id, optionOf(open, alix.guest.name).id)
    ).status(),
  ).toBe(400);

  // A tie at the close marks every leader; there is nothing left to reveal.
  await voteFor(eli.client, event.id, camille.guest.name);
  await voteFor(noa.client, event.id, camille.guest.name);
  await expect(votes(page, camille.guest.name)).toHaveText("2 voix");
  await expect(votes(page, robin.guest.name)).toHaveText("2 voix");
  await setVoteStatus(host, event.id, "closed");
  await expect(page.getByText("Vote terminé", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /vote/i })).toHaveCount(0);
  await expect(
    page.getByText("Votes reçus : 4", { exact: true }),
  ).toBeVisible();
  for (const leader of [camille.guest, robin.guest])
    await expect(
      option(page, leader.name).getByText("En tête", { exact: true }),
    ).toBeVisible();
  await expect(page.getByText("En tête", { exact: true })).toHaveCount(2);
  await expect(
    option(page, robin.guest.name).getByText("Ton vote", { exact: true }),
  ).toBeVisible();
  expect(await labels(page)).toEqual([
    camille.guest.name,
    robin.guest.name,
    alix.guest.name,
    mila.guest.name,
  ]);
  const closed = await voteFrom(page.request, event.id);
  expect(closed).toMatchObject({ status: "closed", canVote: false });
  expect(closed.options.map((item) => item.votes)).toEqual([2, 2, 0, 0]);
  const late = await castVote(
    page.request,
    event.id,
    optionOf(closed, camille.guest.name).id,
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("vote_closed");
  await page.screenshot({
    path: test.info().outputPath("vote-page-closed-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);

  // On a wide screen the list keeps a reading column and larger portraits.
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    await option(page, camille.guest.name).locator(".avatar").boundingBox(),
  ).toMatchObject({ width: 88, height: 88 });
  const list = (await page.locator(".vote-options").boundingBox())!;
  const main = (await page.locator(".main-content").boundingBox())!;
  expect(list.width).toBeLessThanOrEqual(700);
  expect(list.width).toBeLessThan(main.width * 0.7);
  await page.screenshot({
    path: test.info().outputPath("vote-page-closed-desktop.png"),
    animations: "disabled",
  });

  // Back on the Programme tab, the closed vote is an agenda card again.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".activity-back").click();
  await expect(page).toHaveURL("/programme");
  const card = page.getByRole("article", { name: event.title, exact: true });
  await expect(card.getByText("Vote terminé", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Voir le vote", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".programme-featured")).toHaveCount(0);
});

test("a custom vote takes write-ins: the same typed choice is one option, and the host can remove it", async ({
  browser,
  page,
}) => {
  const lou = await invite(host, "Lou — repas de minuit");
  await activate(page.request, lou.invitationUrl);
  const jade = await apiGuest("Jade — repas de minuit");
  const tom = await apiGuest("Tom — repas de minuit");
  const question = "Qu’est-ce qu’on mange à minuit ?";
  const event = await openVote("Le repas de minuit", question, {
    labels: ["Pizza", "Raclette"],
    allowWriteIns: true,
  });
  const votePath = `/programme/${event.id}`;

  // The Programme tab previews custom choices by their labels.
  await page.goto("/programme");
  const featured = page.getByRole("article", {
    name: event.title,
    exact: true,
  });
  await expect(featured.locator(".programme-vote-choice")).toHaveText([
    "Pizza",
    "Raclette",
  ]);
  await expect(featured.locator(".avatar")).toHaveCount(0);
  await featured.getByRole("link", { name: "Voter", exact: true }).click();
  await expect(page).toHaveURL(votePath);

  await expect(
    page.getByRole("heading", { level: 1, name: question, exact: true }),
  ).toBeVisible();
  expect(await labels(page)).toEqual(["Pizza", "Raclette"]);
  await expect(page.locator(".vote-option .avatar")).toHaveCount(0);
  const field = page.getByLabel("Ajouter un choix", { exact: true });
  const send = page.getByRole("button", {
    name: "Voter pour ce choix",
    exact: true,
  });
  await expect(field).toHaveAttribute("maxlength", "80");
  await expect(send).toBeDisabled();
  await field.fill("   ");
  await expect(send).toBeDisabled();

  // A new choice is created and voted for in one step.
  await field.fill("  Tacos ");
  await send.click();
  await expect(field).toHaveValue("");
  await expect(radio(page, "Tacos")).toBeChecked();
  await expect(option(page, "Tacos").getByText("Ton vote")).toBeVisible();
  await expect(votes(page, "Tacos")).toHaveText("1 voix");
  await expect(page).toHaveURL(votePath);
  expect(
    optionOf(await voteFrom(page.request, event.id), "Tacos"),
  ).toMatchObject({
    label: "Tacos",
    guestId: null,
    writeIn: true,
    active: true,
    votes: 1,
  });

  // Typing an existing choice, whatever the case, joins it.
  expect((await castWriteIn(jade.client, event.id, " tacos")).status()).toBe(
    200,
  );
  await expect(votes(page, "Tacos")).toHaveText("2 voix");
  await expect(page.getByRole("radio", { name: /^tacos$/i })).toHaveCount(1);
  await field.fill("PIZZA");
  await send.click();
  await expect(radio(page, "Pizza")).toBeChecked();
  await expect(votes(page, "Pizza")).toHaveText("1 voix");
  await expect(page.getByRole("radio", { name: /^pizza$/i })).toHaveCount(1);

  // Two guests typing the same new choice at once create a single option.
  const together = await Promise.all([
    castWriteIn(jade.client, event.id, "Fondue"),
    castWriteIn(tom.client, event.id, "fondue "),
  ]);
  expect(together.map((response) => response.status())).toEqual([200, 200]);
  const shared = (await voteFrom(host, event.id, true)).options.filter(
    (item) => item.label.toLowerCase() === "fondue",
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]).toMatchObject({ writeIn: true, votes: 2 });
  await expect(votes(page, shared[0].label)).toHaveText("2 voix");
  // Jade left Tacos for Fondue: a write-in without votes disappears.
  await expect(radio(page, "Tacos")).toHaveCount(0);
  expect(await labels(page)).toEqual([shared[0].label, "Pizza", "Raclette"]);

  // The server's refusals reach the guest in their language.
  await page.route(`**/api/programme/${event.id}/vote/options`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "vote_option_limit", error: "Full." }),
    }),
  );
  await field.fill("Sushis");
  await send.click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Ce vote a déjà le nombre maximum de choix.",
    }),
  ).toBeVisible();
  await expect(field).toHaveValue("Sushis");
  await page.unroute(`**/api/programme/${event.id}/vote/options`);
  // Editing the text dismisses the refusal it caused.
  await field.fill("");
  await expect(page.locator(".vote-write-in").getByRole("alert")).toHaveCount(
    0,
  );
  const tooLong = await castWriteIn(page.request, event.id, "x".repeat(81));
  expect(tooLong.status()).toBe(400);
  expect((await tooLong.json()).code).toBe("invalid_vote_label");
  expect((await castWriteIn(page.request, event.id, "  ")).status()).toBe(400);

  await page.screenshot({
    path: test.info().outputPath("vote-page-custom-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  // On a wide screen the field sits beside the list.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const list = (await page.locator(".vote-options").boundingBox())!;
  expect((await field.boundingBox())!.x).toBeGreaterThan(list.x + list.width);
  await page.screenshot({
    path: test.info().outputPath("vote-page-custom-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);

  // The host moderates write-ins from the same page; an unsent selection of
  // the removed choice is cleared with an explanation.
  await radio(page, shared[0].label).check();
  const change = page.getByRole("button", {
    name: "Changer mon vote",
    exact: true,
  });
  await expect(change).toBeEnabled();
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
    viewport: { width: 390, height: 844 },
  });
  contexts.push(context);
  const moderator = await context.newPage();
  await moderator.goto(votePath);
  await expect(
    moderator.getByRole("button", { name: /^Retirer « (Pizza|Raclette) »$/ }),
  ).toHaveCount(0);
  await moderator
    .getByRole("button", {
      name: `Retirer « ${shared[0].label} »`,
      exact: true,
    })
    .click();
  await acceptConfirmation(
    moderator,
    `Retirer « ${shared[0].label} » et ses votes ?`,
  );
  await expect(radio(moderator, shared[0].label)).toHaveCount(0);
  await expect(radio(page, shared[0].label)).toHaveCount(0);
  await expect(
    page.getByText("Ce choix n’est plus disponible. Choisis-en un autre.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(change).toBeDisabled();
  await expect(radio(page, "Pizza")).toBeChecked();
  const moderated = await voteFrom(host, event.id, true);
  expect(moderated.options.map((item) => item.label)).toEqual([
    "Pizza",
    "Raclette",
  ]);
  // The removed votes are gone; the guests may vote again.
  expect((await voteFrom(jade.client, event.id)).myOptionId).toBeNull();
  expect((await voteFrom(jade.client, event.id)).canVote).toBe(true);
  // Host-defined choices cannot be removed that way.
  const kept = await host.delete(
    `/api/admin/programme/${event.id}/vote/options/${optionOf(moderated, "Pizza").id}`,
  );
  expect(kept.status()).toBe(409);
  expect((await kept.json()).code).toBe("activity_conflict");
  expect(
    (
      await page.request.delete(
        `/api/admin/programme/${event.id}/vote/options/${optionOf(moderated, "Raclette").id}`,
      )
    ).status(),
  ).toBe(403);
  await moderator.screenshot({
    path: test.info().outputPath("vote-page-host-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await moderator
    .getByRole("link", { name: "Gérer le programme", exact: true })
    .click();
  await expect(moderator).toHaveURL(
    (url) =>
      url.pathname === "/parametres" &&
      url.searchParams.get("section") === "programme",
  );

  // Once closed, the field is gone and typed choices are refused.
  await setVoteStatus(host, event.id, "closed");
  await expect(page.getByText("Vote terminé", { exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  await expect(option(page, "Pizza").getByText("En tête")).toBeVisible();
  const late = await castWriteIn(page.request, event.id, "Trop tard");
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("vote_closed");
  expect(
    (await voteFrom(host, event.id, true)).options.map((item) => item.label),
  ).toEqual(["Pizza", "Raclette"]);
});

test("a vote without any choice invites the first one, and a vote without write-ins has no field", async ({
  page,
}) => {
  const guest = await invite(host, "Nina — premier choix");
  await activate(page.request, guest.invitationUrl);
  const empty = await openVote(
    "Le prochain voyage",
    "On part où l’été prochain ?",
    { labels: [], allowWriteIns: true },
  );
  const fixed = await openVote("Le dessert", "Quel dessert ?", {
    labels: ["Tarte", "Glace"],
  });

  await page.goto(`/programme/${empty.id}`);
  await expect(
    page.getByText("Aucun choix pour l’instant. Ajoute le premier.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Voter", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Votes reçus : 0", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Ajouter un choix", { exact: true }).fill("Lisbonne");
  await page.keyboard.press("Enter");
  await expect(radio(page, "Lisbonne")).toBeChecked();
  await expect(page.getByText(/Aucun choix pour l’instant/)).toHaveCount(0);
  await expect(
    page.getByText("Votes reçus : 1", { exact: true }),
  ).toBeVisible();

  await page.goto(`/programme/${fixed.id}`);
  expect(await labels(page)).toEqual(["Glace", "Tarte"]);
  await expect(
    page.getByLabel("Ajouter un choix", { exact: true }),
  ).toHaveCount(0);
  const refused = await castWriteIn(page.request, fixed.id, "Mousse");
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("write_ins_disabled");

  // Closed without a single vote: the page says so and marks no leader.
  await setVoteStatus(host, fixed.id, "closed");
  await expect(
    page.getByText("Personne n’a voté.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("En tête", { exact: true })).toHaveCount(0);
  expect(await labels(page)).toEqual(["Glace", "Tarte"]);
});

test("the host decides whether candidates may vote for themselves", async ({
  page,
}) => {
  const lea = await invite(host, "Léa — autoportrait");
  const hugo = await invite(host, "Hugo — autoportrait");
  await activate(page.request, lea.invitationUrl);
  const candidates: Guest[] = [lea.guest, hugo.guest];
  const strict = await openVote(
    "Le plus modeste",
    "Qui est le plus modeste ?",
    {
      candidates,
    },
  );
  const free = await openVote("Le plus fier", "Qui est le plus fier ?", {
    candidates,
    allowSelfVote: true,
  });

  await page.goto(`/programme/${strict.id}`);
  await expect(radio(page, lea.guest.name)).toBeDisabled();
  await expect(radio(page, hugo.guest.name)).toBeEnabled();
  await expect(
    page.getByText("Tu ne peux pas voter pour toi", { exact: true }),
  ).toHaveCount(1);

  await page.goto(`/programme/${free.id}`);
  await expect(
    page.getByText("Tu ne peux pas voter pour toi", { exact: true }),
  ).toHaveCount(0);
  await radio(page, lea.guest.name).check();
  await page.getByRole("button", { name: "Voter", exact: true }).click();
  await expect(
    option(page, lea.guest.name).getByText("Ton vote", { exact: true }),
  ).toBeVisible();
  expect(
    optionOf(await voteFrom(page.request, free.id), lea.guest.name),
  ).toMatchObject({ guestId: lea.guest.id, votes: 1 });
});
