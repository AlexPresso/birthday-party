import {
  expectSavedAnnouncement,
  openSettingsSection,
} from "./support/settings";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { bootstrapHost, shareSession } from "./support/party";

const initialParty = {
  title: "Party settings test",
  location: "Test venue",
  timezone: "Europe/Zurich",
  date: "2030-06-01T17:42:37Z",
};
let host: APIRequestContext;
let previousParty: typeof initialParty;

test.use({
  timezoneId: "America/New_York",
  locale: "fr-CH",
  viewport: { width: 390, height: 844 },
});

test.beforeAll(async () => {
  host = await bootstrapHost("Settings Test Host");
  previousParty = await (await host.get("/api/party")).json();
});

test.beforeEach(async ({ context }) => {
  const saved = await host.patch("/api/admin/party", { data: initialParty });
  expect(saved.status()).toBe(200);
  await shareSession(context, host);
});

test.afterAll(async () => {
  if (previousParty) {
    const restored = await host.patch("/api/admin/party", {
      data: previousParty,
    });
    expect(restored.status()).toBe(200);
  }
  await host?.dispose();
});

async function saveParty(page: Page) {
  await page.locator(".admin-form input:focus").blur();
  await expectSavedAnnouncement(
    page,
    "Les infos de la fête sont enregistrées.",
  );
}

async function returnToSettings(page: Page) {
  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/programme$/);
  await navigation
    .getByRole("link", { name: "Paramètres", exact: true })
    .click();
  await expect(page).toHaveURL(/\/parametres$/);
  await openSettingsSection(page, "party");
}

