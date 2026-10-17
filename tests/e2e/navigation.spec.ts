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
    ["scripts/backend.mjs", "invite-admin", "--name", "Navigation Test Host"],
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
    guest: { id: number };
    invitationUrl: string;
  };
  const accepted = await page.request.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitation.invitationUrl) },
  });
  expect(accepted.status()).toBe(200);
  return invitation.guest;
}

test("a slow tab shows immediate feedback and does not block another tab", async ({
  page,
}) => {
  await enterGuest(page, "Pending Navigation Guest");
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
    await programme.click({ noWaitAfter: true });
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
      path: "test-results/navigation-feedback-mobile.png",
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectNavigationFeedback();
    await page.screenshot({
      path: "test-results/navigation-feedback-desktop.png",
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
  await enterGuest(page, "Fresh Programme Guest");
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
      .click();
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
  const guest = await enterGuest(page, "Revoked Navigation Guest");
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
    .click();
  await expect(page).toHaveURL(/\/invitation$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
});
