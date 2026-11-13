import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  bootstrapHost,
  expectNoHorizontalOverflow,
  mutationHeaders,
  shareSession,
  signInGuest,
} from "./support/party";
import { openSettingsSection } from "./support/settings";
import {
  step,
  titleOf,
  welcomeControls,
  type WelcomeStep,
} from "./support/welcome";

let host: APIRequestContext;
let previousSteps: WelcomeStep[] = [];
let previouslyRequired = false;
const {
  state: adminState,
  transition,
  saveSteps,
  setRequired,
  restoreOpen,
} = welcomeControls(() => host);

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Welcome Rules Test Host");
  const previousState = await adminState();
  previousSteps = previousState.steps;
  previouslyRequired = previousState.required;
});

test.beforeEach(async () => {
  await restoreOpen([]);
});

test.afterEach(async () => {
  // The browser suite shares one disposable database across its specifications.
  await restoreOpen(previousSteps, previouslyRequired);
});

test.afterAll(async () => {
  await host?.dispose();
});

function isRulesRequest(url: string, method: string) {
  return new URL(url).pathname === "/api/welcome/rules" && method === "PUT";
}

function rulesResponse(page: Page) {
  return page.waitForResponse((response) =>
    isRulesRequest(response.url(), response.request().method()),
  );
}

async function navigate(page: Page, name: "Suivant" | "Précédent") {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/welcome/progress" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name, exact: true }).click();
  expect((await response).status()).toBe(200);
}

