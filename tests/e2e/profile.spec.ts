import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  baseURL,
  bootstrapHost,
  expectNoHorizontalOverflow,
  mutationHeaders,
  signInGuest,
} from "./support/party";
import { expectHydrated } from "./support/hydration";
import { canvasImage } from "./support/images";
import { expectSavedAnnouncement } from "./support/settings";

let host: APIRequestContext;

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Profile Test Host");
});

test.afterAll(async () => {
  await host?.dispose();
});

async function enterGuest(page: Page, name: string) {
  const guest = await signInGuest(host, page, name);
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  // A file given to the server-rendered input before hydration is never sent.
  await expectHydrated(page.locator('.profile-panel input[type="file"]'));
  return guest;
}

/** The photo is the button of its menu: the avatar and its camera badge. */
function photoButton(page: Page) {
  return page
    .locator(".profile-panel")
    .getByRole("button", { name: "Photo de profil", exact: true });
}

function photoMenu(page: Page) {
  return page
    .locator(".profile-panel")
    .getByRole("menu", { name: "Photo de profil", exact: true });
}

function menuItem(
  page: Page,
  name: "Choisir une photo" | "Supprimer la photo",
) {
  return photoMenu(page).getByRole("menuitem", { name, exact: true });
}

function capture(page: Page, name: string) {
  return page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
}

function profileImage(page: Page, color = "#60917e") {
  // A landscape image also exercises the square avatar crop.
  return canvasImage(page, {
    name: "profile-test.png",
    width: 384,
    height: 256,
    color,
  });
}

async function savePhoto(page: Page, trigger: () => Promise<void>) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile/avatar") &&
      response.request().method() === "PUT",
  );
  await trigger();
  const saved = await response;
  expect(saved.status()).toBe(200);
  const profile = (await saved.json()) as {
    guest: { id: number; avatarUrl: string };
  };
  // No visible confirmation: the avatar changes and screen readers are told.
  await expectSavedAnnouncement(page, "Photo de profil enregistrée.");
  await expect(page.locator(".navigation-profile .avatar img")).toHaveAttribute(
    "src",
    profile.guest.avatarUrl,
  );
  return profile.guest.avatarUrl;
}

test("choosing a profile photo uploads it immediately and persists replacements across navigation and reloads", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await enterGuest(page, "Camille Profile Test");
  const card = page.locator(".profile-panel");
  const input = card.locator('input[type="file"]');
  const navigationAvatar = page.locator(".navigation-profile .avatar");
  const preview = card.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(input).toHaveAttribute("aria-label", "Photo de profil");
  await expect(input).toBeHidden();
  await expect(navigationAvatar).toHaveText("C");
  const image = await profileImage(page);
  const photo = photoButton(page);
  const chooser = page.waitForEvent("filechooser");
  await photo.press("Enter");
  await expect(menuItem(page, "Choisir une photo")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(photoMenu(page)).toHaveCount(0);
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/profile/avatar", async (route) => {
    if (route.request().method() === "PUT") await uploadGate;
    await route.continue();
  });
  const fileChooser = await chooser;
  const saving = savePhoto(page, () => fileChooser.setFiles(image));
  try {
    // The photo actions wait for the request: the ring turns, the photo
    // stays focusable and opens nothing.
    await expect(card.locator(".profile-identity")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(card.locator(".profile-photo")).toHaveAttribute(
      "data-busy",
      "true",
    );
    await expectSavedAnnouncement(card, "Enregistrement…");
    await expect(photo).toBeDisabled();
    await expect(photo).toBeFocused();
    await photo.dispatchEvent("click");
    await expect(photoMenu(page)).toHaveCount(0);
    await expect(input).toBeDisabled();
    await capture(page, "profile-saving-390");
    await expect(preview).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Enregistrer la photo", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Annuler", exact: true }),
    ).toHaveCount(0);
    await expect(navigationAvatar.locator("img")).toHaveCount(0);
    expect(
      (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
    ).toBeNull();
  } finally {
    releaseUpload();
  }
  const firstURL = await saving;
  await page.unroute("**/api/profile/avatar");
  await expect(preview).toHaveCount(0);
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  const storedImage = await page.request.get(firstURL);
  expect(storedImage.status()).toBe(200);
  expect(storedImage.headers()["content-type"]).toBe("image/jpeg");
  await expect(navigationAvatar.locator("img")).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await expect(navigationAvatar.locator("img")).toHaveJSProperty(
    "naturalHeight",
    256,
  );

  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/programme$/);
  await expect(navigationAvatar.locator("img")).toHaveAttribute(
    "src",
    firstURL,
  );
  await page
    .getByRole("link", { name: "Profil: Camille Profile Test", exact: true })
    .click();
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  await page.reload();
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);

  const replacementChooser = page.waitForEvent("filechooser");
  await photo.click();
  await menuItem(page, "Choisir une photo").click();
  const replacementPicker = await replacementChooser;
  const replacementImage = await profileImage(page, "#a26679");
  const replacementURL = await savePhoto(page, () =>
    replacementPicker.setFiles(replacementImage),
  );
  expect(replacementURL).not.toBe(firstURL);
  await expect(preview).toHaveCount(0);
  await expect(card.locator(".avatar img")).toHaveAttribute(
    "src",
    replacementURL,
  );

  await photo.click();
  await menuItem(page, "Supprimer la photo").click();
  await expectSavedAnnouncement(card, "Photo de profil supprimée.");
  await expect(card.locator(".profile-identity")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(navigationAvatar.locator("img")).toHaveCount(0);
  await expect(navigationAvatar).toHaveText("C");
  await expect(card.locator(".avatar")).toHaveText("C");
  await page.reload();
  await expect(card.locator(".avatar")).toHaveText("C");
  expect((await page.request.get(replacementURL)).status()).toBe(404);
  expect(browserErrors).toEqual([]);
});

