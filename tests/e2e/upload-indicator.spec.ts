import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  bootstrapHost,
  expectNoHorizontalOverflow,
  signInGuest,
} from "./support/party";
import { canvasImage } from "./support/images";
import { reconnectRealtime } from "./support/realtime";
import {
  closeUploadDetails,
  openUploadDetails,
  restingBox,
  uploadSheet,
} from "./support/uploads";

let host: APIRequestContext;

// Twice the pixels keep the 34px ring readable in the review screenshots.
test.use({ locale: "fr-CH", deviceScaleFactor: 2 });

test.beforeAll(async () => {
  host = await bootstrapHost("Hôte des envois");
});

test.afterAll(async () => {
  await host?.dispose();
});

const viewports = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
];
const colors = ["#91729d", "#688b96", "#b8734f", "#5f8a63", "#a8904e"];

function queueOf(page: Page) {
  return page.getByRole("region", { name: "Envoi des médias", exact: true });
}

/**
 * Opens the gallery and waits for its realtime socket. The socket opens from
 * an effect, so the page is hydrated: a file chosen earlier would be handled
 * before the development build's second effect pass, which clears previews.
 */
async function openGallery(page: Page) {
  const ready = new Promise<void>((resolve) => {
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname !== "/api/realtime") return;
      socket.on("framereceived", ({ payload }) => {
        if (JSON.parse(payload.toString()).type === "ready") resolve();
      });
    });
  });
  await page.goto("/photos");
  await ready;
}

function files(page: Page, prefix: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      canvasImage(page, {
        name: `${prefix}-${index + 1}.png`,
        color: colors[index % colors.length],
      }),
    ),
  );
}

