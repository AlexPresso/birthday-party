import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  bootstrapHost,
  invite,
  activate,
  mutationHeaders,
  newClient,
  shareSession,
  expectNoHorizontalOverflow,
  type Invitation,
} from "./support/party";
import {
  expectSavedAnnouncement,
  openSettingsSection,
} from "./support/settings";
import { canvasImage } from "./support/images";
import {
  closeUploadDetails,
  openUploadDetails,
  uploadSheet,
} from "./support/uploads";
import { createVote, setVoteStatus } from "./support/votes";
import {
  createWerewolf,
  gameFrom,
  joinGame,
  nightPaint,
  paint,
  sendToGame,
} from "./support/werewolf";
import type { Configuration } from "../../frontend/src/features/party/contracts";

type Appearance = Configuration["appearance"];

const defaultAppearance: Appearance = { theme: "dark", accent: "#ff6a1f" };
const darkBackground = "rgb(16, 15, 14)";
const lightBackground = "rgb(247, 243, 238)";
const orange = "rgb(255, 106, 31)";
const blue = "rgb(62, 99, 221)";
const white = "rgb(255, 255, 255)";

let host: APIRequestContext;
let guest: APIRequestContext;
let guestInvitation: Invitation;

test.use({ locale: "fr-CH", viewport: { width: 390, height: 844 } });

async function configuration() {
  const response = await host.get("/api/admin/config");
  expect(response.status()).toBe(200);
  return (await response.json()) as Configuration;
}

async function setAppearance(appearance: Appearance) {
  const response = await host.put("/api/admin/config", {
    data: { ...(await configuration()), appearance },
  });
  expect(response.status()).toBe(200);
}

function bodyBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** A filled accent control's background and text colours, as painted. */
function filled(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: style.color };
  });
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: test.info().outputPath(name),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
}

/** A page signed in as the test guest. */
async function guestPage(browser: Browser) {
  const context = await browser.newContext({
    locale: "fr-CH",
    viewport: { width: 390, height: 844 },
  });
  await shareSession(context, guest);
  return context.newPage();
}

test.beforeAll(async () => {
  host = await bootstrapHost("Appearance Test Host");
  guest = await newClient();
  guestInvitation = await invite(host, "Appearance Guest");
  await activate(guest, guestInvitation.invitationUrl);
});

// Every other spec expects today's dark orange look.
test.afterEach(async () => {
  await setAppearance(defaultAppearance);
});

test.afterAll(async () => {
  await guest?.dispose();
  await host?.dispose();
});

