import { test, expect, type APIRequestContext } from "@playwright/test";
import { bootstrapHost, shareSession, signInGuest } from "./support/party";
import { openSettingsSection } from "./support/settings";

let host: APIRequestContext;

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Navigation Test Host");
});

test.afterAll(async () => {
  await host?.dispose();
});

test("guests open their profile from the final navigation icon and cannot access administration", async ({
  page,
}) => {
  await signInGuest(host, page, "Profile Navigation Guest");
  await page.goto("/photos");
  const navigation = page.getByRole("navigation");
  await expect(navigation.getByRole("link")).toHaveCount(4);
  expect(
    await navigation
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Programme",
    "Médias",
    "Livre d'or",
    "Profil: Profile Navigation Guest",
  ]);
  await expect(
    page.getByRole("link", { name: "Paramètres", exact: true }),
  ).toHaveCount(0);
  const profile = page.getByRole("link", {
    name: "Profil: Profile Navigation Guest",
    exact: true,
  });
  await expect(profile.locator(".avatar")).toBeVisible();
  await expect(page.locator(".app-header a")).toHaveCount(0);
  await profile.press("Enter");
  await expect(page).toHaveURL(/\/profil$/);
  await expect(profile).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Profil", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choisir une photo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".notification-control")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Se déconnecter", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-page, .welcome-admin")).toHaveCount(0);
  await page.goto("/parametres?section=programme");
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.locator(".settings-page, .welcome-admin")).toHaveCount(0);
  expect((await page.request.get("/api/admin/guests")).status()).toBe(403);
});

