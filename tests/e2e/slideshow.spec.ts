import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  activate,
  baseURL,
  bootstrapHost,
  invite,
  newClient,
  shareSession,
} from "./support/party";
import { canvasImage } from "./support/images";
import { randomUUID } from "node:crypto";

type Category = { id: number; name: string; isPublic: boolean };
type Photo = {
  id: number;
  categoryId: number | null;
  url: string;
  thumbnailUrl: string;
};

let host: APIRequestContext;
let guest: APIRequestContext;
let album: Category;
let privateAlbum: Category;
let emptyAlbum: Category;
let albumPhotos: Photo[];
let mainPhotos: Photo[];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

async function createCategory(name: string, isPublic: boolean) {
  const response = await host.post("/api/admin/media-categories", {
    data: { name, isPublic },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Category>;
}

async function uploadImage(buffer: Buffer, categoryId: number | null) {
  const query = categoryId === null ? "" : `?categoryId=${categoryId}`;
  const response = await host.post(`/api/photos${query}`, {
    headers: { "X-Upload-ID": randomUUID() },
    multipart: {
      file: { name: "slideshow-fixture.png", mimeType: "image/png", buffer },
    },
  });
  expect(response.status()).toBe(202);
  return (await response.json()).id as number;
}

async function waitForUploads(ids: number[]) {
  await expect
    .poll(async () => {
      const jobs = await Promise.all(
        ids.map(async (id) => {
          const response = await host.get(`/api/uploads/${id}`);
          expect(response.status()).toBe(200);
          return response.json();
        }),
      );
      expect(jobs.filter((job) => job.status === "failed")).toEqual([]);
      return jobs.every((job) => job.status === "ready");
    })
    .toBe(true);
}

async function photos(categoryId: number | null) {
  const query = categoryId === null ? "" : `&categoryId=${categoryId}`;
  const response = await host.get(`/api/photos?limit=48${query}`);
  expect(response.status()).toBe(200);
  return (await response.json()).items as Photo[];
}

function slideshow(page: Page) {
  return page.getByRole("dialog", { name: "Diaporama", exact: true });
}

function launchButton(page: Page) {
  return page.getByRole("button", { name: "Lancer le diaporama", exact: true });
}

async function startSlideshow(page: Page) {
  if (!(await launchButton(page).isVisible())) {
    await page.locator(".media-post-menu > summary").first().click();
  }
  await launchButton(page).click();
}

async function launch(page: Page, categoryId: number | null = album.id) {
  await page.goto(
    categoryId === null ? "/photos" : `/photos?categoryId=${categoryId}`,
  );
  await startSlideshow(page);
  await expect(slideshow(page)).toBeVisible();
}

async function expectPhoto(page: Page, photo: Photo) {
  const image = slideshow(page).locator(`img[src="${photo.url}"]`);
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
}

async function pause(page: Page) {
  await slideshow(page)
    .getByRole("button", { name: "Mettre en pause", exact: true })
    .click();
  await expect(
    slideshow(page).getByRole("button", { name: "Reprendre", exact: true }),
  ).toBeVisible();
}

async function next(page: Page) {
  await slideshow(page)
    .getByRole("button", { name: "Fichier suivant", exact: true })
    .click();
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await slideshow(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  host = await bootstrapHost("Slideshow Test Host");
  const welcome = await (await host.get("/api/admin/welcome")).json();
  if (!welcome.open) {
    expect(
      (
        await host.post("/api/admin/welcome/transition", {
          data: { revision: welcome.revision, action: "open" },
        })
      ).status(),
    ).toBe(200);
  }
  album = await createCategory("Dance floor slideshow", true);
  privateAlbum = await createCategory("Private slideshow collection", false);
  emptyAlbum = await createCategory("Empty slideshow collection", true);

  const fixturePage = await browser.newPage();
  try {
    const { buffer } = await canvasImage(fixturePage, {
      width: 960,
      height: 640,
      color: "#65496f",
    });
    const jobs: number[] = [];
    for (let index = 0; index < 25; index++)
      jobs.push(await uploadImage(buffer, album.id));
    jobs.push(await uploadImage(buffer, privateAlbum.id));
    jobs.push(await uploadImage(buffer, null));
    jobs.push(await uploadImage(buffer, null));
    await waitForUploads(jobs);
  } finally {
    await fixturePage.close();
  }
  albumPhotos = await photos(album.id);
  mainPhotos = await photos(null);
  expect(albumPhotos).toHaveLength(25);

  const invitation = await invite(host, "Slideshow Test Guest");
  guest = await newClient();
  await activate(guest, invitation.invitationUrl);
});

test.beforeEach(async ({ context }) => {
  await shareSession(context, guest);
});

test.afterAll(async () => {
  await guest?.dispose();
  await host?.dispose();
});

test("a slideshow stays in its current category when paging and looping", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pages: URL[] = [];
  const fullMedia: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/photos" && url.searchParams.has("before"))
      pages.push(url);
    if (
      /^\/api\/photos\/\d+\/image$/.test(url.pathname) &&
      !url.searchParams.has("size")
    )
      fullMedia.push(url.pathname);
  });
  await launch(page);
  await pause(page);
  await expect(slideshow(page)).toContainText(album.name);
  await expectPhoto(page, albumPhotos[0]);
  for (const photo of albumPhotos.slice(1)) {
    await next(page);
    await expectPhoto(page, photo);
  }
  expect(pages.length).toBeGreaterThan(0);
  expect(
    pages.every(
      (url) => url.searchParams.get("categoryId") === String(album.id),
    ),
  ).toBe(true);
  expect(
    fullMedia.every((url) => albumPhotos.some((photo) => photo.url === url)),
  ).toBe(true);
  await next(page);
  await expectPhoto(page, albumPhotos[0]);
  await page.keyboard.press("Escape");
  await expect(slideshow(page)).toHaveCount(0);
  await expect(launchButton(page)).toBeFocused();

  await page
    .getByRole("group", { name: "Catégorie", exact: true })
    .getByRole("button", { name: "Galerie", exact: true })
    .click();
  await expect(page).toHaveURL(/\/photos$/);
  await startSlideshow(page);
  await pause(page);
  await expectPhoto(page, mainPhotos[0]);
  await next(page);
  await expectPhoto(page, mainPhotos[1]);
  await expect(slideshow(page)).not.toContainText(album.name);
});