test("a failed automatic profile upload retains the current avatar and selected file for retry", async ({
  page,
}) => {
  await enterGuest(page, "Alex Profile Retry Test");
  const card = page.locator(".profile-panel");
  const input = card.locator('input[type="file"]');
  const image = await profileImage(page);
  const firstURL = await savePhoto(page, () => input.setInputFiles(image));
  let uploadRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/profile/avatar") &&
      request.method() === "PUT"
    )
      uploadRequests++;
  });

  await input.setInputFiles({
    name: "profile.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not an image."),
  });
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(page.locator(".navigation-profile .avatar img")).toHaveAttribute(
    "src",
    firstURL,
  );
  expect(
    (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
  ).toBe(firstURL);
  expect(uploadRequests).toBe(0);
  await expect(
    card.getByRole("button", { name: "Réessayer", exact: true }),
  ).toHaveCount(0);

  await page.route("**/api/profile/avatar", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 503,
      json: {
        code: "internal_error",
        error: "Unable to save the profile photo.",
      },
    });
  });
  const replacementImage = await profileImage(page, "#8a6ca5");
  await input.setInputFiles(replacementImage);
  await expect(card.getByRole("alert")).toBeVisible();
  const retry = card.getByRole("button", { name: "Réessayer", exact: true });
  await expect(retry).toBeVisible();
  expect(uploadRequests).toBe(1);
  // The error and its retry sit under the photo and the name, above the rows.
  const name = (await card.getByRole("heading", { level: 1 }).boundingBox())!;
  const alert = (await card.getByRole("alert").boundingBox())!;
  const rows = (await card.locator(".profile-rows").boundingBox())!;
  expect(alert.y).toBeGreaterThanOrEqual(name.y + name.height);
  expect((await retry.boundingBox())!.y).toBeGreaterThanOrEqual(
    alert.y + alert.height,
  );
  expect(rows.y).toBeGreaterThan(alert.y + alert.height);
  await capture(page, "profile-upload-error-390");
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  await expect(page.locator(".navigation-profile .avatar img")).toHaveAttribute(
    "src",
    firstURL,
  );
  expect(
    (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
  ).toBe(firstURL);
  await page.unroute("**/api/profile/avatar");
  const retryURL = await savePhoto(page, () =>
    card.getByRole("button", { name: "Réessayer", exact: true }).click(),
  );
  expect(retryURL).not.toBe(firstURL);
  expect(uploadRequests).toBe(2);
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Réessayer", exact: true }),
  ).toHaveCount(0);
  const repeatedURL = await savePhoto(page, () =>
    input.setInputFiles(replacementImage),
  );
  expect(repeatedURL).not.toBe(retryURL);
  expect(uploadRequests).toBe(3);
});