test("the host's theme and main colour restyle the app for guests and visitors", async ({
  page,
  context,
  browser,
}) => {
  await shareSession(context, host);
  await page.goto("/parametres");
  const row = page.locator('a[href="/parametres?section=appearance"]');
  await expect(row).toContainText("Apparence");
  await expect(row.locator(".settings-menu-value")).toHaveText("Sombre");
  await openSettingsSection(page, "appearance");
  const editor = page.locator('[data-settings-screen="appearance"]');
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(
    editor.getByRole("radio", { name: "Sombre", exact: true }),
  ).toBeChecked();
  await expect(
    editor.getByRole("radio", { name: "Orange", exact: true }),
  ).toBeChecked();
  for (const name of ["Rouge", "Rose", "Violet", "Bleu", "Turquoise", "Vert"])
    await expect(
      editor.getByRole("radio", { name, exact: true }),
    ).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
  await capture(page, "appearance-editor-dark.png");

  // Light: the whole app follows at once, the visitor's invitation included.
  await editor.getByRole("radio", { name: "Clair", exact: true }).check();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect.poll(() => bodyBackground(page)).toBe(lightBackground);
  await expectSavedAnnouncement(editor, "Apparence enregistrée.");
  expect((await configuration()).appearance).toEqual({
    theme: "light",
    accent: "#ff6a1f",
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#f7f3ee",
  );
  await capture(page, "appearance-editor-light.png");

  const visitorContext = await browser.newContext({
    locale: "fr-CH",
    viewport: { width: 390, height: 844 },
  });
  const visitor = await visitorContext.newPage();
  await visitor.goto("/invitation");
  await expect(visitor.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyBackground(visitor)).toBe(lightBackground);
  await capture(visitor, "light-invitation.png");
  await visitorContext.close();

  // Blue carries white text, for the host and for a guest after reload.
  const viewer = await guestPage(browser);
  await editor.getByRole("radio", { name: "Bleu", exact: true }).check();
  await expect(
    editor.getByRole("radio", { name: "Bleu", exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () => (await configuration()).appearance)
    .toEqual({
      theme: "light",
      accent: "#3e63dd",
    });
  await expect(html).toHaveAttribute("style", /--party-accent:\s*#3e63dd/);
  await page.goto("/photos");
  const hostButton = page.locator(".media-gallery .button.primary").first();
  expect(await filled(hostButton)).toEqual({ background: blue, text: white });
  await viewer.goto("/photos");
  const guestButton = viewer.locator(".media-gallery .button.primary").first();
  expect(await filled(guestButton)).toEqual({ background: blue, text: white });

  // Any colour through the native picker; a very pale one gets dark text.
  await openSettingsSection(page, "appearance");
  const picker = editor.getByLabel("Autre couleur", { exact: true });
  await pickColour(picker, "#fff5cc");
  await expect
    .poll(async () => (await configuration()).appearance)
    .toEqual({
      theme: "light",
      accent: "#fff5cc",
    });
  await expect(
    editor.getByRole("radio", { name: "Bleu", exact: true }),
  ).not.toBeChecked();
  await expect(editor.locator(".appearance-custom")).toHaveAttribute(
    "data-selected",
  );
  await viewer.reload();
  expect(await filled(guestButton)).toEqual({
    background: "rgb(255, 245, 204)",
    text: darkBackground,
  });

  // Back to dark and orange: exactly today's colours.
  await editor.getByRole("radio", { name: "Sombre", exact: true }).check();
  await editor.getByRole("radio", { name: "Orange", exact: true }).check();
  await expect
    .poll(async () => (await configuration()).appearance)
    .toEqual(defaultAppearance);
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => bodyBackground(page)).toBe(darkBackground);
  await viewer.reload();
  expect(await bodyBackground(viewer)).toBe(darkBackground);
  expect(await filled(guestButton)).toEqual({
    background: orange,
    text: darkBackground,
  });
  await viewer.context().close();
});

/** Sets the native colour input as the picker would, then settles on it. */
async function pickColour(picker: Locator, value: string) {
  await picker.evaluate((input: HTMLInputElement, colour) => {
    // The prototype's setter, so React sees the change on the input event.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, colour);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("a colour no text can be read on is flagged under the swatches", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.goto("/parametres?section=appearance");
  const editor = page.locator('[data-settings-screen="appearance"]');
  const warning = editor.getByText(
    "Sur cette couleur, le texte des boutons sera difficile à lire.",
  );
  await expect(warning).toHaveCount(0);
  // Events sent before hydration reach no React handler: pick again until
  // the editor has taken the colour.
  await expect(async () => {
    await pickColour(
      editor.getByLabel("Autre couleur", { exact: true }),
      "#c06000",
    );
    await expect(warning).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect
    .poll(async () => (await configuration()).appearance.accent)
    .toBe("#c06000");
  await editor.getByRole("radio", { name: "Orange", exact: true }).check();
  await expect(warning).toHaveCount(0);
});

test("guests cannot change the appearance", async () => {
  const original = await configuration();
  const response = await guest.put("/api/admin/config", {
    headers: mutationHeaders,
    data: { ...original, appearance: { theme: "light", accent: "#3e63dd" } },
  });
  expect(response.status()).toBe(403);
  expect((await guest.get("/api/admin/config")).status()).toBe(403);
  expect((await configuration()).appearance).toEqual(original.appearance);
});

test("the werewolf night still turns a light app moonlit blue", async ({
  page,
  context,
}) => {
  await setAppearance({ theme: "light", accent: "#3e63dd" });
  const players: APIRequestContext[] = [];
  const master = await newClient();
  try {
    const masterInvitation = await invite(host, "Appearance Game Master");
    await activate(master, masterInvitation.invitationUrl);
    for (const name of ["Night Ana", "Night Ben", "Night Céline"]) {
      const client = await newClient();
      players.push(client);
      await activate(client, (await invite(host, name)).invitationUrl);
    }
    const event = await createWerewolf(host, {
      title: "Loup-garou au clair de lune",
      gameMasterId: masterInvitation.guest.id,
    });
    for (const player of players)
      expect((await joinGame(player, event.id)).status()).toBe(200);
    const lobby = await gameFrom(master, event.id);
    const roles = await sendToGame(master, event.id, "PUT", "/roles", {
      revision: lobby.revision,
      roles: lobby.roles!.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        count: role.key === "villager" ? players.length : 0,
      })),
    });
    expect(roles.status()).toBe(200);
    const started = await sendToGame(master, event.id, "POST", "/state", {
      revision: (await roles.json()).revision,
      action: "start",
    });
    expect(started.status()).toBe(200);

    await shareSession(context, master);
    await page.goto(`/programme/${event.id}`);
    const indicator = page.locator(".navigation-indicator");
    await expect(page.locator("html")).toHaveAttribute("data-phase", "day");
    expect(await paint(page, indicator)).toEqual({
      background: lightBackground,
      fill: blue,
    });
    expect(
      (
        await sendToGame(master, event.id, "PUT", "/phase", { phase: "night" })
      ).status(),
    ).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-phase", "night");
    await expect.poll(() => paint(page, indicator)).toEqual(nightPaint);
    await capture(page, "light-werewolf-night.png");
    expect(
      (await host.delete(`/api/admin/programme/${event.id}`)).status(),
    ).toBe(204);
  } finally {
    await master.dispose();
    for (const player of players) await player.dispose();
  }
});

test("screens in the light theme and with a blue accent", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const created: number[] = [];
  const entries: number[] = [];
  const viewer = await guestPage(browser);
  try {
    const event = await host.post("/api/admin/programme", {
      data: {
        type: "event",
        title: "Apéro sur la terrasse",
        description: "On commence doucement, avec de quoi grignoter.",
        teaser: "",
        startsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        unlockAt: null,
        vote: null,
      },
    });
    expect(event.status()).toBe(201);
    created.push((await event.json()).id);
    const vote = await createVote(host, {
      title: "Le toast de la soirée",
      question: "Quel toast t’a le plus touché ?",
      source: { labels: ["Celui de Léa", "Celui de Max", "Celui de Sam"] },
    });
    created.push(vote.id);
    await setVoteStatus(host, vote.id, "open");
    const entry = await guest.post("/api/guestbook", {
      headers: mutationHeaders,
      data: { body: "Merci pour cette soirée lumineuse !", anonymous: false },
    });
    expect(entry.status()).toBe(201);
    entries.push((await entry.json()).id);

    await setAppearance({ theme: "light", accent: "#ff6a1f" });

    // The upload pill and its sheet, while the files are being prepared.
    let held = true;
    await viewer.route("**/api/uploads", async (route) => {
      const response = await route.fetch();
      if (!held || !response.ok()) return route.fulfill({ response });
      const data = await response.json();
      await route.fulfill({
        response,
        json: {
          items: data.items.map((job: Record<string, unknown>) => ({
            ...job,
            status: "processing",
            photo: null,
            errorCode: null,
          })),
        },
      });
    });
    await viewer.goto("/photos");
    await expect(viewer.locator("html")).toHaveAttribute("data-theme", "light");
    await viewer.waitForLoadState("networkidle");
    await viewer
      .getByLabel("Ajouter des médias", { exact: true })
      .setInputFiles(
        await Promise.all(
          ["#91729d", "#688b96"].map((color, index) =>
            canvasImage(viewer, { name: `light-${index + 1}.png`, color }),
          ),
        ),
      );
    const queue = viewer.getByRole("region", {
      name: "Envoi des médias",
      exact: true,
    });
    await expect(queue).toHaveAttribute("data-state", "preparing");
    await capture(viewer, "light-upload-pill.png");
    await openUploadDetails(viewer, queue);
    await expect(uploadSheet(viewer).locator(".upload-item")).toHaveCount(2);
    await capture(viewer, "light-upload-sheet.png");
    await closeUploadDetails(viewer);
    held = false;
    await viewer.unrouteAll({ behavior: "wait" });
    await expect
      .poll(
        async () => {
          await viewer.reload();
          return viewer.locator(".media-post img").count();
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await capture(viewer, "light-media.png");

    for (const [path, name] of [
      ["/programme", "light-schedule.png"],
      [`/programme/${vote.id}`, "light-vote.png"],
      ["/livre-d-or", "light-guestbook.png"],
      ["/profil", "light-profile.png"],
    ]) {
      await viewer.goto(path);
      await expect(viewer.locator(".navigation")).toBeVisible();
      await expectNoHorizontalOverflow(viewer);
      await capture(viewer, name);
    }

    await shareSession(context, host);
    await page.goto("/parametres");
    await capture(page, "light-settings.png");

    await setAppearance({ theme: "dark", accent: "#3e63dd" });
    await viewer.goto("/programme");
    await expect(viewer.locator("html")).toHaveAttribute("data-theme", "dark");
    await capture(viewer, "dark-blue-schedule.png");
  } finally {
    await viewer.context().close();
    for (const id of created) await host.delete(`/api/admin/programme/${id}`);
    for (const id of entries)
      await guest.delete(`/api/guestbook/${id}`, {
        headers: mutationHeaders,
      });
  }
});
