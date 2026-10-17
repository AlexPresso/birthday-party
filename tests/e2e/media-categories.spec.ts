import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};
type Category = { id: number; name: string; isPublic: boolean };
type Widget =
  | { type: "title"; text: string }
  | { type: "text"; text: string }
  | { type: "profile_photo" }
  | { type: "media_upload"; mediaUpload: { categoryId: number | null } };
type Step = { widgets: Widget[] };

function step(
  title: string,
  body: string,
  action: "profile_photo" | "media_upload" | null = null,
  categoryId: number | null = null,
): Step {
  const widgets: Widget[] = [
    { type: "title", text: title },
    { type: "text", text: body },
  ];
  if (action === "profile_photo") widgets.push({ type: action });
  if (action === "media_upload")
    widgets.push({ type: action, mediaUpload: { categoryId } });
  return { widgets };
}

function titleOf(step: Step) {
  return step.widgets.find((widget) => widget.type === "title")!.text;
}
function bodyOf(step: Step) {
  return step.widgets.find((widget) => widget.type === "text")!.text;
}
type Welcome = {
  open: boolean;
  revision: number;
  currentStep: number;
  required: boolean;
  steps: Step[];
};
type Photo = {
  id: number;
  categoryId: number | null;
  author: { id: number };
  url: string;
  thumbnailUrl: string;
};
type Job = {
  id: number;
  categoryId: number | null;
  welcomeRevision: number | null;
  welcomeWidgetIndex: number | null;
  filename: string;
  status: string;
  errorCode: string | null;
  photo: Photo | null;
};
let host: APIRequestContext;
let previousSteps: Step[];
let previouslyRequired = false;

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function welcome(): Promise<Welcome> {
  const response = await host.get("/api/admin/welcome");
  expect(response.status()).toBe(200);
  return response.json();
}

