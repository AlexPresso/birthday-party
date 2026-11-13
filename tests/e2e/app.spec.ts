import { openSettingsSection } from "./support/settings";
import { acceptConfirmation } from "./support/confirm";
import { reconnectRealtime } from "./support/realtime";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  baseURL,
  bootstrapHost,
  invitationToken,
  invite,
  mutationHeaders,
} from "./support/party";
import { readFileSync } from "node:fs";

let admin: APIRequestContext;

async function enter(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/photos$/);
}

async function completedMedia(client: APIRequestContext, id: number) {
  let job: { status: string; errorCode?: string; photo?: { id: number } } = {
    status: "queued",
  };
  await expect
    .poll(
      async () => {
        const response = await client.get(`/api/uploads/${id}`);
        expect(response.status()).toBe(200);
        job = await response.json();
        expect(
          job.status,
          job.errorCode ?? "Media preparation failed",
        ).not.toBe("failed");
        return job.status;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  expect(job.photo).toBeTruthy();
  return job.photo;
}

test.beforeAll(async () => {
  admin = await bootstrapHost("Hôte de test");
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
    "/api/uploads",
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

test("a guest can activate once, use the tabs and profile, upload a photo and sign the guestbook", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Camille Test");
  const token = invitationToken(invitation.invitationUrl);
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

  for (const name of ["Programme", "Médias", "Livre d'or"]) {
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
  await expect(page.locator(".upload-queue")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("photos-mobile.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
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
  await expect(page.getByLabel("Ton message", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("guestbook-mobile.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
    caret: "initial",
  });

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("programme-mobile.png"),
    fullPage: true,
    caret: "initial",
  });
  await page
    .getByRole("link", { name: "Profil: Camille Test", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Profil", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Camille Test", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/guests")).status()).toBe(403);
  await page.screenshot({
    path: test.info().outputPath("settings-mobile.png"),
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
  const invitation = await invite(admin, "Taylor Upload Limit Test");
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
  await page
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
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
    path: test.info().outputPath("media-runtime-limits-mobile.png"),
    fullPage: true,
    caret: "initial",
  });
  for (const name of ["over-image-limit.png", "over-video-limit.mp4"]) {
    await page
      .getByRole("button", { name: `Retirer ${name} de la liste`, exact: true })
      .click();
  }
  expect(uploads).toEqual([]);
});

test("media transfers survive tab changes and accepted jobs return after reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Queue Navigation Test");
  await enter(page, invitation.invitationUrl);
  const image = await page.screenshot({ caret: "initial" });
  let releaseTransfer!: () => void;
  const transferHeld = new Promise<void>((resolve) => {
    releaseTransfer = resolve;
  });
  let transferStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    transferStarted = resolve;
  });
  // Hold the request before reception to exercise navigation with a live File and XHR.
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    transferStarted();
    await transferHeld;
    await route.fulfill({ response: await route.fetch() });
  });
  let showPending = true;
  // Keep the browser at the accepted stage while the real worker finishes.
  await page.route("**/api/uploads", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        items: data.items.map((job: Record<string, unknown>) =>
          showPending
            ? { ...job, status: "processing", photo: null, errorCode: null }
            : job,
        ),
      },
    });
  });
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/photos") &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
    name: "queue-navigation.png",
    mimeType: "image/png",
    buffer: image,
  });
  await started;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true }),
  ).toBeVisible();
  const queue = page.getByRole("region", {
    name: "Envoi des médias",
    exact: true,
  });
  await expect(queue).toContainText("Envoi en cours");
  await expect(
    queue.getByRole("button", { name: "Détail des envois", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  releaseTransfer();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const acceptedJob = await response.json();
  expect(acceptedJob.clientUploadId).toBeTruthy();
  await expect(queue).toContainText("Préparation…");
  await queue
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  const row = page
    .locator(".upload-item")
    .filter({ hasText: "queue-navigation.png" });
  await expect(row).toContainText("Enregistrement…");
  await expect(row).not.toContainText("Ajouté");
  await expect(
    page.getByText(
      "Tes fichiers sont reçus. Tu peux fermer l’application pendant leur préparation.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("upload-queue-mobile.png"),
    fullPage: true,
    caret: "initial",
  });
  await page.reload();
  await queue
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  await expect(row).toContainText("Enregistrement…");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("upload-queue-desktop.png"),
    fullPage: true,
    caret: "initial",
  });
  await completedMedia(page.request, acceptedJob.id);
  showPending = false;
  // The mocked completion becomes visible on an explicit resync, without polling.
  await reconnectRealtime(page);
  await expect(row).toContainText("Ajouté", { timeout: 15_000 });
  await expect(queue.getByRole("progressbar")).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Masquer le détail", exact: true })
    .click();
  await page.keyboard.press("Tab");
  await expect(queue).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Médias", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^Ouvrir la photo de Queue Navigation Test/,
    }),
  ).toHaveCount(1);
  const ownJobs = await (await page.request.get("/api/uploads")).json();
  expect(ownJobs.items).toHaveLength(1);
  expect(ownJobs.items[0].id).toBe(acceptedJob.id);
});