test("images advance automatically, pause for manual navigation, and fit phone and desktop screens", async ({
  page,
}) => {
  await page.goto(`/photos?categoryId=${album.id}`);
  await page.clock.install();
  await startSlideshow(page);
  await expectPhoto(page, albumPhotos[0]);
  await page.clock.fastForward(5_100);
  await expectPhoto(page, albumPhotos[1]);
  await pause(page);
  await page.clock.fastForward(12_000);
  await expectPhoto(page, albumPhotos[1]);
  await page.keyboard.press("ArrowRight");
  await expectPhoto(page, albumPhotos[2]);
  await page.keyboard.press("ArrowLeft");
  await expectPhoto(page, albumPhotos[1]);
  await slideshow(page)
    .getByRole("button", { name: "Reprendre", exact: true })
    .click();
  await page.clock.fastForward(5_100);
  await expectPhoto(page, albumPhotos[2]);
  await pause(page);

  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(page);
  const buttons = await slideshow(page).getByRole("button").all();
  for (const button of buttons) {
    if (!(await button.isVisible())) continue;
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: test.info().outputPath("slideshow", "mobile-320.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectNoOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("slideshow", "desktop.png"),
    fullPage: false,
  });
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await slideshow(page)
      .getByRole("button", { name: "Plein écran", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement !== null))
      .toBe(true);
    await slideshow(page)
      .getByRole("button", { name: "Quitter le plein écran", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await page.evaluate(() => {
      HTMLElement.prototype.requestFullscreen = () =>
        Promise.reject(
          new DOMException("Test fullscreen denial", "NotAllowedError"),
        );
    });
    await slideshow(page)
      .getByRole("button", { name: "Plein écran", exact: true })
      .click();
    await expect(slideshow(page).getByRole("alert")).toContainText(
      "Le plein écran n’est pas disponible. Tu peux continuer ici.",
    );
    await expectPhoto(page, albumPhotos[2]);
  }
  await slideshow(page)
    .getByRole("button", { name: "Fermer le diaporama", exact: true })
    .click();
  await expect(launchButton(page)).toBeFocused();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({
    path: test.info().outputPath("slideshow", "gallery-mobile-320.png"),
    fullPage: false,
  });
});

test("empty categories have no slideshow and private categories remain host-only", async ({
  page,
  context,
}) => {
  await page.goto(`/photos?categoryId=${emptyAlbum.id}`);
  const categories = page.getByRole("group", {
    name: "Catégorie",
    exact: true,
  });
  await expect(
    categories.getByRole("button", { name: emptyAlbum.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(launchButton(page)).toHaveCount(0);
  await expect(
    categories.getByRole("button", { name: privateAlbum.name, exact: true }),
  ).toHaveCount(0);
  expect(
    (await guest.get(`/api/photos?categoryId=${privateAlbum.id}`)).status(),
  ).toBe(404);

  await context.clearCookies();
  await shareSession(context, host);
  await page.clock.install();
  await launch(page, privateAlbum.id);
  await expect(slideshow(page)).toContainText(privateAlbum.name);
  const onlyPhoto = (await photos(privateAlbum.id))[0];
  await expectPhoto(page, onlyPhoto);
  await page.clock.fastForward(20_000);
  await expectPhoto(page, onlyPhoto);
  await expect(slideshow(page).getByRole("status")).toHaveCount(0);
});

test("a failed metadata page can be retried in the same category", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests: URL[] = [];
  await page.route("**/api/photos?**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("before")) return route.continue();
    requests.push(url);
    if (requests.length === 1) {
      return route.fulfill({
        status: 503,
        json: { code: "internal_error", error: "Test metadata failure" },
      });
    }
    return route.continue();
  });
  await launch(page);
  await pause(page);
  for (const photo of albumPhotos.slice(1, 24)) {
    await next(page);
    await expectPhoto(page, photo);
  }
  await next(page);
  await expect(slideshow(page).getByRole("alert")).toContainText(
    "Ça n’a pas fonctionné. Réessaie dans un instant.",
  );
  await expectPhoto(page, albumPhotos[23]);
  await slideshow(page)
    .getByRole("button", { name: "Réessayer", exact: true })
    .click();
  await expectPhoto(page, albumPhotos[24]);
  expect(requests).toHaveLength(2);
  expect(requests[0].search).toBe(requests[1].search);
  expect(requests[1].searchParams.get("categoryId")).toBe(String(album.id));
});

test("a missing image can be retried or skipped without trapping the viewer", async ({
  page,
}) => {
  const fileURL = `${baseURL}${albumPhotos[0].url}`;
  await page.route(fileURL, (route) => route.fulfill({ status: 404 }));
  await launch(page);
  await expect(slideshow(page)).toContainText(
    "Ce fichier n’a pas pu être chargé. Réessaie ou passe au suivant.",
  );
  await page.unroute(fileURL);
  await slideshow(page)
    .getByRole("button", { name: "Réessayer", exact: true })
    .click();
  await expectPhoto(page, albumPhotos[0]);
  await next(page);
  await expectPhoto(page, albumPhotos[1]);
  await slideshow(page)
    .getByRole("button", { name: "Fermer le diaporama", exact: true })
    .click();
  await expect(launchButton(page)).toBeFocused();
});

test("a slideshow starts with a video, pauses playback, and advances when it ends", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/photos?categoryId=${album.id}`);
  // A short browser-recorded fixture exercises actual playback without requiring
  // FFmpeg on the browser test host. The API's video preparation has Go tests.
  const encodedVideo = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const drawing = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    recorder.start();
    const timer = window.setInterval(() => {
      drawing.fillStyle = "#65496f";
      drawing.fillRect(0, 0, 320, 240);
      drawing.fillStyle = "#e7cba0";
      drawing.fillRect((Date.now() / 20) % 240, 80, 50, 80);
    }, 100);
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    recorder.stop();
    window.clearInterval(timer);
    const blob = await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const data = new Uint8Array(await blob.arrayBuffer());
    return btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(""));
  });
  const videoPhoto = albumPhotos[0];
  await page.route(`${baseURL}${videoPhoto.url}`, (route) =>
    route.fulfill({
      contentType: "video/webm",
      body: Buffer.from(encodedVideo, "base64"),
    }),
  );
  // Restoring a completed upload updates the current gallery before launch,
  // allowing the video to be the first slide during StrictMode mounting.
  await page.route(`${baseURL}/api/uploads`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 2_000_000_000,
            categoryId: album.id,
            welcomeRevision: null,
            welcomeWidgetIndex: null,
            clientUploadId: randomUUID(),
            filename: "slideshow-video.webm",
            kind: "video",
            createdAt: new Date().toISOString(),
            status: "ready",
            errorCode: null,
            photo: {
              ...videoPhoto,
              kind: "video",
              mimeType: "video/mp4",
              width: 320,
              height: 240,
            },
          },
        ],
      },
    }),
  );
  await page.reload();
  await expect(
    page.locator(".photo-tile").first().locator(".video-marker"),
  ).toBeVisible();
  await startSlideshow(page);
  const video = slideshow(page).locator("video");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.muted),
  ).toBe(true);
  await pause(page);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
  await slideshow(page)
    .getByRole("button", { name: "Reprendre", exact: true })
    .click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await expectPhoto(page, albumPhotos[1]);
});
