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
let host: APIRequestContext;

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Profile Test Host"],
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
});

test.afterAll(async () => {
  await host?.dispose();
});

async function enterGuest(page: Page, name: string) {
  const created = await host.post("/api/admin/guests", { data: { name } });
  expect(created.status()).toBe(201);
  const invitation = (await created.json()) as {
    guest: { id: number; name: string };
    invitationUrl: string;
  };
  const accepted = await page.request.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitation.invitationUrl) },
  });
  expect(accepted.status()).toBe(200);
  await page.goto("/parametres");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return invitation.guest;
}

async function profileImage(page: Page, color = "#60917e") {
  // A local, synthetic landscape image also exercises the square avatar crop.
  const data = await page.evaluate((background) => {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 256;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = background;
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = "#eed3bb";
    drawing.beginPath();
    drawing.arc(192, 100, 48, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#393347";
    drawing.beginPath();
    drawing.ellipse(192, 249, 92, 88, 0, 0, Math.PI * 2);
    drawing.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  }, color);
  return {
    name: "profile-test.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

async function savePhoto(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile/avatar") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Enregistrer la photo", exact: true })
    .click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  const profile = (await saved.json()) as {
    guest: { id: number; avatarUrl: string };
  };
  await expect(
    page.getByText("Photo de profil enregistrée.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-header .avatar img")).toHaveAttribute(
    "src",
    profile.guest.avatarUrl,
  );
  return profile.guest.avatarUrl;
}

test("guests preview, save, replace and remove their profile photo across tab changes and reloads", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await enterGuest(page, "Camille Profile Test");
  const card = page.locator(".profile-card");
  const input = card.locator('input[type="file"]');
  const headerAvatar = page.locator(".app-header .avatar");
  const preview = card.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(input).toHaveAttribute("aria-label", "Photo de profil");
  await expect(input).toBeHidden();
  await expect(headerAvatar).toHaveText("C");
  const image = await profileImage(page);
  const chooser = page.waitForEvent("filechooser");
  await card
    .getByRole("button", { name: "Choisir une photo", exact: true })
    .press("Enter");
  await (await chooser).setFiles(image);
  await expect(preview).toBeVisible();
  await expect(headerAvatar.locator("img")).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
  ).toBeNull();

  await page.screenshot({
    path: "test-results/profile-preview-mobile.png",
    fullPage: true,
  });
  const firstURL = await savePhoto(page);
  await expect(preview).toHaveCount(0);
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  const storedImage = await page.request.get(firstURL);
  expect(storedImage.status()).toBe(200);
  expect(storedImage.headers()["content-type"]).toBe("image/jpeg");
  await expect(headerAvatar.locator("img")).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await expect(headerAvatar.locator("img")).toHaveJSProperty(
    "naturalHeight",
    256,
  );

  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("link", { name: "Programme", exact: true })
    .click();
  await expect(page).toHaveURL(/\/programme$/);
  await expect(headerAvatar.locator("img")).toHaveAttribute("src", firstURL);
  await navigation
    .getByRole("link", { name: "Paramètres", exact: true })
    .click();
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  await page.reload();
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  await page.screenshot({
    path: "test-results/profile-settings-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/profile-settings-desktop.png",
    fullPage: true,
  });

  const replacementChooser = page.waitForEvent("filechooser");
  await card
    .getByRole("button", { name: "Changer de photo", exact: true })
    .click();
  await (
    await replacementChooser
  ).setFiles(await profileImage(page, "#a26679"));
  await expect(preview).toBeVisible();
  await card.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(card.locator(".avatar img")).toHaveAttribute("src", firstURL);
  await input.setInputFiles(await profileImage(page, "#a26679"));
  const replacementURL = await savePhoto(page);
  expect(replacementURL).not.toBe(firstURL);

  await card
    .getByRole("button", { name: "Supprimer la photo", exact: true })
    .click();
  await expect(
    card.getByText("Photo de profil supprimée.", { exact: true }),
  ).toBeVisible();
  await expect(headerAvatar.locator("img")).toHaveCount(0);
  await expect(headerAvatar).toHaveText("C");
  await expect(card.locator(".avatar")).toHaveText("C");
  await page.reload();
  await expect(card.locator(".avatar")).toHaveText("C");
  expect((await page.request.get(replacementURL)).status()).toBe(404);
  expect(browserErrors).toEqual([]);
});

test("a failed profile photo save retains the current avatar and selected preview for retry", async ({
  page,
}) => {
  await enterGuest(page, "Alex Profile Retry Test");
  const card = page.locator(".profile-card");
  const input = card.locator('input[type="file"]');
  await input.setInputFiles(await profileImage(page));
  const firstURL = await savePhoto(page);

  await input.setInputFiles({
    name: "profile.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not an image."),
  });
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(page.locator(".app-header .avatar img")).toHaveAttribute(
    "src",
    firstURL,
  );
  expect(
    (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
  ).toBe(firstURL);

  await input.setInputFiles(await profileImage(page, "#8a6ca5"));
  const preview = card.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(preview).toBeVisible();
  const previewURL = await preview.getAttribute("src");
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
  await card
    .getByRole("button", { name: "Enregistrer la photo", exact: true })
    .click();
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(preview).toHaveAttribute("src", previewURL!);
  await expect(page.locator(".app-header .avatar img")).toHaveAttribute(
    "src",
    firstURL,
  );
  expect(
    (await (await page.request.get("/api/profile")).json()).guest.avatarUrl,
  ).toBe(firstURL);
  await page.unroute("**/api/profile/avatar");
  expect(await savePhoto(page)).not.toBe(firstURL);
  await expect(preview).toHaveCount(0);
});

test("profile photos appear on named guestbook posts while anonymous posts keep a neutral identity", async ({
  page,
}) => {
  const guest = await enterGuest(page, "Morgan Profile Guestbook Test");
  await page
    .locator('.profile-card input[type="file"]')
    .setInputFiles(await profileImage(page));
  const avatarURL = await savePhoto(page);
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