// Every party autosave refreshes the server-rendered shell. Refreshes that
// overlapped used to make the router fetch the next tab and then drop it.
test("a tab change right after back-to-back party autosaves is not lost", async ({
  page,
}) => {
  await page.goto("/parametres");
  await openSettingsSection(page, "party");
  await page
    .getByLabel("Nom de la fête", { exact: true })
    .fill("Birthday picnic");
  await page.getByLabel("Lieu", { exact: true }).fill("Garden test venue");
  await page
    .getByLabel("Date de la fête", { exact: true })
    .fill("2030-06-02T13:45");
  await page
    .getByLabel("Fuseau horaire de la fête", { exact: true })
    .fill("Europe/Paris");
  await saveParty(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Programme", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/programme$/);
});

test("saved party fields remain visible after tab navigation and reload without focusing them", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/parametres");
  await openSettingsSection(page, "party");
  await page
    .getByLabel("Nom de la fête", { exact: true })
    .fill("Birthday picnic");
  await page.getByLabel("Lieu", { exact: true }).fill("Garden test venue");
  await page
    .getByLabel("Date de la fête", { exact: true })
    .fill("2030-06-02T13:45");
  await page
    .getByLabel("Fuseau horaire de la fête", { exact: true })
    .fill("Europe/Paris");
  await saveParty(page);
  const expectedParty = {
    title: "Birthday picnic",
    location: "Garden test venue",
    timezone: "Europe/Paris",
    date: "2030-06-02T17:45:00Z",
  };
  expect(await (await host.get("/api/party")).json()).toMatchObject(
    expectedParty,
  );

  async function expectSavedFields() {
    await expect(
      page.getByLabel("Nom de la fête", { exact: true }),
    ).toHaveValue(expectedParty.title);
    await expect(page.getByLabel("Lieu", { exact: true })).toHaveValue(
      expectedParty.location,
    );
    await expect(
      page.getByLabel("Fuseau horaire de la fête", { exact: true }),
    ).toHaveValue(expectedParty.timezone);
    const date = page.getByLabel("Date de la fête", { exact: true });
    await expect(date).not.toBeFocused();
    await expect(date).toHaveValue("2030-06-02T13:45");
  }

  await returnToSettings(page);
  await expectSavedFields();
  await page.reload();
  await openSettingsSection(page, "party");
  await expectSavedFields();
  await page.screenshot({
    path: test.info().outputPath("party-settings-mobile.png"),
    fullPage: true,
    caret: "initial",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expectSavedFields();
  await page.screenshot({
    path: test.info().outputPath("party-settings-desktop.png"),
    fullPage: true,
    caret: "initial",
  });
  expect(browserErrors).toEqual([]);
});

test("saving other party fields preserves the exact instant even after focusing the unchanged date", async ({
  page,
}) => {
  await page.goto("/parametres");
  await openSettingsSection(page, "party");
  await expect(page.getByLabel("Date de la fête", { exact: true })).toHaveValue(
    "2030-06-01T13:42",
  );
  await page.getByLabel("Lieu", { exact: true }).fill("Updated test venue");
  await saveParty(page);
  expect(await (await host.get("/api/party")).json()).toMatchObject({
    ...initialParty,
    location: "Updated test venue",
  });
  await returnToSettings(page);
  await expect(page.getByLabel("Date de la fête", { exact: true })).toHaveValue(
    "2030-06-01T13:42",
  );
  await page.getByLabel("Date de la fête", { exact: true }).focus();
  await page
    .getByLabel("Nom de la fête", { exact: true })
    .fill("Updated party name");
  await saveParty(page);
  expect(await (await host.get("/api/party")).json()).toMatchObject({
    ...initialParty,
    title: "Updated party name",
    location: "Updated test venue",
  });
});

test("explicitly clearing the party date persists after navigation and reload", async ({
  page,
}) => {
  await page.goto("/parametres");
  await openSettingsSection(page, "party");
  const date = page.getByLabel("Date de la fête", { exact: true });
  await expect(date).toHaveValue("2030-06-01T13:42");
  await date.fill("");
  await saveParty(page);
  expect(await (await host.get("/api/party")).json()).toMatchObject({
    ...initialParty,
    date: null,
  });
  await returnToSettings(page);
  await expect(date).toHaveValue("");
  await page.reload();
  await openSettingsSection(page, "party");
  await expect(date).toHaveValue("");
});

test("party autosave keeps newer edits while a request is pending and saves before going back", async ({
  page,
}) => {
  const held = Promise.withResolvers<void>();
  let requestHeld = false;
  await page.route("**/api/admin/party", async (route) => {
    if (route.request().method() !== "PATCH" || requestHeld)
      return route.continue();
    requestHeld = true;
    const response = await route.fetch();
    await held.promise;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/parametres?section=party");
    const title = page.getByLabel("Nom de la fête", { exact: true });
    const location = page.getByLabel("Lieu", { exact: true });
    await title.fill("First autosaved name");
    await title.blur();
    await expect.poll(() => requestHeld).toBe(true);
    await expect(title).toBeEnabled();
    await title.fill("Final autosaved name");
    await location.fill("Final autosaved venue");
    await page
      .getByRole("button", { name: "Retour aux paramètres", exact: true })
      .click();
    await expect(page).toHaveURL(/\/parametres\?section=party$/);
    await expect(title).toHaveValue("Final autosaved name");
    held.resolve();
    await expect(page).toHaveURL(/\/parametres$/);
    await expect
      .poll(async () => (await host.get("/api/party")).json())
      .toMatchObject({
        ...initialParty,
        title: "Final autosaved name",
        location: "Final autosaved venue",
      });
    await openSettingsSection(page, "party");
    await expect(title).toHaveValue("Final autosaved name");
    await expect(location).toHaveValue("Final autosaved venue");
    await expect(
      page.getByRole("button", { name: "Enregistrer la fête", exact: true }),
    ).toHaveCount(0);
  } finally {
    held.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("reverting a party field while its previous save is pending persists the restored value", async ({
  page,
}) => {
  const held = Promise.withResolvers<void>();
  let requestHeld = false;
  await page.route("**/api/admin/party", async (route) => {
    if (route.request().method() !== "PATCH" || requestHeld)
      return route.continue();
    requestHeld = true;
    const response = await route.fetch();
    await held.promise;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/parametres?section=party");
    const title = page.getByLabel("Nom de la fête", { exact: true });
    await title.fill("Temporary party title");
    await title.blur();
    await expect.poll(() => requestHeld).toBe(true);
    await expect
      .poll(async () => (await (await host.get("/api/party")).json()).title)
      .toBe("Temporary party title");
    await title.fill(initialParty.title);
    await title.blur();
    held.resolve();
    await expect
      .poll(async () => (await host.get("/api/party")).json())
      .toMatchObject(initialParty);
    await expect(title).toHaveValue(initialParty.title);
  } finally {
    held.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});