test("a guest ticks every rule of a step before continuing and can withdraw", async ({
  page,
}) => {
  const rules = [
    "Phones stay in pockets during dinner.",
    "Nobody reveals the surprises.",
    "Everyone tastes the cake.",
  ];
  const steps: WelcomeStep[] = [
    {
      widgets: [
        { type: "title", text: "Before we start" },
        { type: "rules", rules },
      ],
    },
    step("Find your table", "The table numbers are beside the entrance."),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");

  await signInGuest(host, page, "Rules Welcome Test");
  const accepted: boolean[] = [];
  page.on("request", (request) => {
    if (isRulesRequest(request.url(), request.method()))
      accepted.push(request.postDataJSON().accepted);
  });
  await page.goto("/attente");
  await expect(
    page.getByRole("heading", { name: titleOf(steps[0]), exact: true }),
  ).toBeVisible();
  // A guest who arrives later starts on the latest step: unlock the second
  // one only now, so this guest is held on the rules.
  await transition("next");

  const boxes = page
    .getByRole("group", { name: "Règles", exact: true })
    .getByRole("checkbox");
  const box = (index: number) =>
    page.getByRole("checkbox", { name: rules[index], exact: true });
  const next = page.getByRole("button", { name: "Suivant", exact: true });
  const hint = page.getByText("Coche chaque règle pour continuer.", {
    exact: true,
  });
  await expect(boxes).toHaveCount(rules.length);
  for (let index = 0; index < rules.length; index++)
    await expect(box(index)).not.toBeChecked();
  await expect(next).toHaveCount(0);
  await expect(hint).toBeVisible();

  // The second step is unlocked, but Go refuses it while the rules are pending.
  const pending = await (await page.request.get("/api/welcome")).json();
  expect(pending).toMatchObject({
    step: { position: 1 },
    canNext: false,
    canFinish: false,
    rulesAccepted: false,
  });
  const refused = await page.request.post("/api/welcome/progress", {
    headers: mutationHeaders,
    data: { revision: pending.progressRevision, action: "next" },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({
    code: "invalid_welcome_transition",
  });

  await box(0).check();
  await box(1).check();
  await expect(next).toHaveCount(0);
  await expect(hint).toBeVisible();
  // A host save refreshes every guest: the partial ticks stay on the page.
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/welcome" &&
      response.request().method() === "GET",
  );
  await setRequired(false);
  expect((await refreshed).status()).toBe(200);
  await expect(box(0)).toBeChecked();
  await expect(box(1)).toBeChecked();
  await expect(box(2)).not.toBeChecked();
  await expect(next).toHaveCount(0);
  expect(accepted).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("welcome-rules-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // Only the last tick is sent, and Next appears once the server accepted it.
  let saved = rulesResponse(page);
  await box(2).check();
  expect((await saved).status()).toBe(200);
  await expect(next).toBeEnabled();
  await expect(hint).toHaveCount(0);
  expect(accepted).toEqual([true]);
  expect(await (await page.request.get("/api/welcome")).json()).toMatchObject({
    progressRevision: pending.progressRevision,
    canNext: true,
    rulesAccepted: true,
  });

  // Unticking one rule withdraws the acceptance and keeps the other ticks.
  saved = rulesResponse(page);
  await box(1).uncheck();
  expect((await saved).status()).toBe(200);
  await expect(next).toHaveCount(0);
  await expect(hint).toBeVisible();
  await expect(box(0)).toBeChecked();
  await expect(box(1)).not.toBeChecked();
  await expect(box(2)).toBeChecked();
  expect(accepted).toEqual([true, false]);

  saved = rulesResponse(page);
  await box(1).check();
  expect((await saved).status()).toBe(200);
  await expect(next).toBeEnabled();
  expect(accepted).toEqual([true, false, true]);

  await navigate(page, "Suivant");
  await expect(
    page.getByRole("heading", { name: titleOf(steps[1]), exact: true }),
  ).toBeVisible();
  await expect(boxes).toHaveCount(0);

  // The acceptance belongs to the step: it is still there on the way back.
  await navigate(page, "Précédent");
  await expect(boxes).toHaveCount(rules.length);
  for (let index = 0; index < rules.length; index++)
    await expect(box(index)).toBeChecked();
  await expect(next).toBeEnabled();
  await page.reload();
  await expect(boxes).toHaveCount(rules.length);
  for (let index = 0; index < rules.length; index++)
    await expect(box(index)).toBeChecked();
  await expect(next).toBeEnabled();
  await expect(hint).toHaveCount(0);
});

test("the host adds one rules widget to a step and types one rule per line", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const editor = page.locator(".welcome-admin");
  await editor
    .getByRole("button", { name: "Ajouter une étape", exact: true })
    .click();
  const addRules = editor.getByRole("button", {
    name: "Ajouter le widget Règles",
    exact: true,
  });
  await addRules.click();
  await expect(addRules).toBeDisabled();
  const field = page.getByLabel("Règles du widget 1", { exact: true });
  await expect(field).toBeFocused();

  // A widget without any rule is not saved and takes the focus back.
  await field.blur();
  await expect(
    editor.getByText(
      "Écris au moins une règle, une par ligne. Jusqu’à 12 règles de 200 caractères chacune.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(field).toBeFocused();
  expect((await adminState()).steps).toEqual([]);

  await field.fill(
    "  Phones stay in pockets.  \n\nNobody reveals the surprises.\n",
  );
  await editor.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await expect(editor).not.toHaveAttribute("data-dirty", "true");
  await expect(editor).toHaveAttribute("aria-busy", "false");
  expect((await adminState()).steps).toEqual([
    {
      widgets: [
        {
          type: "rules",
          rules: ["Phones stay in pockets.", "Nobody reveals the surprises."],
        },
      ],
    },
  ]);
  await expect(editor.locator(".welcome-step-list li")).toContainText([
    "Phones stay in pockets.",
  ]);
  await expect(editor.getByRole("alert")).toHaveCount(0);

  await page.reload();
  await openSettingsSection(page, "welcome");
  await expect(field).toHaveValue(
    "Phones stay in pockets.\nNobody reveals the surprises.",
  );
  await expect(addRules).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await field.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("welcome-rules-editor-mobile.png"),
  });
});