test("profile photos appear on named guestbook posts while anonymous posts keep a neutral identity", async ({
  page,
}) => {
  const guest = await enterGuest(page, "Morgan Profile Guestbook Test");
  const image = await profileImage(page);
  const avatarURL = await savePhoto(page, () =>
    page.locator('.profile-panel input[type="file"]').setInputFiles(image),
  );
  const namedBody = "A named message with a profile photo.";
  const anonymousBody = "An anonymous message without a profile photo.";
  for (const [body, anonymous] of [
    [namedBody, false],
    [anonymousBody, true],
  ] as const) {
    const created = await page.request.post("/api/guestbook", {
      headers: mutationHeaders,
      data: { body, anonymous },
    });
    expect(created.status()).toBe(201);
  }
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Livre d'or", exact: true })
    .click();
  const named = page.locator("article").filter({ hasText: namedBody });
  await expect(named).toContainText(guest.name);
  await expect(named.locator(".avatar img")).toHaveAttribute("src", avatarURL);
  const anonymous = page.locator("article").filter({ hasText: anonymousBody });
  await expect(anonymous.getByText("Anonyme", { exact: true })).toBeVisible();
  await expect(anonymous).not.toContainText(guest.name);
  await expect(anonymous.locator("img")).toHaveCount(0);
  const hostEntries = (await (await host.get("/api/guestbook")).json())
    .items as {
    body: string;
    author: { id: number; avatarUrl: string } | null;
    anonymous: boolean;
  }[];
  expect(
    hostEntries.find((entry) => entry.body === namedBody)?.author,
  ).toMatchObject({
    id: guest.id,
    avatarUrl: avatarURL,
  });
  expect(
    hostEntries.find((entry) => entry.body === anonymousBody),
  ).toMatchObject({
    author: null,
    anonymous: true,
  });
  expect((await host.get(avatarURL)).status()).toBe(200);
  const visitor = await request.newContext({ baseURL });
  try {
    expect((await visitor.get(avatarURL)).status()).toBe(401);
  } finally {
    await visitor.dispose();
  }
});

test("the photo opens its menu from the avatar and the camera badge, by pointer and keyboard", async ({
  page,
}) => {
  await enterGuest(page, "Noa Profile Menu Test");
  const card = page.locator(".profile-panel");
  const photo = photoButton(page);
  const menu = photoMenu(page);
  const choose = menuItem(page, "Choisir une photo");
  const remove = menuItem(page, "Supprimer la photo");
  const formats = "JPEG, PNG ou WebP, jusqu’à 3 Mo.";

  // The page says nothing the screen already shows: the name is its title,
  // and the old photo controls are gone.
  await expect(page).toHaveTitle(/^Profil/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Noa Profile Menu Test",
  );
  await expect(
    page.getByRole("heading", { name: "Profil", exact: true }),
  ).toHaveCount(0);
  await expect(card.getByText(/^(Invité|Organisateur)$/)).toHaveCount(0);
  await expect(card.getByText(formats, { exact: true })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: /Changer de photo|Supprimer/ }),
  ).toHaveCount(0);
  await expect(card.locator(".profile-rows > *")).toHaveCount(2);
  await expect(card.locator(".avatar")).toHaveText("N");
  await capture(page, "profile-without-photo-390");

  // A press on the avatar opens the menu and moves the focus into it.
  await expect(photo).toHaveAttribute("aria-haspopup", "menu");
  await expect(photo).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveCount(0);
  await card.locator(".profile-photo-trigger .avatar").click();
  await expect(menu).toBeVisible();
  await expect(photo).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(choose).toBeFocused();
  await expect(remove).toHaveCount(0);
  // The formats and the size limit live in the menu and describe its action.
  await expect(card.getByText(formats, { exact: true })).toBeVisible();
  await expect(choose).toHaveAccessibleDescription(formats);
  await capture(page, "profile-menu-without-photo-390");

  // Escape closes it and returns the focus to the photo.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(photo).toBeFocused();
  await expect(photo).toHaveAttribute("aria-expanded", "false");

  // The camera badge is part of the same button; a press elsewhere closes.
  const camera = card.locator(".profile-photo-camera");
  await camera.click();
  await expect(menu).toBeVisible();
  await camera.click();
  await expect(menu).toHaveCount(0);
  await camera.click();
  await expect(menu).toBeVisible();
  await page.getByRole("banner").locator("strong").click();
  await expect(menu).toHaveCount(0);

  // With a saved photo the menu also removes it.
  const image = await profileImage(page);
  await savePhoto(page, () =>
    card.locator('input[type="file"]').setInputFiles(image),
  );
  await capture(page, "profile-with-photo-390");
  await photo.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await expect(choose).toBeFocused();
  await capture(page, "profile-menu-with-photo-390");
  await page.keyboard.press("ArrowDown");
  await expect(remove).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(choose).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Home");
  await expect(choose).toBeFocused();
  await page.keyboard.press("End");
  await expect(remove).toBeFocused();

  // Tabbing past the last item leaves the menu, which closes behind.
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(photo).not.toBeFocused();

  // Space opens it too; removing keeps the keyboard on the photo.
  await photo.press("Space");
  await expect(choose).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expectSavedAnnouncement(card, "Photo de profil supprimée.");
  await expect(menu).toHaveCount(0);
  await expect(photo).toBeFocused();
  await expect(card.locator(".avatar")).toHaveText("N");
  await photo.press("Enter");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
});

