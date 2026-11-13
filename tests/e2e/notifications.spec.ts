import { openSettingsSection } from "./support/settings";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  baseURL,
  bootstrapHost,
  mutationHeaders,
  shareSession,
  signInGuest,
} from "./support/party";
import { welcomeControls, type AdminWelcome } from "./support/welcome";
import { acceptConfirmation } from "./support/confirm";
import { createECDH, randomBytes, randomUUID } from "node:crypto";

let host: APIRequestContext;
let original: AdminWelcome;
const {
  state,
  transition,
  saveSteps: save,
  setRequired: required,
  restoreOpen: reset,
} = welcomeControls(() => host);
let subscriptions: { client: APIRequestContext; endpoint: string }[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

async function startWelcome() {
  await transition("start");
  await save([
    {
      widgets: [
        { type: "title", text: "Keep the next activity nearby" },
        { type: "enable_notifications" },
      ],
    },
    { widgets: [{ type: "title", text: "Find your table" }] },
  ]);
  await required(true);
  await transition("next");
  await transition("next");
}

async function status(page: Page, endpoint: string) {
  const response = await page.request.post("/api/notifications/status", {
    headers: mutationHeaders,
    data: { endpoint },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).subscribed as boolean;
}

async function mockPush(
  page: Page,
  permission: "default" | "granted" | "denied" = "default",
  existing = false,
) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const config = await host.get("/api/notifications");
  expect(config.status()).toBe(200);
  const { publicKey } = await config.json();
  const fixture = {
    endpoint: `https://push.example.invalid/${randomUUID()}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  subscriptions.push({ client: page.request, endpoint: fixture.endpoint });
  await page.addInitScript(
    ({ fixture, permission, existing, publicKey }) => {
      const stateKey = "notification-test-state";
      const stored = sessionStorage.getItem(stateKey);
      const mock = stored
        ? JSON.parse(stored)
        : {
            permission,
            subscribed: existing,
            prompts: 0,
            subscriptions: 0,
            gestures: [],
            applicationKey: Array.from(
              atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
              (character) => character.charCodeAt(0),
            ),
          };
      const persist = () =>
        sessionStorage.setItem(stateKey, JSON.stringify(mock));
      persist();
      Object.defineProperty(Notification, "permission", {
        get: () => mock.permission,
      });
      Notification.requestPermission = async () => {
        mock.prompts++;
        mock.gestures.push(navigator.userActivation.isActive);
        mock.permission = mock.permission === "denied" ? "denied" : "granted";
        persist();
        return mock.permission;
      };
      const subscription = {
        endpoint: fixture.endpoint,
        get options() {
          return {
            userVisibleOnly: true,
            applicationServerKey: new Uint8Array(mock.applicationKey).buffer,
          };
        },
        toJSON: () => fixture,
        unsubscribe: async () => {
          mock.subscribed = false;
          persist();
          return true;
        },
      };
      PushManager.prototype.getSubscription = async () =>
        mock.subscribed ? (subscription as unknown as PushSubscription) : null;
      PushManager.prototype.subscribe = async (options) => {
        if (
          !options?.userVisibleOnly ||
          new Uint8Array(options.applicationServerKey as ArrayBuffer).length !==
            65
        ) {
          throw new Error(
            "Expected a visible push subscription with a P-256 application key.",
          );
        }
        mock.subscriptions++;
        mock.subscribed = true;
        mock.applicationKey = Array.from(
          new Uint8Array(options.applicationServerKey as ArrayBuffer),
        );
        persist();
        return subscription as unknown as PushSubscription;
      };
    },
    { fixture, permission, existing, publicKey },
  );
  return fixture;
}

async function pushState(page: Page) {
  return page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("notification-test-state")!),
  );
}

test.beforeAll(async () => {
  host = await bootstrapHost("Notifications Test Host");
  original = await state();
});

test.beforeEach(async () => {
  subscriptions = [];
  await reset([]);
});

test.afterEach(async () => {
  // Remove test subscriptions before any unlock can enqueue a delivery.
  for (const { client, endpoint } of subscriptions) {
    expect(
      (
        await client.delete("/api/notifications/subscription", {
          headers: mutationHeaders,
          data: { endpoint },
        })
      ).status(),
    ).toBe(204);
  }
  await reset(original.steps, original.required);
});

test.afterAll(async () => {
  await host?.dispose();
});

test("the notification widget can be reordered and saved without settings", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const editor = page.locator(".welcome-admin");
  await editor
    .getByRole("button", { name: "Ajouter une étape", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Ajouter le widget Titre", exact: true })
    .click();
  await page
    .getByLabel("Titre du widget 1", { exact: true })
    .fill("Keep the next activity nearby");
  const add = editor.getByRole("button", {
    name: "Ajouter le widget Activer les notifications",
    exact: true,
  });
  await add.click();
  await expect(add).toBeDisabled();
  const widget = editor.locator('[data-widget-type="enable_notifications"]');
  await expect(widget.locator("input, select, textarea")).toHaveCount(0);
  await widget
    .getByRole("button", { name: "Monter le widget 2", exact: true })
    .press("Enter");
  await expect(editor.locator("[data-widget-key]").first()).toHaveAttribute(
    "data-widget-type",
    "enable_notifications",
  );
  await expect(editor).not.toHaveAttribute("data-dirty", "true");
  await expect(editor).toHaveAttribute("aria-busy", "false");
  expect((await state()).steps).toEqual([
    {
      widgets: [
        { type: "enable_notifications" },
        { type: "title", text: "Keep the next activity nearby" },
      ],
    },
  ]);
  await page.reload();
  await expect(editor.locator("[data-widget-key]").first()).toHaveAttribute(
    "data-widget-type",
    "enable_notifications",
  );
  await widget.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("notifications", "editor-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await widget.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("notifications", "editor-mobile.png"),
  });
});

test("permission needs a click and failed server registration can retry the same subscription", async ({
  page,
}) => {
  await startWelcome();
  await signInGuest(host, page, "Notification Retry Guest");
  const fixture = await mockPush(page);
  let saves = 0;
  await page.route("**/api/notifications/subscription", async (route) => {
    if (route.request().method() === "PUT" && ++saves === 1) {
      await route.fulfill({
        status: 503,
        json: { code: "internal_error", error: "Registration unavailable." },
      });
    } else await route.continue();
  });
  await page.goto("/attente");
  const control = page.locator(".notification-control");
  const enable = control.getByRole("button", {
    name: "Activer les notifications",
    exact: true,
  });
  await expect(enable).toBeEnabled();
  expect((await pushState(page)).prompts).toBe(0);
  expect(await status(page, fixture.endpoint)).toBe(false);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.ready).active?.scriptURL,
    ),
  ).toBe(`${baseURL}/sw.js`);
  await page.screenshot({
    path: test.info().outputPath("notifications", "widget-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("notifications", "widget-desktop.png"),
  });
  await enable.click();
  await expect(control.getByRole("alert")).toBeVisible();
  await expect(
    control.getByText("Activées sur cet appareil.", { exact: true }),
  ).toHaveCount(0);
  expect(await status(page, fixture.endpoint)).toBe(false);
  await enable.click();
  await expect(
    control.getByText("Activées sur cet appareil.", { exact: true }),
  ).toBeVisible();
  expect(await status(page, fixture.endpoint)).toBe(true);
  expect((await pushState(page)).subscriptions).toBe(1);
  expect((await pushState(page)).gestures).toEqual([true, true]);
  expect(saves).toBe(2);
  await page.reload();
  await expect(
    control.getByText("Activées sur cet appareil.", { exact: true }),
  ).toBeVisible();
  expect(saves).toBe(2);
  await control
    .getByRole("button", { name: "Désactiver sur cet appareil", exact: true })
    .click();
  await expect(enable).toBeEnabled();
  expect(await status(page, fixture.endpoint)).toBe(false);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Find your table", exact: true }),
  ).toBeVisible();
});

test("an existing browser subscription is not silently assigned to another guest", async ({
  page,
}) => {
  const fixture = await mockPush(page, "granted", true);
  await signInGuest(host, page, "First Notification Guest");
  let saves = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/notifications/subscription") &&
      request.method() === "PUT"
    )
      saves++;
  });
  await page.goto("/profil");
  const control = page.locator(".notification-control");
  const toggle = control.getByRole("switch", {
    name: "Notifications",
    exact: true,
  });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(saves).toBe(0);
  await toggle.press("Space");
  await expect(toggle).toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(true);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(page).toHaveURL(/\/invitation$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await signInGuest(host, page, "Second Notification Guest");
  await page.goto("/profil");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(saves).toBe(1);
  expect(await status(page, fixture.endpoint)).toBe(false);
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(true);
  expect((await pushState(page)).subscriptions).toBe(0);
  await control.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("notifications", "settings-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await control.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("notifications", "settings-desktop.png"),
  });
  await toggle.click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(false);
});

test("the profile switch stays off when notification registration fails and can retry", async ({
  page,
}) => {
  const fixture = await mockPush(page);
  await signInGuest(host, page, "Profile Notification Retry Guest");
  await page.goto("/profil");
  const control = page.locator(".notification-control");
  const toggle = control.getByRole("switch", {
    name: "Notifications",
    exact: true,
  });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect((await pushState(page)).prompts).toBe(0);

  await page.route("**/api/notifications/subscription", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 503,
      json: {
        code: "internal_error",
        error: "Unable to save the subscription.",
      },
    });
  });
  await toggle.click();
  await expect(control.getByRole("alert")).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(false);
  expect((await pushState(page)).gestures).toEqual([true]);

  await page.unroute("**/api/notifications/subscription");
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(true);
  await toggle.click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(await status(page, fixture.endpoint)).toBe(false);
});

for (const availability of ["denied", "unsupported", "ios"] as const) {
  test(`the ${availability} state does not block welcome navigation`, async ({
    page,
  }) => {
    await startWelcome();
    await signInGuest(host, page, `Notification ${availability} Guest`);
    if (availability === "denied") await mockPush(page, "denied");
    if (availability === "unsupported")
      await page.addInitScript(() => {
        Reflect.deleteProperty(window, "PushManager");
      });
    if (availability === "ios")
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
          value:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        });
      });
    await page.goto("/attente");
    const control = page.locator(".notification-control");
    const message =
      availability === "denied"
        ? "Les notifications sont bloquées."
        : availability === "unsupported"
          ? "Ce navigateur ne permet pas les notifications. Essaie avec un navigateur récent."
          : "Sur iPhone ou iPad, ouvre l’app depuis l’écran d’accueil.";
    await expect(control.getByText(message, { exact: true })).toBeVisible();
    await expect(
      control.getByRole("button", {
        name: "Activer les notifications",
        exact: true,
      }),
    ).toHaveCount(0);
    if (availability === "denied") {
      expect((await pushState(page)).prompts).toBe(0);
      await control
        .getByRole("button", { name: "Vérifier à nouveau", exact: true })
        .click();
      await expect(control.getByText(message, { exact: true })).toBeVisible();
      expect((await pushState(page)).prompts).toBe(0);
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath("notifications", `${availability}-mobile.png`),
    });
    await page.getByRole("button", { name: "Suivant", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Find your table", exact: true }),
    ).toBeVisible();
  });
}

test("the manifest and icons support standalone installation without private offline caching", async ({
  page,
}) => {
  await page.goto("/invitation");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  const response = await page.request.get("/manifest.webmanifest", {
    headers: { "Accept-Language": "de-CH" },
  });
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "de",
    theme_color: "#100f0e",
  });
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  const worker = await page.request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect(worker.headers()["content-security-policy"]).toContain(
    "script-src 'self'",
  );
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  for (const [language, locale] of [
    ["fr-CH", "fr"],
    ["en-GB", "en"],
  ]) {
    const localized = await page.request.get("/manifest.webmanifest", {
      headers: { "Accept-Language": language },
    });
    expect((await localized.json()).lang).toBe(locale);
  }
});