/** Shows accepted files as still being prepared until the returned release. */
async function holdPreparation(page: Page) {
  let held = true;
  await page.route("**/api/uploads", async (route) => {
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
  return async () => {
    // The real workers must be done before the browser may see their result.
    await expect
      .poll(
        async () => {
          const jobs = await (await page.request.get("/api/uploads")).json();
          return jobs.items.every(
            (job: { status: string }) => job.status === "ready",
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    held = false;
    await reconnectRealtime(page);
  };
}

/** Holds each transfer before the server receives it, in starting order. */
async function gateTransfers(page: Page, count: number) {
  const gates = Array.from({ length: count }, () =>
    Promise.withResolvers<void>(),
  );
  let started = 0;
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await gates[started++]?.promise;
    await route.fulfill({ response: await route.fetch() });
  });
  return { gates, started: () => started };
}

/** The pill sits above the dock, inside the 20px side gutters. */
async function expectAboveDock(page: Page, queue: Locator) {
  await restingBox(queue);
  const bounds = (await queue.locator(".upload-pill").boundingBox())!;
  const dock = (await page.getByRole("navigation").boundingBox())!;
  const { width } = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(20);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 20);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(dock.y - 8);
  expect(
    Math.abs(bounds.x + bounds.width / 2 - (dock.x + dock.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
}

/** Captures the pill with the dock below it, for the design review. */
async function capturePill(
  page: Page,
  pill: Locator,
  name: string,
  settle = true,
) {
  // Let the pill's entrance and the ring's arc come to rest.
  if (settle) await page.waitForTimeout(400);
  const bounds = (await pill.boundingBox())!;
  const viewport = page.viewportSize()!;
  const width = Math.min(viewport.width, 460);
  const top = Math.max(0, bounds.y - 70);
  await page.screenshot({
    path: test.info().outputPath(name),
    clip: {
      x: Math.max(
        0,
        Math.min(
          viewport.width - width,
          bounds.x + bounds.width / 2 - width / 2,
        ),
      ),
      y: top,
      width,
      height: viewport.height - top,
    },
    style: "nextjs-portal { visibility: hidden; }",
  });
}

for (const viewport of viewports) {
  test(`the pill follows a batch from sending to done at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signInGuest(host, page, `Pill Batch ${viewport.width}`);
    await openGallery(page);
    const release = await holdPreparation(page);
    const transfers = await gateTransfers(page, 5);
    const queue = queueOf(page);
    const pill = queue.locator(".upload-pill");
    const text = queue.locator(".upload-pill-text");
    const ring = queue.getByRole("progressbar", {
      name: "Progression des envois",
      exact: true,
    });
    const toggle = queue.getByRole("button", {
      name: "Détail des envois",
      exact: true,
    });
    try {
      await page
        .getByLabel("Ajouter des médias", { exact: true })
        .setInputFiles(await files(page, "batch", 5));
      await expect.poll(transfers.started).toBe(2);
      await expect(queue).toHaveAttribute("data-state", "sending");
      await expect(text).toHaveText("0 / 5");
      transfers.gates[0].resolve();
      await expect(text).toHaveText("1 / 5");
      await expect(queue.getByRole("status")).toHaveText(
        "Envoi en cours. 1 / 5 fichiers envoyés",
      );
      const sending = Number(await ring.getAttribute("aria-valuenow"));
      expect(sending).toBeGreaterThanOrEqual(20);
      expect(sending).toBeLessThan(100);
      // A file being sent lends its local preview to the ring.
      await expect(ring.locator("img")).toHaveAttribute("src", /^blob:/);
      await expectAboveDock(page, queue);
      await expectNoHorizontalOverflow(page);
      await capturePill(page, pill, `pill-sending-${viewport.width}.png`);

      await openUploadDetails(page, queue);
      const sheet = uploadSheet(page);
      await expect(sheet.locator(".upload-item")).toHaveCount(5);
      await expect(
        sheet.getByText(
          "Garde l’application ouverte pendant l’envoi des fichiers.",
        ),
      ).toBeVisible();
      const sheetBounds = await restingBox(sheet);
      if (viewport.width >= 960) {
        // A compact dialog, centered above the dock.
        const dock = (await page.getByRole("navigation").boundingBox())!;
        expect(sheetBounds.width).toBeLessThanOrEqual(420);
        expect(sheetBounds.y + sheetBounds.height).toBeLessThanOrEqual(
          dock.y - 8,
        );
        expect(
          Math.abs(sheetBounds.x + sheetBounds.width / 2 - viewport.width / 2),
        ).toBeLessThanOrEqual(1);
        await expect(sheet.locator(".upload-sheet-handle")).toBeHidden();
      } else {
        // A sheet across the screen, resting on its bottom edge.
        expect(sheetBounds.x).toBe(0);
        expect(sheetBounds.width).toBe(viewport.width);
        expect(sheetBounds.y + sheetBounds.height).toBe(viewport.height);
        await expect(sheet.locator(".upload-sheet-handle")).toBeVisible();
      }
      await page.screenshot({
        path: test.info().outputPath(`details-${viewport.width}.png`),
        style:
          "*, *::before, *::after { animation: none !important; } nextjs-portal { visibility: hidden; }",
      });
      await closeUploadDetails(page);
      await expect(toggle).toBeFocused();

      for (const gate of transfers.gates) gate.resolve();
      await expect(queue).toHaveAttribute("data-state", "preparing");
      await expect(text).toHaveText("Préparation…");
      await expect(queue.getByRole("status")).toHaveText(
        "Préparation…. 5 / 5 fichiers envoyés",
      );
      await expect(ring).toHaveAttribute("aria-valuenow", "100");
      await expectAboveDock(page, queue);
      await capturePill(page, pill, `pill-preparing-${viewport.width}.png`);

      await release();
      const burst = queue.locator(".upload-burst");
      await expect(burst).toHaveCount(1);
      // Freeze the particles in flight: the whole burst lasts under a second
      // and the pill leaves two seconds after completing.
      await burst.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 320;
        }
      });
      await capturePill(
        page,
        pill,
        `pill-complete-burst-${viewport.width}.png`,
        false,
      );
      await burst.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true }))
          animation.finish();
      });
      await capturePill(
        page,
        pill,
        `pill-complete-${viewport.width}.png`,
        false,
      );
      await expect(queue).toHaveAttribute("data-state", "complete");
      await expect(text).toHaveText("5 fichiers ajoutés");
      await expect(ring).toHaveCount(0);
      await expect(burst.locator("span")).toHaveCount(10);
      await expect(burst).toHaveAttribute("aria-hidden", "true");
      expect(
        await burst.evaluate(
          (element) => getComputedStyle(element).pointerEvents,
        ),
      ).toBe("none");
      // Success leaves by itself.
      await expect(queue).toHaveCount(0);
    } finally {
      for (const gate of transfers.gates) gate.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test(`a failed transfer keeps the pill and its retry control at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signInGuest(host, page, `Pill Failure ${viewport.width}`);
    await openGallery(page);
    let attempts = 0;
    await page.route("**/api/photos", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (attempts++ === 0) return route.abort("failed");
      await route.continue();
    });
    const queue = queueOf(page);
    const pill = queue.locator(".upload-pill");
    const retry = queue.getByRole("button", { name: "Réessayer", exact: true });
    try {
      await page
        .getByLabel("Ajouter des médias", { exact: true })
        .setInputFiles(await files(page, "failure", 1));
      await expect(queue).toHaveAttribute("data-state", "error");
      await expect(queue.locator(".upload-pill-text")).toHaveText(
        "1 fichier à réessayer",
      );
      await expect(queue.getByRole("status")).toHaveText(
        "1 fichier à réessayer. 0 / 1 fichier envoyé",
      );
      await expect(retry).toBeVisible();
      // A failure never leaves on its own.
      await page.waitForTimeout(2_600);
      await expect(queue).toHaveAttribute("data-state", "error");
      await expect(retry).toBeVisible();
      await expectAboveDock(page, queue);
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await capturePill(page, pill, `pill-failed-${viewport.width}.png`);

      await openUploadDetails(page, queue);
      await expect(uploadSheet(page)).toContainText(
        "L'envoi s'est interrompu. Vérifie ta connexion et réessaie.",
      );
      await page.screenshot({
        path: test.info().outputPath(`details-failed-${viewport.width}.png`),
        style:
          "*, *::before, *::after { animation: none !important; } nextjs-portal { visibility: hidden; }",
      });
      await closeUploadDetails(page);

      await retry.click();
      // Move focus off the pill; the page title is visually hidden.
      await page.getByRole("banner").locator("strong").click();
      await expect(queue.locator(".upload-pill-text")).toHaveText(
        "1 fichier ajouté",
      );
      expect(attempts).toBe(2);
      await expect(queue).toHaveCount(0);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("the details sheet covers the page, closes every way and returns focus to the pill", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInGuest(host, page, "Pill Sheet Test");
  await openGallery(page);
  const release = await holdPreparation(page);
  const queue = queueOf(page);
  const sheet = uploadSheet(page);
  const toggle = queue.getByRole("button", {
    name: "Détail des envois",
    exact: true,
  });
  const input = page.getByLabel("Ajouter des médias", { exact: true });
  try {
    // Removing the last file closes the sheet with the queue.
    await input.setInputFiles({
      name: "sheet-empty.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(0),
    });
    await expect(queue).toHaveAttribute("data-state", "error");
    await expect(
      queue.getByRole("button", { name: "Réessayer", exact: true }),
    ).toHaveCount(0);
    await openUploadDetails(page, queue);
    await sheet
      .getByRole("button", {
        name: "Retirer sheet-empty.png de la liste",
        exact: true,
      })
      .click();
    await expect(sheet).toHaveCount(0);
    await expect(queue).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await input.setInputFiles(await files(page, "sheet", 1));
    await expect(queue).toHaveAttribute("data-state", "preparing");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-haspopup", "dialog");

    // Keyboard: Enter opens, focus enters the sheet, Escape gives it back.
    await toggle.press("Enter");
    await expect(sheet).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      sheet.getByRole("button", { name: "Masquer le détail", exact: true }),
    ).toBeFocused();
    await expect(
      sheet.getByRole("heading", { name: "Détail des envois", exact: true }),
    ).toBeVisible();
    await expect(sheet.locator(".upload-item")).toHaveText([
      /sheet-1\.png\s*Enregistrement…/,
    ]);
    await expect(
      sheet.getByText(
        "Tes fichiers sont reçus. Tu peux fermer l’application pendant leur préparation.",
      ),
    ).toBeVisible();
    // The page behind is inert: the modal's backdrop takes every pointer.
    expect(
      await sheet.evaluate(
        (dialog) =>
          dialog.matches(":modal") &&
          document.elementFromPoint(20, 20) === dialog &&
          document.body.style.overflow === "hidden",
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    // A tap on the backdrop.
    await openUploadDetails(page, queue);
    await page.mouse.click(195, 60);
    await expect(sheet).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // A short pull on the grab handle springs back; a long one closes.
    await openUploadDetails(page, queue);
    const header = (await sheet.locator(".upload-sheet-header").boundingBox())!;
    const grab = { x: header.x + header.width / 2, y: header.y + 10 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await expect
      .poll(() =>
        sheet.evaluate((dialog) => dialog.getBoundingClientRect().bottom),
      )
      .toBe(844);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // Completion under the open sheet keeps the pill, and plays one burst.
    await openUploadDetails(page, queue);
    await release();
    await expect(queue).toHaveAttribute("data-state", "complete");
    await expect(sheet.locator(".upload-item")).toHaveText([
      /sheet-1\.png\s*Ajouté/,
    ]);
    const burst = queue.locator(".upload-burst");
    await expect(burst).toHaveCount(1);
    await burst.evaluate((element) => {
      (element as HTMLElement).dataset.seen = "true";
    });
    // The same state delivered again must not start another burst.
    await reconnectRealtime(page);
    await page.waitForTimeout(2_600);
    await expect(sheet).toBeVisible();
    await expect(queue.locator(".upload-burst[data-seen]")).toHaveCount(1);
    expect(
      await burst.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    ).toBe(true);
    await closeUploadDetails(page);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(queue).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("reduced motion shows no burst, a still ring and a sheet that does not slide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInGuest(host, page, "Pill Reduced Motion Test");
  await openGallery(page);
  const release = await holdPreparation(page);
  const queue = queueOf(page);
  const sheet = uploadSheet(page);
  try {
    await page
      .getByLabel("Ajouter des médias", { exact: true })
      .setInputFiles(await files(page, "still", 1));
    await expect(queue).toHaveAttribute("data-state", "preparing");
    const running = (element: Element) =>
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running").length;
    expect(await queue.evaluate(running)).toBe(0);
    await capturePill(
      page,
      queue.locator(".upload-pill"),
      "pill-preparing-reduced-motion.png",
    );
    await openUploadDetails(page, queue);
    expect(await sheet.evaluate(running)).toBe(0);
    await release();
    await expect(queue).toHaveAttribute("data-state", "complete");
    await expect(queue.locator(".upload-pill-text")).toHaveText(
      "1 fichier ajouté",
    );
    await expect(queue.locator(".upload-burst")).toHaveCount(0);
    await closeUploadDetails(page);
    await page.keyboard.press("Tab");
    await expect(queue).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});

test.describe("the longest labels on the smallest phone", () => {
  test.use({ locale: "de-CH", viewport: { width: 320, height: 740 } });

  test("a failed German pill fits a 320px screen with its retry control", async ({
    page,
  }) => {
    await signInGuest(host, page, "Pill Narrow Test");
    await openGallery(page);
    await page.route("**/api/photos", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.abort("failed");
    });
    const queue = page.getByRole("region", {
      name: "Medien hochladen",
      exact: true,
    });
    const pill = queue.locator(".upload-pill");
    try {
      await page
        .locator('input[type="file"]')
        .setInputFiles(await files(page, "narrow", 3));
      await expect(queue).toHaveAttribute("data-state", "error");
      await expect(queue.locator(".upload-pill-text")).toHaveText(
        "3 Dateien erneut senden",
      );
      const retry = queue.getByRole("button", {
        name: "Erneut versuchen",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await expectAboveDock(page, queue);
      await expectNoHorizontalOverflow(page);
      const retryBounds = (await retry.boundingBox())!;
      expect(retryBounds.height).toBeGreaterThanOrEqual(44);
      expect(retryBounds.width).toBeGreaterThanOrEqual(44);
      await capturePill(page, pill, "pill-failed-german-320.png");
      await queue
        .getByRole("button", { name: "Upload-Details", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: test.info().outputPath("details-failed-german-320.png"),
        style:
          "*, *::before, *::after { animation: none !important; } nextjs-portal { visibility: hidden; }",
      });
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});