test("a blocked notification permission is explained under its row", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      get: () => "denied",
    });
  });
  await enterGuest(page, "Lou Profile Notification Test");
  const control = page.locator(".profile-panel .notification-control");
  const toggle = control.getByRole("switch", {
    name: "Notifications",
    exact: true,
  });
  const message = control.getByText("Les notifications sont bloquées.", {
    exact: true,
  });
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  await expect(message).toBeVisible();
  await expect(
    control.getByText(
      "Autorise-les dans les réglages de ce site ou de l’app, puis reviens ici.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    control.getByRole("button", { name: "Vérifier à nouveau", exact: true }),
  ).toBeVisible();
  const row = (await control.locator(".notification-summary").boundingBox())!;
  expect((await message.boundingBox())!.y).toBeGreaterThanOrEqual(
    row.y + row.height,
  );
  await capture(page, "profile-notifications-blocked-390");
});

test("the profile is one centered column that clears the dock from 320px to desktop", async ({
  page,
  browser,
}) => {
  await enterGuest(page, "Maximilienne Profile Layout Test");
  const card = page.locator(".profile-panel");
  const image = await profileImage(page, "#b0763f");
  await savePhoto(page, () =>
    card.locator('input[type="file"]').setInputFiles(image),
  );
  const signOut = card.getByRole("button", {
    name: "Se déconnecter",
    exact: true,
  });
  const dock = page.getByRole("navigation");

  for (const [width, height, photoSize] of [
    [320, 568, 112],
    [390, 844, 112],
    [1280, 800, 128],
  ]) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    const column = (await card.boundingBox())!;
    expect(column.width).toBeLessThanOrEqual(420);
    expect(column.x + column.width / 2).toBeCloseTo(width / 2, 0);

    // The photo, its ring and the name share the column's axis.
    const avatar = (await card.locator(".avatar").boundingBox())!;
    expect(avatar.width).toBe(photoSize);
    expect(avatar.height).toBe(photoSize);
    expect(avatar.x + avatar.width / 2).toBeCloseTo(width / 2, 0);
    const ring = (await photoButton(page).boundingBox())!;
    expect(ring.width).toBe(photoSize + 10);
    // The camera badge overlaps the ring's lower right edge.
    const camera = (await card.locator(".profile-photo-camera").boundingBox())!;
    expect(camera.width).toBe(40);
    expect(camera.x + camera.width).toBeGreaterThan(avatar.x + avatar.width);
    expect(camera.y + camera.height).toBeGreaterThan(avatar.y + avatar.height);
    const name = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(name.y).toBeGreaterThan(ring.y + ring.height);
    expect(name.x + name.width / 2).toBeCloseTo(width / 2, 0);

    // Both rows fill the column. Scrolled to its end, the page lifts the
    // last one above the dock and above the upload pill that floats over it
    // (140px from the bottom edge).
    const rows = await card
      .locator(".profile-rows > *")
      .evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().width),
      );
    expect(rows).toEqual([column.width, column.width]);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const last = (await signOut.boundingBox())!;
    expect(last.y + last.height).toBeLessThan((await dock.boundingBox())!.y);
    expect(last.y + last.height).toBeLessThanOrEqual(height - 140);

    // The open menu stays inside the window.
    await page.evaluate(() => window.scrollTo(0, 0));
    await photoButton(page).click();
    const menu = (await card.locator(".profile-photo-menu").boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    expect(menu.x + menu.width / 2).toBeCloseTo(width / 2, 0);
    if (width === 320) await capture(page, "profile-menu-320");
    await page.getByRole("banner").locator("strong").click();
    await expect(card.locator(".profile-photo-menu")).toHaveCount(0);
    await capture(page, `profile-${width}`);
  }

  // The longest row label, in German, still fits a 320px phone on one line.
  const german = await browser.newContext({
    baseURL,
    locale: "de-CH",
    viewport: { width: 320, height: 568 },
    storageState: await page.context().storageState(),
  });
  try {
    const germanPage = await german.newPage();
    await germanPage.goto("/profil");
    const label = germanPage.getByRole("heading", {
      name: "Benachrichtigungen",
      exact: true,
    });
    await expect(label).toBeVisible();
    expect((await label.boundingBox())!.height).toBeLessThan(30);
    await expectNoHorizontalOverflow(germanPage);
    await germanPage.screenshot({
      path: test.info().outputPath("profile-320-de.png"),
      animations: "disabled",
      style: "nextjs-portal { visibility: hidden; }",
    });
  } finally {
    await german.close();
  }
});
