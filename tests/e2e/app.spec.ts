import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};
let admin: APIRequestContext;

function tokenFrom(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function invite(name: string) {
  const response = await admin.post("/api/admin/guests", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{
    guest: { id: number; name: string };
    invitationUrl: string;
  }>;
}

async function enter(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/photos$/);
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Hôte de test"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: process.env.BIRTHDAY_E2E_DATA_DIR,
        PUBLIC_URL: baseURL,
        COOKIE_SECURE: "false",
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const match = output.match(
    /http:\/\/localhost:3300\/invitation#token=[A-Za-z0-9_-]+/,
  );
  if (!match)
    throw new Error("Host bootstrap did not return an invitation URL.");
  admin = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  const accepted = await admin.post("/api/invitations/accept", {
    data: { token: tokenFrom(match[0]) },
  });
  expect(accepted.status()).toBe(200);
});

test.afterAll(async () => {
  await admin?.dispose();
});

test("private APIs and pages require an invitation; cross-origin changes are rejected", async ({
  page,
}) => {
  for (const path of [
    "/api/session",
    "/api/photos",
    "/api/programme",
    "/api/guestbook",
    "/api/party",
    "/api/admin/guests",
  ]) {
    expect((await page.request.get(path)).status()).toBe(401);
  }
  await page.goto("/photos");
  await expect(page).toHaveURL(/\/invitation/);
  const denied = await admin.post("/api/admin/guests", {
    data: { name: "Ne doit pas être créé" },
    headers: { Origin: "https://untrusted.example" },
  });
  expect(denied.status()).toBe(403);
});

test("a guest can activate once, use the four tabs, upload a photo and sign the guestbook", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite("Camille Test");
  const token = tokenFrom(invitation.invitationUrl);
  // Reading a preview must not consume the invitation.
  const preview = await page.request.post("/api/invitations/preview", {
    data: { token },
    headers: mutationHeaders,
  });
  expect(preview.status()).toBe(200);
  await enter(page, invitation.invitationUrl);
  expect(new URL(page.url()).hash).toBe("");
  const session = await page.request.get("/api/session");
  expect((await session.json()).guest.id).toBe(invitation.guest.id);
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.httpOnly)).toBeTruthy();
  const reused = await page.request.post("/api/invitations/accept", {
    data: { token },
    headers: mutationHeaders,
  });
  expect(reused.ok()).toBeFalsy();
  // Returning through the original message still works while the session is valid.
  await page.goto(invitation.invitationUrl);
  await expect(page).toHaveURL(/\/photos$/);

  for (const name of ["Médias", "Programme", "Livre d'or", "Paramètres"]) {
    await expect(
      page.getByRole("navigation").getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  const screenshot = await page.screenshot({ caret: "initial" });
  await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
    name: "souvenir-test.png",
    mimeType: "image/png",
    buffer: screenshot,
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/photos")).json()).items.length,
    )
    .toBeGreaterThan(0);
  const photos = await (await page.request.get("/api/photos")).json();
  const owned = photos.items.find(
    (photo: { author: { id: number } }) =>
      photo.author.id === invitation.guest.id,
  );
  expect(owned).toBeTruthy();
  expect((await page.request.get(owned.thumbnailUrl)).status()).toBe(200);
  const photoTile = page.getByRole("button", {
    name: /^Ouvrir la photo de Camille Test/,
  });
  await expect(photoTile).toBeVisible();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.screenshot({
    path: "test-results/photos-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await photoTile.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(photoTile).toBeFocused();

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Livre d'or", exact: true })
    .click();
  await page
    .getByLabel("Ton message", { exact: true })
    .fill("Un beau souvenir, signé depuis le test du parcours invité.");
  await page
    .getByRole("button", { name: "Publier le message", exact: true })
    .click();
  await expect(
    page.getByText(
      "Un beau souvenir, signé depuis le test du parcours invité.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.locator("article").getByText("Camille Test", { exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await (await page.request.get("/api/session")).json()).guest.id).toBe(
    invitation.guest.id,
  );
  await page.screenshot({
    path: "test-results/guestbook-mobile.png",
    fullPage: true,
    caret: "initial",
  });

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/programme-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Paramètres", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Paramètres", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Camille Test", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/guests")).status()).toBe(403);
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("configured media limits appear in the gallery and block oversized files before upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite("Taylor Upload Limit Test");
  await enter(page, invitation.invitationUrl);
  const response = await page.request.get("/api/photos");
  expect(response.status()).toBe(200);
  expect((await response.json()).limits).toEqual({
    imageBytes: 3 * 1024 * 1024,
    videoBytes: 5 * 1024 * 1024,
  });
  const privacy = page.locator(".photo-privacy");
  await expect(privacy).toContainText("Photos : JPEG, PNG, WebP, 3 Mo max.");
  await expect(privacy).toContainText(
    "Vidéos : MP4, MOV, WebM, 5 Mo et 5 minutes max.",
  );

  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/photos") && request.method() === "POST")
      uploads.push(request.url());
  });
  const image = Buffer.alloc(3 * 1024 * 1024 + 1);
  (await page.screenshot({ caret: "initial" })).copy(image);
  const video = Buffer.alloc(5 * 1024 * 1024 + 1);
  readFileSync("tests/fixtures/party-video.mp4").copy(video);
  await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles([
    { name: "over-image-limit.png", mimeType: "image/png", buffer: image },
    { name: "over-video-limit.mp4", mimeType: "video/mp4", buffer: video },
  ]);
  await expect(
    page.getByText("La photo dépasse 3 Mo. Choisis un fichier plus petit.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Cette vidéo dépasse 5 Mo. Choisis un fichier plus petit.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Réessayer l'envoi/ }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/media-runtime-limits-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  expect(uploads).toEqual([]);
});