test("administrators have separate settings and personal profile controls", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.goto("/photos");
  const navigation = page.getByRole("navigation");
  await expect(navigation.getByRole("link")).toHaveCount(5);
  expect(
    await navigation
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Programme",
    "Médias",
    "Livre d'or",
    "Paramètres",
    "Profil: Navigation Test Host",
  ]);
  await navigation
    .getByRole("link", { name: "Paramètres", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(
    page.getByRole("heading", { name: "Paramètres", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('a[href="/parametres?section=guests"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href="/parametres?section=welcome"]'),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("settings-mobile.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
  await expect(page.locator(".profile-photo-editor")).toHaveCount(0);
  await expect(page.locator(".notification-control")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Se déconnecter", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /^Profil:/ }).press("Enter");
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.locator(".profile-photo-editor")).toBeVisible();
  await expect(page.locator(".notification-control")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Se déconnecter", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-page, .welcome-admin")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("profile-mobile.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
  await expect(
    navigation.getByRole("link", { name: "Paramètres", exact: true }),
  ).toBeVisible();
});

test("grouped settings save edits and preserve creation drafts through browser history", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.goto("/parametres");
  for (const name of ["La fête", "Invités et accès", "Photos et vidéos"]) {
    await expect(
      page.getByRole("heading", { name, exact: true, level: 2 }),
    ).toBeVisible();
  }
  const sections = [
    "party",
    "programme",
    "welcome",
    "information",
    "guests",
    "invitation",
    "categories",
    "uploads",
  ];
  expect(
    await page
      .locator(".settings-menu-link")
      .evaluateAll((links) =>
        links.map((link) =>
          new URL((link as HTMLAnchorElement).href).searchParams.get("section"),
        ),
      ),
  ).toEqual(sections);
  await expect(page.locator('a[href="/parametres?section=age"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[href="/parametres?section=party"] .lucide-cake'),
  ).toBeVisible();
  await expect(
    page
      .locator(".settings-section")
      .filter({
        has: page.getByRole("heading", { name: "La fête", exact: true }),
      })
      .locator('a[href="/parametres?section=welcome"]'),
  ).toBeVisible();
  await expect(page.locator(".settings-page details")).toHaveCount(0);

  await page.screenshot({
    path: test.info().outputPath("settings-autosave", "menu-390.png"),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: test.info().outputPath(`settings-menu-${width}.png`),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { visibility: hidden; }",
    });
  }

  const partyLink = page.locator('a[href="/parametres?section=party"]');
  await page.setViewportSize({ width: 390, height: 844 });
  await partyLink.press("Enter");
  const partyHeading = page.getByRole("heading", {
    name: "Infos de la fête",
    exact: true,
    level: 1,
  });
  await expect(partyHeading).toBeVisible();
  await expect(partyHeading).toBeFocused();
  const partyName = page.getByLabel("Nom de la fête", { exact: true });
  await expect(page.getByLabel("Âge", { exact: true })).toBeVisible();
  await partyName.fill("Saved settings navigation title");
  const back = page.getByRole("button", {
    name: "Retour aux paramètres",
    exact: true,
  });
  await back.click();
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(partyLink).toBeFocused();
  expect((await (await host.get("/api/party")).json()).title).toBe(
    "Saved settings navigation title",
  );
  await expect(
    page.getByRole("textbox", { name: "Nom de la fête", exact: true }),
  ).toHaveCount(0);

  await openSettingsSection(page, "guests");
  const guestName = page.getByLabel("Prénom de l’invité", { exact: true });
  await guestName.fill("Unsubmitted guest draft");
  await page.goBack();
  await expect(page).toHaveURL(/\/parametres$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/parametres\?section=guests$/);
  await expect(guestName).toHaveValue("Unsubmitted guest draft");
  await openSettingsSection(page, "party");
  await expect(partyName).toHaveValue("Saved settings navigation title");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("settings-autosave", "party-390.png"),
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    style: "nextjs-portal { visibility: hidden; }",
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`settings-subpage-${width}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      style: "nextjs-portal { visibility: hidden; }",
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/parametres?section=programme");
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true, level: 1 }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Ajouter un événement", exact: true }),
  ).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(
    page.getByRole("heading", { name: "Paramètres", exact: true, level: 1 }),
  ).toBeVisible();
});

test("desktop settings retain their sidebar, save section changes and preserve drafts across resizing", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const originalParty = await (await host.get("/api/party")).json();
  try {
    await page.goto("/parametres");
    const menu = page.getByRole("navigation", {
      name: "Paramètres",
      exact: true,
    });
    const partyLink = menu.locator('a[href="/parametres?section=party"]');
    const guestsLink = menu.locator('a[href="/parametres?section=guests"]');
    await expect(partyLink).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#party-editor")).toBeVisible();
    await expect(page.locator(".settings-back:visible")).toHaveCount(0);
    const name = page.getByLabel("Nom de la fête", { exact: true });
    await name.fill("Desktop sidebar saved title");
    await page.route("**/api/admin/party", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal_error",
          error: "Simulated save failure",
        }),
      }),
    );
    await guestsLink.click();
    await expect(page).toHaveURL(/\/parametres$/);
    await expect(partyLink).toHaveAttribute("aria-current", "page");
    await expect(name).toHaveValue("Desktop sidebar saved title");
    await expect(page.locator("#party-editor [role=alert]")).toBeVisible();
    await expect(page.locator(".settings-page")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.unroute("**/api/admin/party");
    await guestsLink.click();
    await expect(page.locator("#guests-editor")).toBeVisible();
    await expect(guestsLink).toHaveAttribute("aria-current", "page");
    expect((await (await host.get("/api/party")).json()).title).toBe(
      "Desktop sidebar saved title",
    );
    const draft = page.getByLabel("Prénom de l’invité", { exact: true });
    await draft.fill("Desktop unsent guest draft");
    await partyLink.click();
    await page.goBack();
    await expect(draft).toHaveValue("Desktop unsent guest draft");
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(menu).toBeHidden();
    await expect(draft).toHaveValue("Desktop unsent guest draft");
    await expect(page.locator(".settings-back:visible")).toHaveCount(1);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(menu).toBeVisible();
    await expect(draft).toHaveValue("Desktop unsent guest draft");
    await expect(page.locator(".settings-screen[data-leaving]")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("settings-sidebar.png"),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { visibility: hidden; }",
    });
    await page.goto("/parametres?section=welcome");
    await expect(page.locator("#welcome-editor")).toBeVisible();
    await expect(menu.locator('[aria-current="page"]')).toHaveAttribute(
      "href",
      "/parametres?section=welcome",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await page.unroute("**/api/admin/party");
    await host.patch("/api/admin/party", { data: originalParty });
  }
});

type SettingsSlide = {
  screen: string;
  from: number;
  to: number;
  fades: boolean;
  duration: number;
};

test("a settings page slides in across the screen while the list drifts back and fades, and returning reverses it", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/parametres");
  await page.evaluate(() => {
    const target = window as Window & { settingsSlides?: SettingsSlide[] };
    target.settingsSlides = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (
        this instanceof HTMLElement &&
        this.matches(".settings-screen") &&
        animation.effect instanceof KeyframeEffect
      ) {
        const frames = animation.effect.getKeyframes();
        // Horizontal offsets in pixels, whatever notation the keyframes use.
        const offset = (frame: ComputedKeyframe) =>
          Math.round(new DOMMatrixReadOnly(String(frame.transform)).e * 100) /
          100;
        target.settingsSlides!.push({
          screen: this.dataset.settingsScreen!,
          from: offset(frames[0]),
          to: offset(frames[frames.length - 1]),
          fades:
            Number(frames[0].opacity) === 1 &&
            Number(frames[frames.length - 1].opacity) === 0,
          duration: Number(animation.effect.getTiming().duration),
        });
      }
      return animation;
    };
  });
  async function slides() {
    return page.evaluate(
      () =>
        (window as Window & { settingsSlides?: SettingsSlide[] })
          .settingsSlides,
    );
  }
  const width = page.viewportSize()!.width;
  const duration = 380;

  await openSettingsSection(page, "party");
  // The section crosses the whole screen; the list drifts a third as far.
  const forward: SettingsSlide[] = [
    { screen: "party", from: width, to: 0, fades: false, duration },
    { screen: "index", from: 0, to: -0.3 * width, fades: true, duration },
  ];
  await expect.poll(slides).toEqual(forward);
  await expect(page.locator('[data-settings-screen="index"]')).toBeHidden();

  await page
    .getByRole("button", { name: "Retour aux paramètres", exact: true })
    .click();
  await expect(page).toHaveURL(/\/parametres$/);
  await expect
    .poll(slides)
    .toEqual([
      ...forward,
      { screen: "index", from: -width, to: 0, fades: false, duration },
      { screen: "party", from: 0, to: 0.3 * width, fades: true, duration },
    ]);
  await expect(page.locator('[data-settings-screen="party"]')).toBeHidden();
});

test("settings navigation respects reduced motion", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/parametres");
  await page.evaluate(() => {
    const target = window as Window & { settingsAnimationCount?: number };
    target.settingsAnimationCount = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.closest(".settings-page")) {
        target.settingsAnimationCount =
          (target.settingsAnimationCount ?? 0) + 1;
      }
      return animate.call(this, keyframes, options);
    };
  });
  await openSettingsSection(page, "party");
  await expect(
    page.getByRole("heading", {
      name: "Infos de la fête",
      exact: true,
      level: 1,
    }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Retour aux paramètres", exact: true })
    .click();
  await expect(page).toHaveURL(/\/parametres$/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { settingsAnimationCount?: number })
          .settingsAnimationCount,
    ),
  ).toBe(0);
});

test("icon navigation keeps the dark theme and its touch targets on phones and desktops", async ({
  page,
}) => {
  await signInGuest(host, page, "Theme Navigation Guest");
  // The single dark theme does not follow a light device preference.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/photos");
  const navigation = page.getByRole("navigation");
  await expect(navigation).toBeVisible();

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(16, 15, 14)",
    );
    await expect(
      navigation.getByRole("link", { name: "Médias", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const bounds = await navigation.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThan(780);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    for (const link of await navigation.getByRole("link").all()) {
      const target = await link.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: test.info().outputPath(`navigation-${width}.png`),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { visibility: hidden; }",
    });
  }
  await navigation
    .getByRole("link", { name: "Profil: Theme Navigation Guest", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/profil$/);
});

test("a slow tab shows immediate feedback and does not block another tab", async ({
  page,
}) => {
  await signInGuest(host, page, "Pending Navigation Guest");
  let releaseResponse!: () => void;
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestHeld = false;
  await page.route(
    (url) => url.pathname === "/programme",
    async (route) => {
      if (route.request().headers().rsc !== "1") return route.continue();
      requestHeld = true;
      const response = await route.fetch();
      await responseHeld;
      await route.fulfill({ response });
    },
  );
  try {
    await page.goto("/photos");
    const mediaHeading = page.getByRole("heading", {
      name: "Médias",
      exact: true,
    });
    await expect(mediaHeading).toBeVisible();
    const navigation = page.getByRole("navigation");
    const programme = navigation.getByRole("link", {
      name: "Programme",
      exact: true,
    });
    await programme.press("Enter", { noWaitAfter: true });
    await expect.poll(() => requestHeld).toBe(true);
    const pending = programme.locator(".navigation-pending[data-pending]");
    const loading = page.locator('.page-loading[role="status"]');
    async function expectNavigationFeedback() {
      await expect(pending).toHaveCSS("opacity", "1");
      await expect(mediaHeading).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(
        navigation.getByRole("link", { name: "Médias", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await expectNavigationFeedback();
    await expect(programme.locator(".navigation-pending")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "Programme", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("navigation-feedback-mobile.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectNavigationFeedback();
    await page.screenshot({
      path: test.info().outputPath("navigation-feedback-desktop.png"),
      fullPage: true,
      caret: "initial",
    });
    await navigation
      .getByRole("link", { name: "Livre d'or", exact: true })
      .click();
    await expect(page).toHaveURL(/\/livre-d-or$/);
    await expect(page.getByLabel("Ton message", { exact: true })).toBeVisible();
    await expect(pending).toHaveCount(0);
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page).toHaveURL(/\/livre-d-or$/);
});

test("returning to the programme fetches host changes without a manual refresh", async ({
  page,
}) => {
  await signInGuest(host, page, "Fresh Programme Guest");
  const initialEvent = {
    title: "Navigation test gathering",
    description: "Original gathering details",
    teaser: "",
    startsAt: null,
    unlockAt: null,
  };
  const created = await host.post("/api/admin/programme", {
    data: initialEvent,
  });
  expect(created.status()).toBe(201);
  const event = (await created.json()) as { id: number };
  try {
    await page.goto("/programme");
    await expect(
      page.getByRole("heading", { name: initialEvent.title, exact: true }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation");
    // Also cover keyboard navigation; the development toolbar overlaps this mobile tab.
    await navigation
      .getByRole("link", { name: "Médias", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/photos$/);
    const updated = await host.put(`/api/admin/programme/${event.id}`, {
      data: {
        ...initialEvent,
        title: "Updated navigation test gathering",
        description: "Updated gathering details",
      },
    });
    expect(updated.status()).toBe(200);
    await navigation
      .getByRole("link", { name: "Programme", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Updated navigation test gathering",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Updated gathering details", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: initialEvent.title, exact: true }),
    ).toHaveCount(0);
  } finally {
    expect(
      (await host.delete(`/api/admin/programme/${event.id}`)).status(),
    ).toBe(204);
  }
});

test("a revoked guest returns to the invitation when revisiting a tab without realtime", async ({
  page,
}) => {
  // Exercise authorization on navigation when the realtime connection is unavailable.
  let blockedConnections = 0;
  await page.routeWebSocket(
    (url) => url.pathname === "/api/realtime",
    async (socket) => {
      blockedConnections++;
      await socket.close({ code: 1013, reason: "Connection unavailable" });
    },
  );
  const guest = await signInGuest(host, page, "Revoked Navigation Guest");
  await page.goto("/programme");
  await expect(
    page.getByRole("heading", { name: "Programme", exact: true }),
  ).toBeVisible();
  await expect.poll(() => blockedConnections).toBeGreaterThan(0);
  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("link", { name: "Médias", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/photos$/);
  expect((await host.delete(`/api/admin/guests/${guest.id}`)).status()).toBe(
    204,
  );
  await navigation
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/invitation$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
});
