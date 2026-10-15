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
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Settings Test Host"],
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
  const token = new URLSearchParams(new URL(match[0]).hash.slice(1)).get(
    "token",
  );
  host = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  const accepted = await host.post("/api/invitations/accept", {
    data: { token },
  });
  expect(accepted.status()).toBe(200);
  previousParty = await (await host.get("/api/party")).json();
});

test.beforeEach(async ({ context }) => {
  const saved = await host.patch("/api/admin/party", { data: initialParty });
  expect(saved.status()).toBe(200);
  await context.addCookies((await host.storageState()).cookies);
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
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/party") &&
      response.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Enregistrer la fête", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByText("Les infos de la fête sont enregistrées.", { exact: true }),
  ).toBeVisible();
}

async function returnToSettings(page: Page) {
  const navigation = page.getByRole("navigation");
  await navigation
    .getByRole("link", { name: "Programme", exact: true })
    .click();
  await expect(page).toHaveURL(/\/programme$/);
  await navigation
    .getByRole("link", { name: "Paramètres", exact: true })
    .click();
  await expect(page).toHaveURL(/\/parametres$/);
}

test("saved party fields remain visible after tab navigation and reload without focusing them", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/parametres");
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
  await expectSavedFields();
  await page.screenshot({
    path: "test-results/party-settings-mobile.png",
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
    path: "test-results/party-settings-desktop.png",
    fullPage: true,
    caret: "initial",
  });
  expect(browserErrors).toEqual([]);
});

test("saving other party fields preserves the exact instant even after focusing the unchanged date", async ({
  page,
}) => {
  await page.goto("/parametres");
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
  await expect(date).toHaveValue("");
});