test("a guest can upload, play, download and delete a video without loading originals in the gallery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite("Morgan Video Test");
  await enter(page, invitation.invitationUrl);
  const originals: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/photos\/\d+\/image$/.test(request.url()))
      originals.push(request.url());
  });
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/photos") &&
      response.request().method() === "POST",
  );
  await page
    .getByLabel("Ajouter des médias", { exact: true })
    .setInputFiles("tests/fixtures/party-video.mp4");
  const response = await uploaded;
  expect(response.status()).toBe(201);
  const media = await response.json();
  expect(media).toMatchObject({
    kind: "video",
    mimeType: "video/mp4",
    author: { id: invitation.guest.id },
  });
  const thumbnail = await page.request.get(media.thumbnailUrl);
  expect(thumbnail.status()).toBe(200);
  expect(thumbnail.headers()["content-type"]).toBe("image/jpeg");
  const tile = page.getByRole("button", {
    name: /^Ouvrir la vidéo de Morgan Video Test/,
  });
  await expect(tile).toBeVisible();
  await expect(tile.locator(".video-marker")).toBeVisible();
  expect(originals).toEqual([]);
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.screenshot({
    path: "test-results/media-video-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await tile.click();
  const dialog = page.getByRole("dialog");
  const player = dialog.locator("video");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("preload", "metadata");
  await expect(player).toHaveAttribute("poster", media.thumbnailUrl);
  expect(
    await player.evaluate((video: HTMLVideoElement) => ({
      paused: video.paused,
      autoplay: video.autoplay,
      controls: video.controls,
      playsInline: video.playsInline,
    })),
  ).toEqual({
    paused: true,
    autoplay: false,
    controls: true,
    playsInline: true,
  });
  const range = await page.request.get(media.url, {
    headers: { Range: "bytes=0-63" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-63\/\d+$/);
  expect((await range.body()).length).toBe(64);
  await player.evaluate((video: HTMLVideoElement) => video.play());
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0);
  const playingElement = await player.elementHandle();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(
    await playingElement!.evaluate((video: HTMLVideoElement) => video.paused),
  ).toBe(true);
  await expect(tile).toBeFocused();
  await tile.click();
  expect(await player.evaluate((video: HTMLVideoElement) => video.paused)).toBe(
    true,
  );
  const download = page.waitForEvent("download");
  await dialog.getByRole("link").click();
  expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
  await page.screenshot({
    path: "test-results/media-player-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/media-player-desktop.png",
    fullPage: true,
    caret: "initial",
  });
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog
    .getByRole("button", { name: "Supprimer le fichier", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(tile).toHaveCount(0);
  expect((await page.request.get(media.url)).status()).toBe(404);
  expect((await page.request.get(media.thumbnailUrl)).status()).toBe(404);
});

test("anonymous guestbook posts retain their draft on failure and stay anonymous after reloading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite("Noémie Anonymous Test");
  await enter(page, invitation.invitationUrl);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Livre d'or", exact: true })
    .click();
  const message = "Un souvenir anonyme conservé après un nouvel essai.";
  const input = page.getByLabel("Ton message", { exact: true });
  const anonymous = page.getByRole("checkbox", {
    name: "Publier anonymement",
    exact: true,
  });
  await expect(anonymous).not.toBeChecked();
  await input.fill(message);
  await anonymous.check();
  const requests: unknown[] = [];
  await page.route("**/api/guestbook", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      json: { code: "internal_error", error: "Try again." },
    });
  });
  await page
    .getByRole("button", { name: "Publier le message", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Messages des invités" })
      .getByRole("alert"),
  ).toBeVisible();
  expect(requests).toEqual([{ body: message, anonymous: true }]);
  await expect(input).toHaveValue(message);
  await expect(anonymous).toBeChecked();
  await page.unroute("**/api/guestbook");
  await page
    .getByRole("button", { name: "Publier le message", exact: true })
    .click();
  const entry = page.locator("article").filter({ hasText: message });
  await expect(entry.getByText("Anonyme", { exact: true })).toBeVisible();
  await expect(entry).not.toContainText(invitation.guest.name);
  await expect(input).toHaveValue("");
  await expect(anonymous).not.toBeChecked();
  const published = (
    await (await page.request.get("/api/guestbook")).json()
  ).items.find((item: { body: string }) => item.body === message);
  expect(published).toMatchObject({
    author: null,
    anonymous: true,
    canDelete: true,
  });
  await page.reload();
  await expect(entry.getByText("Anonyme", { exact: true })).toBeVisible();
  await expect(entry).not.toContainText(invitation.guest.name);
  await page.screenshot({
    path: "test-results/guestbook-anonymous-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/guestbook-anonymous-desktop.png",
    fullPage: true,
    caret: "initial",
  });
  page.once("dialog", (confirmation) => confirmation.accept());
  await entry
    .getByRole("button", { name: "Supprimer le message anonyme", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  const remaining = await (await page.request.get("/api/guestbook")).json();
  expect(
    remaining.items.some((item: { id: number }) => item.id === published.id),
  ).toBe(false);
});

test("scheduled secrets stay on the server and revocation protects media", async ({
  page,
}) => {
  const invitation = await invite("Alex Test");
  await enter(page, invitation.invitationUrl);
  const eventResponse = await admin.post("/api/admin/programme", {
    data: {
      title: "CONFIDENTIEL-TITRE-TEST",
      description: "CONFIDENTIEL-DESCRIPTION-TEST",
      teaser: "Une surprise à découvrir",
      startsAt: null,
      unlockAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  expect(eventResponse.status()).toBe(201);
  const event = await eventResponse.json();
  const programme = await page.request.get("/api/programme");
  const payload = await programme.text();
  expect(payload).not.toContain("CONFIDENTIEL");
  expect(payload).toContain("Une surprise à découvrir");
  await page.goto("/programme");
  await expect(
    page.getByText("Une surprise à découvrir", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/programme-desktop.png",
    fullPage: true,
    caret: "initial",
  });

  const unlocked = await admin.put(`/api/admin/programme/${event.id}`, {
    data: {
      title: "CONFIDENTIEL-TITRE-TEST",
      description: "CONFIDENTIEL-DESCRIPTION-TEST",
      teaser: "Une surprise à découvrir",
      startsAt: null,
      unlockAt: new Date(Date.now() - 1000).toISOString(),
    },
  });
  expect(unlocked.status()).toBe(200);
  await page.getByRole("button", { name: "Actualiser le programme" }).click();
  await expect(
    page.getByText("CONFIDENTIEL-TITRE-TEST", { exact: true }),
  ).toBeVisible();

  const image = await page.screenshot({ caret: "initial" });
  const upload = await page.request.post("/api/photos", {
    headers: mutationHeaders,
    multipart: {
      file: { name: "test.png", mimeType: "image/png", buffer: image },
    },
  });
  expect(upload.status()).toBe(201);
  const photo = await upload.json();
  expect((await page.request.get(photo.url)).status()).toBe(200);
  const revoked = await admin.delete(
    `/api/admin/guests/${invitation.guest.id}`,
  );
  expect(revoked.status()).toBe(204);
  expect((await page.request.get(photo.url)).status()).toBe(401);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await admin.delete(`/api/admin/programme/${event.id}`);
});

test("the host can manage party details, named invitations and scheduled events", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL,
    storageState: await admin.storageState(),
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Zurich",
    locale: "fr-CH",
  });
  const page = await context.newPage();
  await page.goto("/parametres");
  await page
    .getByLabel("Nom de la fête", { exact: true })
    .fill("Les 30 ans — fête de test");
  await page
    .getByRole("button", { name: "Enregistrer la fête", exact: true })
    .click();
  await expect(
    page.getByText("Les infos de la fête sont enregistrées.", { exact: true }),
  ).toBeVisible();
  expect((await (await admin.get("/api/party")).json()).title).toBe(
    "Les 30 ans — fête de test",
  );
  await page.locator("summary").filter({ hasText: "Les invités" }).click();
  await page
    .getByLabel("Prénom de l’invité", { exact: true })
    .fill("Invité créé depuis les paramètres");
  await page
    .getByRole("button", { name: "Créer l’invitation", exact: true })
    .click();
  await expect(
    page.getByText("Invité créé depuis les paramètres", { exact: true }),
  ).toBeVisible();
  const guests = await (await admin.get("/api/admin/guests")).json();
  expect(
    guests.items.some(
      (guest: { name: string }) =>
        guest.name === "Invité créé depuis les paramètres",
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/host-settings-desktop.png",
    fullPage: true,
    caret: "initial",
  });
  await page.locator("summary").filter({ hasText: "Le programme" }).click();
  await page
    .getByRole("button", { name: "Ajouter un événement", exact: true })
    .click();
  await page
    .getByLabel("Titre de l’événement", { exact: true })
    .fill("Rendez-vous créé par l’hôte");
  await page
    .getByLabel("Détails", { exact: true })
    .fill("Les détails secrets du rendez-vous.");
  await page
    .getByLabel("Indice visible en attendant", { exact: true })
    .fill("Gardez cette date !");
  await page
    .getByLabel("Début de l’événement", { exact: true })
    .fill("2030-06-01T19:00");
  await page
    .getByLabel("Dévoiler les détails le", { exact: true })
    .fill("2030-06-01T18:00");
  await page
    .getByRole("button", { name: "Enregistrer l’événement", exact: true })
    .click();
  await expect(
    page.getByText("Rendez-vous créé par l’hôte", { exact: true }),
  ).toBeVisible();
  const programme = await (await admin.get("/api/admin/programme")).json();
  const event = programme.items.find(
    (item: { title: string }) => item.title === "Rendez-vous créé par l’hôte",
  );
  expect(event.startsAt).toBe("2030-06-01T17:00:00Z");
  expect(event.unlockAt).toBe("2030-06-01T16:00:00Z");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await context.close();
});