test("compact upload notice waits for preparation, keeps new batches and errors, then dismisses success", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Upload Notice Test");
  await enter(page, invitation.invitationUrl);
  await page.clock.install();
  const image = await page.screenshot({ caret: "initial" });
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let started = 0;
  let preparing = true;
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const index = started++;
    if (index === 2) return route.abort("failed");
    if (index < gates.length) await gates[index].promise;
    await route.fulfill({ response: await route.fetch() });
  });
  await page.route("**/api/uploads", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        items: data.items.map((job: Record<string, unknown>) =>
          preparing
            ? { ...job, status: "processing", photo: null, errorCode: null }
            : job,
        ),
      },
    });
  });
  const queue = page.getByRole("region", {
    name: "Envoi des médias",
    exact: true,
  });
  const input = page.getByLabel("Ajouter des médias", { exact: true });
  const details = queue.getByRole("button", {
    name: "Détail des envois",
    exact: true,
  });
  try {
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/photos") &&
        response.request().method() === "POST",
    );
    await input.setInputFiles({
      name: "notice-first.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect.poll(() => started).toBe(1);
    await expect(queue).toHaveAttribute("data-state", "sending");
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(
      queue.getByText("notice-first.png", { exact: true }),
    ).toBeHidden();
    await expect(queue.getByRole("progressbar")).toHaveCount(1);
    await expect(queue.locator(".upload-progress-count")).toHaveText(
      "0 / 1 fichier envoyé",
    );
    const bannerBounds = await queue.boundingBox();
    const navigationBounds = await page.getByRole("navigation").boundingBox();
    expect(bannerBounds!.x).toBeGreaterThanOrEqual(16);
    expect(bannerBounds!.y + bannerBounds!.height).toBeLessThanOrEqual(
      navigationBounds!.y - 8,
    );
    await page.screenshot({
      path: test.info().outputPath("upload-notice-390.png"),
      style:
        "*, *::before, *::after { transition: none !important; animation: none !important; } nextjs-portal { visibility: hidden; }",
    });
    gates[0].resolve();
    const firstJob = await (await accepted).json();
    await expect(queue).toHaveAttribute("data-state", "preparing");
    await expect(queue).toContainText("Préparation…");
    await expect(queue.locator(".upload-progress-count")).toHaveText(
      "1 / 1 fichier envoyé",
    );
    await page.clock.fastForward(3_000);
    await expect(queue).toHaveAttribute("data-state", "preparing");
    await expect(queue).not.toContainText("1 fichier ajouté");
    await completedMedia(page.request, firstJob.id);
    preparing = false;
    await reconnectRealtime(page);
    await expect(queue).toHaveAttribute("data-state", "complete");
    await expect(queue).toContainText("1 fichier ajouté");
    await expect(queue.getByRole("progressbar")).toHaveCount(0);

    // A second selection before dismissal must cancel the first success timer.
    await input.setInputFiles({
      name: "notice-second.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect.poll(() => started).toBe(2);
    await expect(queue).toHaveAttribute("data-state", "sending");
    await page.clock.fastForward(3_000);
    await expect(queue).toBeVisible();
    await expect(queue.locator(".upload-progress-count")).toHaveText(
      "1 / 2 fichiers envoyés",
    );
    gates[1].resolve();
    await expect(queue).toContainText("2 fichiers ajoutés");
    await expect(queue.getByRole("progressbar")).toHaveCount(0);
    await expect(queue).toHaveCount(0);
    await page.reload();
    await expect(queue).toHaveCount(0);

    await input.setInputFiles({
      name: "notice-retry.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(queue).toHaveAttribute("data-state", "error");
    await expect(queue).toContainText("1 fichier à réessayer");
    await page.clock.fastForward(3_000);
    await expect(queue).toBeVisible();
    await details.press("Enter");
    const closeDetails = queue.getByRole("button", {
      name: "Masquer le détail",
      exact: true,
    });
    await expect(closeDetails).toBeFocused();
    await expect(
      queue.getByText("notice-retry.png", { exact: true }),
    ).toBeVisible();
    await expect(queue).toContainText(
      "L'envoi s'est interrompu. Vérifie ta connexion et réessaie.",
    );
    await closeDetails.press("Enter");
    await expect(details).toBeFocused();
    await queue.getByRole("button", { name: "Réessayer", exact: true }).click();
    // Move focus off the retry control; the page title is visually hidden.
    await page.getByRole("banner").locator("strong").click();
    await expect(queue).toContainText("1 fichier ajouté");
    await expect.poll(() => started).toBe(4);
    await expect(queue).toHaveCount(0);
  } finally {
    for (const gate of gates) gate.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("one upload progress bar counts queued files and realtime receipts without duplicates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Aggregate Upload Progress Test");
  await enter(page, invitation.invitationUrl);
  const image = await page.screenshot({ caret: "initial" });
  const reception = Array.from({ length: 3 }, () =>
    Promise.withResolvers<void>(),
  );
  const firstResponse = Promise.withResolvers<void>();
  let started = 0;
  // Keep preparation pending so this test observes receipt progress independently of completion dismissal.
  await page.route("**/api/uploads", async (route) => {
    const response = await route.fetch();
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
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const index = started++;
    await reception[index].promise;
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    // Let realtime confirm the first receipt while its original XHR stays open.
    if (index === 0) await firstResponse.promise;
    await route.fulfill({ response });
  });

  try {
    await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles(
      ["first", "second", "third"].map((name) => ({
        name: `aggregate-${name}.png`,
        mimeType: "image/png",
        buffer: image,
      })),
    );
    const queue = page.getByRole("region", {
      name: "Envoi des médias",
      exact: true,
    });
    const bar = queue.getByRole("progressbar", {
      name: "Progression des envois",
      exact: true,
    });
    const count = queue.locator(".upload-progress-count");
    await expect.poll(() => started).toBe(2);
    await expect(queue.getByRole("progressbar")).toHaveCount(1);
    await expect(bar).toHaveAttribute("max", "100");
    await expect(count).toHaveText("0 / 3 fichiers envoyés");
    await queue
      .getByRole("button", { name: "Détail des envois", exact: true })
      .click();
    await expect(
      queue.locator(".upload-item").filter({ hasText: "aggregate-third.png" }),
    ).toContainText("En attente");

    reception[0].resolve();
    await expect(count).toHaveText("1 / 3 fichiers envoyés");
    await expect(queue.locator(".upload-item")).toHaveCount(3);
    expect(started).toBe(2);
    const progress = Number(await bar.getAttribute("value"));
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(100);

    for (const { width, height, name } of [
      { width: 320, height: 740, name: "mobile-320" },
      { width: 1440, height: 1000, name: "desktop" },
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await expect(bar).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`upload-progress-${name}.png`),
        fullPage: true,
        caret: "initial",
      });
    }

    firstResponse.resolve();
    await expect.poll(() => started).toBe(3);
    await expect(count).toHaveText("1 / 3 fichiers envoyés");
    reception[1].resolve();
    reception[2].resolve();
    await expect(count).toHaveText("3 / 3 fichiers envoyés");
    await expect(bar).toHaveAttribute("value", "100");
    await expect(queue.getByRole("progressbar")).toHaveCount(1);
    await expect(queue.locator(".upload-item")).toHaveCount(3);

    await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
      name: "aggregate-empty.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(0),
    });
    const invalid = queue
      .locator(".upload-item")
      .filter({ hasText: "aggregate-empty.png" });
    await expect(invalid).toContainText(
      "Ce fichier est vide. Choisis un autre fichier.",
    );
    await expect(count).toHaveText("3 / 4 fichiers envoyés");
    await expect(bar).toHaveAttribute("value", "75");
    expect(started).toBe(3);
    await invalid
      .getByRole("button", {
        name: "Retirer aggregate-empty.png de la liste",
        exact: true,
      })
      .click();
    await expect(count).toHaveText("3 / 3 fichiers envoyés");
    await expect(bar).toHaveAttribute("value", "100");

    const jobs = await (await page.request.get("/api/uploads")).json();
    expect(jobs.items).toHaveLength(3);
    expect(
      new Set(
        jobs.items.map((job: { clientUploadId: string }) => job.clientUploadId),
      ).size,
    ).toBe(3);
  } finally {
    for (const gate of reception) gate.resolve();
    firstResponse.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("retrying a lost upload response reuses its receipt without duplicating media", async ({
  page,
}) => {
  const invitation = await invite(admin, "Queue Retry Test");
  await enter(page, invitation.invitationUrl);
  const image = await page.screenshot({ caret: "initial" });
  const keys: string[] = [];
  let firstJobId = 0;
  // Delay automatic receipt recovery so this case still exercises an explicit retry.
  await page.route("**/api/uploads", async (route) => {
    if (keys.length < 2) return route.fulfill({ json: { items: [] } });
    await route.continue();
  });
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["x-upload-id"]);
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    if (keys.length === 1) {
      firstJobId = (await response.json()).id;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
    name: "lost-response.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  await expect(
    page.getByText(
      "L'envoi s'est interrompu. Vérifie ta connexion et réessaie.",
    ),
  ).toBeVisible();
  const queue = page.locator(".upload-queue");
  await expect(queue.locator(".upload-progress-count")).toHaveText(
    "0 / 1 fichier envoyé",
  );
  await expect(queue.getByRole("progressbar")).toHaveCount(1);
  expect(
    Number(await queue.getByRole("progressbar").getAttribute("value")),
  ).toBeLessThan(100);
  await page
    .getByRole("button", { name: "Réessayer l'envoi de lost-response.png" })
    .click();
  await expect(
    page.locator(".upload-item").filter({ hasText: "lost-response.png" }),
  ).toContainText("Ajouté", { timeout: 15_000 });
  await expect(queue).toContainText("1 fichier ajouté");
  await expect(queue.getByRole("progressbar")).toHaveCount(0);
  await expect(queue.locator(".upload-item")).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const jobs = await (await page.request.get("/api/uploads")).json();
  expect(jobs.items).toHaveLength(1);
  expect(jobs.items[0].id).toBe(firstJobId);
  const photos = await (await page.request.get("/api/photos")).json();
  expect(
    photos.items.filter(
      (photo: { author: { id: number } }) =>
        photo.author.id === invitation.guest.id,
    ),
  ).toHaveLength(1);
});

test("failed preparation uses a new receipt on retry and asks for the file after reload", async ({
  page,
}) => {
  const invitation = await invite(admin, "Queue Failed Video Test");
  await enter(page, invitation.invitationUrl);
  const keys: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/photos") && request.method() === "POST")
      keys.push(request.headers()["x-upload-id"]);
  });
  const firstResponse = Promise.withResolvers<void>();
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const first = route.request().headers()["x-upload-id"] === keys[0];
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    // Realtime can expose preparation failure before the original XHR returns.
    if (first) await firstResponse.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel("Ajouter des médias", { exact: true }).setInputFiles({
      name: "incomplete-video.mp4",
      mimeType: "video/mp4",
      buffer: readFileSync("tests/fixtures/party-video.mp4").subarray(0, 32),
    });
    await page
      .getByRole("button", { name: "Détail des envois", exact: true })
      .click();
    const retry = page.getByRole("button", {
      name: "Réessayer l'envoi de incomplete-video.mp4",
    });
    await expect(retry).toBeVisible();
    await expect(page.locator(".upload-item")).not.toContainText("Ajouté");
    await retry.click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).not.toBe(keys[0]);
    await expect(retry).toBeVisible();
    await expect(page.locator(".upload-item")).toHaveCount(1);
    const delayedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/photos") &&
        response.request().method() === "POST" &&
        response.request().headers()["x-upload-id"] === keys[0],
    );
    firstResponse.resolve();
    expect((await delayedResponse).status()).toBe(202);
    await expect(page.locator(".upload-item")).toHaveCount(1);
    await expect(retry).toHaveCount(1);
    const jobs = await (await page.request.get("/api/uploads")).json();
    expect(jobs.items).toHaveLength(2);
    expect(
      jobs.items.every((job: { status: string }) => job.status === "failed"),
    ).toBe(true);
    await page.reload();
    await page
      .getByRole("button", { name: "Détail des envois", exact: true })
      .click();
    await expect(
      page.getByText("Choisis à nouveau ce fichier pour le renvoyer."),
    ).toHaveCount(1);
    await expect(page.locator(".upload-item")).toHaveCount(1);
    await expect(retry).toHaveCount(0);
  } finally {
    firstResponse.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a guest can upload, play, download and delete a video without loading originals in the gallery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Morgan Video Test");
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
  expect(response.status()).toBe(202);
  const media = await completedMedia(page.request, (await response.json()).id);
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
  await expect(page.locator(".upload-queue")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("media-video-mobile.png"),
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
  await expect(dialog.getByRole("link")).toHaveAttribute(
    "href",
    `${media.url}?download=1`,
  );
  await dialog.getByRole("link").click();
  const original = await download;
  expect(original.suggestedFilename()).toBe(`media-${media.id}.mp4`);
  const downloadedPath = await original.path();
  expect(downloadedPath).not.toBeNull();
  expect(readFileSync(downloadedPath!)).toEqual(
    readFileSync("tests/fixtures/party-video.mp4"),
  );
  await page.screenshot({
    path: test.info().outputPath("media-player-mobile.png"),
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("media-player-desktop.png"),
    fullPage: true,
    caret: "initial",
  });
  await dialog
    .getByRole("button", { name: "Supprimer le fichier", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(dialog).toBeHidden();
  await expect(tile).toHaveCount(0);
  expect((await page.request.get(media.url)).status()).toBe(404);
  expect((await page.request.get(`${media.url}?download=1`)).status()).toBe(
    404,
  );
  expect((await page.request.get(media.thumbnailUrl)).status()).toBe(404);
});

test("anonymous guestbook posts retain their draft on failure and stay anonymous after reloading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite(admin, "Noémie Anonymous Test");
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
    page.getByRole("form", { name: "Laisse un message" }).getByRole("alert"),
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
    path: test.info().outputPath("guestbook-anonymous-mobile.png"),
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
    path: test.info().outputPath("guestbook-anonymous-desktop.png"),
    fullPage: true,
    caret: "initial",
  });
  await entry.locator(".entry-actions > summary").click();
  await entry
    .getByRole("button", { name: "Supprimer le message anonyme", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(entry).toHaveCount(0);
  const remaining = await (await page.request.get("/api/guestbook")).json();
  expect(
    remaining.items.some((item: { id: number }) => item.id === published.id),
  ).toBe(false);
});

test("scheduled secrets stay on the server and revocation protects media", async ({
  page,
}) => {
  const invitation = await invite(admin, "Alex Test");
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
    path: test.info().outputPath("programme-desktop.png"),
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
  expect(upload.status()).toBe(202);
  const photo = await completedMedia(page.request, (await upload.json()).id);
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
  await openSettingsSection(page, "party");
  await page
    .getByLabel("Nom de la fête", { exact: true })
    .fill("Les 30 ans — fête de test");
  await page.getByLabel("Nom de la fête", { exact: true }).blur();
  await expect(
    page.getByText("Les infos de la fête sont enregistrées.", { exact: true }),
  ).toBeVisible();
  expect((await (await admin.get("/api/party")).json()).title).toBe(
    "Les 30 ans — fête de test",
  );
  await openSettingsSection(page, "guests");
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
    path: test.info().outputPath("host-settings-desktop.png"),
    fullPage: true,
    caret: "initial",
  });
  await openSettingsSection(page, "programme");
  await page
    .getByRole("button", { name: "Ajouter un événement", exact: true })
    .click();
  await page.getByRole("button", { name: /^Événement/ }).click();
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
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
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
  await expect(async () => {
    await expect(
      page.getByRole("heading", { name: "Programme", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Rendez-vous créé par l’hôte", { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator("html")
        .evaluate(
          (documentElement) => documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBeTruthy();
  }).toPass();
  await context.close();
});