async function transition(action: "start" | "next" | "open") {
  const { revision } = await welcome();
  const response = await host.post("/api/admin/welcome/transition", {
    data: { revision, action },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Welcome>;
}

async function saveSteps(steps: Step[]) {
  const { revision } = await welcome();
  const response = await host.put("/api/admin/welcome", {
    data: { revision, steps },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Welcome>;
}

async function restoreOpen(steps: Step[], required = false) {
  if (!(await welcome()).open) await transition("open");
  await transition("start");
  await saveSteps(steps);
  const { revision } = await welcome();
  expect(
    (
      await host.patch("/api/admin/welcome/required", {
        data: { revision, required },
      })
    ).status(),
  ).toBe(200);
  await transition("open");
}

async function createCategory(name: string, isPublic: boolean) {
  const response = await host.post("/api/admin/media-categories", {
    data: { name, isPublic },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Category>;
}

async function enterWaiting(page: Page, name: string) {
  const created = await host.post("/api/admin/guests", { data: { name } });
  expect(created.status()).toBe(201);
  const invitation = (await created.json()) as {
    guest: { id: number; name: string };
    invitationUrl: string;
  };
  await page.goto(invitation.invitationUrl);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/attente$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  return invitation.guest;
}

async function expectStep(page: Page, step: Step) {
  await expect(
    page.getByRole("heading", { name: titleOf(step), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page).toHaveURL(/\/attente$/);
}

async function guestNext(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/welcome/progress" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function finishWelcome(page: Page) {
  await page
    .getByRole("button", { name: "Entrer dans l’application", exact: true })
    .click();
  await expect(page).toHaveURL(/\/photos$/);
}

async function progressRevision(page: Page) {
  return (await (await page.request.get("/api/welcome")).json())
    .progressRevision as number;
}

async function testImage(page: Page, name: string, color = "#91729d") {
  const data = await page.evaluate((background) => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = background;
    drawing.fillRect(0, 0, 480, 320);
    drawing.fillStyle = "#efd8b5";
    drawing.beginPath();
    drawing.arc(180, 130, 75, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#302235";
    drawing.fillRect(265, 150, 120, 110);
    return canvas.toDataURL("image/png").split(",")[1];
  }, color);
  return { name, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

async function upload(
  page: Page,
  name: string,
  color?: string,
  widgetPosition?: number,
) {
  const image = await testImage(page, name, color);
  const controls =
    widgetPosition === undefined
      ? page
      : page.locator(".welcome-media").nth(widgetPosition);
  await expect(
    controls.getByLabel("Ajouter des médias", { exact: true }),
  ).toBeHidden();
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/photos" &&
      response.request().method() === "POST",
  );
  // Clicking the real control also waits for hydration after a full navigation.
  const chooser = page.waitForEvent("filechooser");
  await controls
    .getByRole("button", { name: "Ajouter des médias", exact: true })
    .and(page.locator("button"))
    .click();
  await (await chooser).setFiles(image);
  const response = await accepted;
  expect(response.status()).toBe(202);
  return response.json() as Promise<Job>;
}

async function ready(client: APIRequestContext, id: number) {
  let job: Job | undefined;
  await expect
    .poll(async () => {
      const response = await client.get(`/api/uploads/${id}`);
      expect(response.status()).toBe(200);
      job = await response.json();
      expect(
        job!.status,
        job!.errorCode ?? "Media preparation failed",
      ).not.toBe("failed");
      return job!.status;
    })
    .toBe("ready");
  return job!;
}

async function categoryPhotos(
  client: APIRequestContext,
  categoryId: number | null,
) {
  const query = categoryId === null ? "" : `?categoryId=${categoryId}`;
  const response = await client.get(`/api/photos${query}`);
  expect(response.status()).toBe(200);
  return (await response.json()).items as Photo[];
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    [
      "scripts/backend.mjs",
      "invite-admin",
      "--name",
      "Media Category Test Host",
    ],
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
  host = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  const accepted = await host.post("/api/invitations/accept", {
    data: { token: invitationToken(match[0]) },
  });
  expect(accepted.status()).toBe(200);
  const previousState = await welcome();
  previousSteps = previousState.steps;
  previouslyRequired = previousState.required;
});

test("several media widgets keep separate destinations and queues alongside a profile widget", async ({
  page,
}) => {
  const category = await createCategory("Private table challenge", false);
  const steps: Step[] = [
    {
      widgets: [
        { type: "text", text: "First take a photo with your table." },
        { type: "media_upload", mediaUpload: { categoryId: category.id } },
        { type: "title", text: "Now share a photo with everyone" },
        { type: "media_upload", mediaUpload: { categoryId: null } },
        { type: "profile_photo" },
        { type: "text", text: "You can also choose your profile photo here." },
      ],
    },
    step(
      "A future surprise",
      "These instructions remain hidden until the host continues.",
      "media_upload",
      category.id,
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  await enterWaiting(page, "Sam Several Widgets Test");
  const activeRevision = await progressRevision(page);
  const media = page.locator(".welcome-media");
  const profile = page.locator(".welcome-profile");
  await expect(media).toHaveCount(2);
  await expect(profile).toBeVisible();
  const current = await (await page.request.get("/api/welcome")).json();
  expect(current.step).toEqual({ position: 1, ...steps[0] });
  for (const key of ["title", "body", "action", "mediaUpload"])
    expect(current.step).not.toHaveProperty(key);
  const html = await page.content();
  expect(html).not.toContain(titleOf(steps[1]));
  expect(html).not.toContain(bodyOf(steps[1]));
  const order = await page
    .locator(".welcome-widgets > *")
    .evaluateAll((elements) =>
      elements
        .map((element) =>
          element.classList.contains("welcome-media")
            ? "media"
            : element.classList.contains("welcome-profile")
              ? "profile"
              : element.textContent?.trim(),
        )
        .filter(Boolean),
    );
  // Each authored text and interactive widget stays in the order chosen by the host.
  const positions = [
    order.indexOf("First take a photo with your table."),
    order.indexOf("media"),
    order.indexOf("Now share a photo with everyone"),
    order.lastIndexOf("media"),
    order.indexOf("profile"),
    order.indexOf("You can also choose your profile photo here."),
  ];
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  await profile
    .locator('input[type="file"]')
    .setInputFiles(await testImage(page, "profile-and-media.png"));
  const preview = profile.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(preview).toBeVisible();
  const previewURL = await preview.getAttribute("src");

  const privateJob = await (async () => {
    let releaseUpload!: () => void;
    let held = false;
    const gate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route("**/api/photos", async (route) => {
      if (route.request().method() === "POST" && !held) {
        held = true;
        await gate;
      }
      await route.continue();
    });
    const pendingUpload = upload(
      page,
      "table-widget-private.png",
      "#91729d",
      0,
    );
    try {
      await expect.poll(() => held).toBe(true);
      await transition("next");
      await expect(
        page.getByRole("button", { name: "Suivant", exact: true }),
      ).toBeEnabled();
      await expect(media).toHaveCount(2);
      await expect(preview).toHaveAttribute("src", previewURL!);
      expect(await progressRevision(page)).toBe(activeRevision);
      const current = await (await page.request.get("/api/welcome")).json();
      expect(current.step).toEqual({ position: 1, ...steps[0] });
      expect(JSON.stringify(current)).not.toContain(titleOf(steps[1]));
      releaseUpload();
      return await pendingUpload;
    } finally {
      releaseUpload();
      await pendingUpload.catch(() => {});
      await page.unroute("**/api/photos");
    }
  })();
  const mainJob = await upload(page, "table-widget-main.png", "#688b96", 1);
  expect(privateJob).toMatchObject({
    categoryId: category.id,
    welcomeRevision: activeRevision,
    welcomeWidgetIndex: 1,
  });
  expect(mainJob).toMatchObject({
    categoryId: null,
    welcomeRevision: activeRevision,
    welcomeWidgetIndex: 3,
  });
  expect((await ready(page.request, privateJob.id)).photo).toBeNull();
  expect((await ready(page.request, mainJob.id)).photo).toBeNull();
  await expect(media.nth(0).locator(".upload-queue")).toContainText(
    privateJob.filename,
  );
  await expect(media.nth(0).locator(".upload-queue")).not.toContainText(
    mainJob.filename,
  );
  await expect(media.nth(1).locator(".upload-queue")).toContainText(
    mainJob.filename,
  );
  await expect(media.nth(1).locator(".upload-queue")).not.toContainText(
    privateJob.filename,
  );
  await expect(preview).toHaveAttribute("src", previewURL!);
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/profile/avatar" &&
      response.request().method() === "PUT",
  );
  await profile
    .getByRole("button", { name: "Enregistrer la photo", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(media.nth(0).locator(".upload-queue")).toContainText(
    privateJob.filename,
  );
  await expect(media.nth(0).locator(".upload-queue")).not.toContainText(
    mainJob.filename,
  );
  await expect(media.nth(1).locator(".upload-queue")).toContainText(
    mainJob.filename,
  );
  await expect(media.nth(1).locator(".upload-queue")).not.toContainText(
    privateJob.filename,
  );
  await expect(profile.locator(".avatar img")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(page);
  await page.screenshot({
    path: "test-results/welcome-widgets-guest-mobile-320.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "test-results/welcome-widgets-guest-desktop.png",
    fullPage: true,
  });
  await media
    .nth(0)
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await expect(media.nth(0).locator(".upload-queue")).toHaveCount(0);
  await expect(media.nth(1).locator(".upload-queue")).toContainText(
    mainJob.filename,
  );
  await page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/welcome",
  );
  await expect(media.nth(0).locator(".upload-queue")).toHaveCount(0);
  await expect(media.nth(1).locator(".upload-queue")).toContainText(
    mainJob.filename,
  );
  expect((await page.request.get("/api/photos")).status()).toBe(423);
  await transition("open");
  await finishWelcome(page);
  const published = (await ready(page.request, mainJob.id)).photo!;
  await expect(
    page.locator(`img[src="${published.thumbnailUrl}"]`),
  ).toBeVisible();
  expect((await ready(page.request, privateJob.id)).photo).toBeNull();
});

test.beforeEach(async () => {
  await restoreOpen([]);
});

test.afterEach(async () => {
  // Every specification shares the disposable database supplied by the runner.
  await restoreOpen(previousSteps, previouslyRequired);
});

test.afterAll(async () => {
  await host?.dispose();
});

test("the host creates private and public categories and saves each welcome upload destination", async ({
  page,
  context,
}) => {
  await context.addCookies((await host.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/parametres");
  await expect(
    page.getByRole("heading", { name: "Catégories de médias", exact: true }),
  ).toBeVisible();
  const categoryName = page.getByLabel("Nom de la catégorie", { exact: true });
  const visibility = page.getByRole("checkbox", {
    name: "Visible par les invités",
    exact: true,
  });
  const create = page.getByRole("button", {
    name: "Créer la catégorie",
    exact: true,
  });
  await expect(visibility).not.toBeChecked();
  await categoryName.fill("Table envelopes");
  const privateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/media-categories") &&
      response.request().method() === "POST",
  );
  await create.click();
  const privateCreated = await privateResponse;
  expect(privateCreated.status()).toBe(201);
  const privateCategory: Category = await privateCreated.json();
  expect(privateCategory.isPublic).toBe(false);
  await expect(
    page.getByRole("button", { name: "Publier Table envelopes", exact: true }),
  ).toBeVisible();

  await categoryName.fill("Dance floor");
  await visibility.check();
  const publicResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/media-categories") &&
      response.request().method() === "POST",
  );
  await create.click();
  const publicCreated = await publicResponse;
  expect(publicCreated.status()).toBe(201);
  const publicCategory: Category = await publicCreated.json();
  expect(publicCategory.isPublic).toBe(true);
  await expect(
    page.getByRole("button", { name: "Masquer Dance floor", exact: true }),
  ).toBeVisible();

  const steps: Step[] = [
    step(
      "Share a photo from your table",
      "Choose a photo with your group.",
      "media_upload",
      privateCategory.id,
    ),
    step(
      "Share a dance floor photo",
      "Choose a photo from the dance floor.",
      "media_upload",
      publicCategory.id,
    ),
    step(
      "Add another memory",
      "Choose a photo for the main gallery.",
      "media_upload",
      null,
    ),
  ];
  for (const step of steps) {
    await page
      .getByRole("button", { name: "Ajouter une étape", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ajouter le widget Titre", exact: true })
      .click();
    await page
      .getByLabel("Titre du widget 1", { exact: true })
      .fill(titleOf(step));
    await page
      .getByRole("button", { name: "Ajouter le widget Texte", exact: true })
      .click();
    await page
      .getByLabel("Texte du widget 2", { exact: true })
      .fill(bodyOf(step));
    await page
      .getByRole("button", {
        name: "Ajouter le widget Photos et vidéos",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Destination des envois", { exact: true })
      .selectOption(
        step.widgets
          .find((widget) => widget.type === "media_upload")!
          .mediaUpload.categoryId?.toString() ?? "",
      );
  }
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/welcome") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Enregistrer les étapes", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  expect((await welcome()).steps).toEqual(steps);
  await page.reload();
  for (const [index, step] of steps.entries()) {
    await page
      .getByRole("button", {
        name: `Modifier l’étape ${index + 1}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Destination des envois", { exact: true }),
    ).toHaveValue(
      step.widgets
        .find((widget) => widget.type === "media_upload")!
        .mediaUpload.categoryId?.toString() ?? "",
    );
  }
  await page
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  await page.locator(".welcome-admin").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/media-categories-editor-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(page);
  await page.screenshot({
    path: "test-results/media-categories-editor-mobile-320.png",
    fullPage: true,
  });
});

test("a private welcome upload survives reload and stays inaccessible until the host publishes its category", async ({
  page,
  browser,
}) => {
  const category = await createCategory("Unopened table portraits", false);
  const steps: Step[] = [
    step("Find your table", "Keep the envelope closed.", null),
    step(
      "Send your table portrait",
      "Take a photo together and send it here.",
      "media_upload",
      category.id,
    ),
    step("Open your envelope", "Read the note together.", null),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  const contextRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/welcome/upload-context")
      contextRequests.push(request.url());
  });
  const guest = await enterWaiting(page, "Morgan Private Upload Test");
  await expectStep(page, steps[0]);
  await expect(page.locator(".welcome-media")).toHaveCount(0);
  expect(contextRequests).toEqual([]);
  const initialState = await (await page.request.get("/api/welcome")).json();
  expect(JSON.stringify(initialState)).not.toContain(category.name);
  expect(initialState.step.widgets).toEqual(steps[0].widgets);
  expect(initialState.step).not.toHaveProperty("action");

  await transition("next");
  await expectStep(page, steps[0]);
  await guestNext(page);
  await expectStep(page, steps[1]);
  const activeRevision = await progressRevision(page);
  await expect(page.locator(".welcome-media")).toBeVisible();
  const contextResponse = await page.request.get(
    "/api/welcome/upload-context?widgetIndex=2",
  );
  expect(contextResponse.status()).toBe(200);
  expect((await contextResponse.json()).category).toEqual(category);
  const accepted = await upload(page, "table-portrait-private.png");
  expect(accepted.categoryId).toBe(category.id);
  expect(accepted.welcomeRevision).toBe(activeRevision);
  expect(accepted.welcomeWidgetIndex).toBe(2);
  const completed = await ready(page.request, accepted.id);
  expect(completed.photo).toBeNull();
  await expect(page.locator(".upload-queue")).toContainText(
    "table-portrait-private.png",
  );
  await expect(page.locator(".upload-queue")).toContainText(
    "Reçu par l’organisateur",
  );
  await page.reload();
  await expectStep(page, steps[1]);
  await expect(page.locator(".upload-queue")).toContainText(
    "table-portrait-private.png",
  );
  await expectNoOverflow(page);
  await page.screenshot({
    path: "test-results/media-categories-welcome-mobile-390.png",
    fullPage: true,
  });
  for (const path of [
    "/api/photos",
    "/api/media-categories",
    "/api/programme",
    "/api/guestbook",
  ]) {
    expect((await page.request.get(path)).status()).toBe(423);
  }
  const photo = (await categoryPhotos(host, category.id)).find(
    (item) => item.author.id === guest.id,
  )!;
  expect(photo).toBeTruthy();
  for (const path of [photo.url, photo.thumbnailUrl]) {
    expect((await page.request.get(path)).status()).toBe(423);
  }

  await transition("next");
  await expectStep(page, steps[1]);
  await guestNext(page);
  await expectStep(page, steps[2]);
  await expect(page.locator(".welcome-media")).toHaveCount(0);
  expect(
    (
      await page.request.get("/api/welcome/upload-context?widgetIndex=2")
    ).status(),
  ).toBe(423);
  expect((await page.request.get("/api/uploads")).status()).toBe(423);
  await transition("open");
  await finishWelcome(page);
  const categories = await (
    await page.request.get("/api/media-categories")
  ).json();
  expect(
    categories.items.some((item: Category) => item.id === category.id),
  ).toBe(false);
  expect(
    (await page.request.get(`/api/photos?categoryId=${category.id}`)).status(),
  ).toBe(404);
  expect((await ready(page.request, accepted.id)).photo).toBeNull();
  for (const path of [photo.url, photo.thumbnailUrl]) {
    expect((await page.request.get(path)).status()).toBe(404);
    expect((await page.request.head(path)).status()).toBe(404);
    expect(
      (
        await page.request.get(path, { headers: { Range: "bytes=0-31" } })
      ).status(),
    ).toBe(404);
  }
  expect(
    (
      await page.request.delete(`/api/photos/${photo.id}`, {
        headers: mutationHeaders,
      })
    ).status(),
  ).toBe(404);
  await expect(
    page.getByRole("option", { name: category.name, exact: true }),
  ).toHaveCount(0);

  const hostContext = await browser.newContext({
    baseURL,
    locale: "fr-CH",
    storageState: await host.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const hostPage = await hostContext.newPage();
    hostPage.on("dialog", (dialog) => void dialog.accept());
    await hostPage.goto("/parametres");
    const published = hostPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/media-categories/${category.id}`) &&
        response.request().method() === "PUT",
    );
    await hostPage
      .getByRole("button", { name: `Publier ${category.name}`, exact: true })
      .click();
    expect((await published).status()).toBe(200);
    await expect(
      hostPage.getByRole("button", {
        name: `Masquer ${category.name}`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await hostContext.close();
  }
  await page.bringToFront();
  await page.reload();
  await page
    .getByLabel("Catégorie", { exact: true })
    .selectOption(`${category.id}`);
  await expect(page.locator(`img[src="${photo.thumbnailUrl}"]`)).toBeVisible();
  expect((await page.request.get(photo.url)).status()).toBe(200);
  expect(
    (
      await page.request.get(photo.url, { headers: { Range: "bytes=0-31" } })
    ).status(),
  ).toBe(206);
  expect((await ready(page.request, accepted.id)).photo?.id).toBe(photo.id);
});

test("welcome uploads keep their public or main destination and the gallery filters each category", async ({
  page,
}) => {
  const category = await createCategory("Shared dance photos", true);
  const steps: Step[] = [
    step(
      "Share a dance photo",
      "Send a photo for the dance collection.",
      "media_upload",
      category.id,
    ),
    step(
      "Share a memory in the main gallery",
      "Send another photo for everyone.",
      "media_upload",
      null,
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  await enterWaiting(page, "Alex Public Upload Test");
  await expectStep(page, steps[0]);
  const firstRevision = await progressRevision(page);
  const namedJob = await upload(page, "dance-public.png", "#688b96");
  expect(namedJob.categoryId).toBe(category.id);
  expect(namedJob.welcomeRevision).toBe(firstRevision);
  expect(namedJob.welcomeWidgetIndex).toBe(2);
  expect((await ready(page.request, namedJob.id)).photo).toBeNull();
  await transition("next");
  await expectStep(page, steps[0]);
  await guestNext(page);
  await expectStep(page, steps[1]);
  const secondRevision = await progressRevision(page);
  const mainJob = await upload(page, "memory-main.png", "#8d784f");
  expect(mainJob.categoryId).toBeNull();
  expect(mainJob.welcomeRevision).toBe(secondRevision);
  expect(mainJob.welcomeWidgetIndex).toBe(2);
  expect((await ready(page.request, mainJob.id)).photo).toBeNull();
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/media-categories-welcome-desktop.png",
    fullPage: true,
  });
  await transition("open");
  await finishWelcome(page);
  const main = (await ready(page.request, mainJob.id)).photo!;
  const named = (await ready(page.request, namedJob.id)).photo!;
  expect(main).toBeTruthy();
  expect(named).toBeTruthy();
  const filter = page.getByLabel("Catégorie", { exact: true });
  await expect(filter).toHaveValue("");
  await expect(page.locator(`img[src="${main.thumbnailUrl}"]`)).toBeVisible();
  await expect(page.locator(`img[src="${named.thumbnailUrl}"]`)).toHaveCount(0);
  const mainItems = await categoryPhotos(page.request, null);
  expect(mainItems.some((item) => item.id === main.id)).toBe(true);
  expect(mainItems.some((item) => item.id === named.id)).toBe(false);

  await filter.selectOption(`${category.id}`);
  await expect(page.locator(`img[src="${named.thumbnailUrl}"]`)).toBeVisible();
  await expect(page.locator(`img[src="${main.thumbnailUrl}"]`)).toHaveCount(0);
  const namedItems = await categoryPhotos(page.request, category.id);
  expect(namedItems.map((item) => item.id)).toEqual([named.id]);
  // Uploads chosen from the gallery retain the selected category as well.
  const galleryJob = await upload(page, "dance-gallery.png", "#6d8b69");
  expect(galleryJob.categoryId).toBe(category.id);
  expect(galleryJob.welcomeRevision).toBeNull();
  expect(galleryJob.welcomeWidgetIndex).toBeNull();
  const galleryPhoto = (await ready(page.request, galleryJob.id)).photo!;
  await expect(
    page.locator(`img[src="${galleryPhoto.thumbnailUrl}"]`),
  ).toBeVisible();
  await filter.selectOption("");
  await expect(page.locator(`img[src="${main.thumbnailUrl}"]`)).toBeVisible();
  await expect(page.locator(`img[src="${named.thumbnailUrl}"]`)).toHaveCount(0);
  await expect(
    page.locator(`img[src="${galleryPhoto.thumbnailUrl}"]`),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverflow(page);
  const buttonBounds = await page.locator(".media-picker button").boundingBox();
  const limitsBounds = await page
    .locator(".media-picker .photo-privacy")
    .boundingBox();
  expect(buttonBounds).toBeTruthy();
  expect(limitsBounds).toBeTruthy();
  expect(limitsBounds!.y).toBeGreaterThanOrEqual(
    buttonBounds!.y + buttonBounds!.height,
  );
  await page.screenshot({
    path: "test-results/media-categories-gallery-mobile.png",
    fullPage: true,
  });
});
