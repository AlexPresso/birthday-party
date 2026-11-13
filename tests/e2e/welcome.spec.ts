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
  invitationToken,
  invite,
  mutationHeaders,
  shareSession,
} from "./support/party";
import { canvasImage } from "./support/images";
import {
  bodyOf,
  step,
  titleOf,
  welcomeControls,
  type WelcomeStep,
} from "./support/welcome";
import { acceptConfirmation, declineConfirmation } from "./support/confirm";
import { reconnectRealtime } from "./support/realtime";

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

async function enterWaiting(page: Page, invitationUrl: string) {
  await page.goto(invitationUrl);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/attente$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
}

async function expectStep(page: Page, step: WelcomeStep) {
  await expect(
    page.getByRole("heading", { name: titleOf(step), exact: true }),
  ).toBeVisible();
  await expect(page.getByText(bodyOf(step), { exact: true })).toBeVisible();
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

async function guestPrevious(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/welcome/progress" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Précédent", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function finishWelcome(page: Page) {
  await page
    .getByRole("button", { name: "Entrer dans l’application", exact: true })
    .click();
  await expect(page).toHaveURL(/\/photos$/);
}

test.beforeAll(async () => {
  host = await bootstrapHost("Welcome Test Host");
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

test("guests navigate unlocked steps independently and keep their position across reloads", async ({
  page,
  browser,
}) => {
  const steps = [
    step(
      "Find your table and keep your invitation nearby",
      "The table numbers are on the cards beside the entrance. Keep your invitation with you for the next activity.",
      null,
    ),
    step(
      "Open the envelope on your table",
      "Read the note together, then leave the envelope beside the flowers.",
      null,
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  const invitation = await invite(host, "Camille Welcome Test");
  const progressRequests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/welcome/progress" &&
      request.method() === "POST"
    )
      progressRequests.push(request.url());
  });
  await enterWaiting(page, invitation.invitationUrl);
  await expect(
    page.getByRole("heading", {
      name: `Bienvenue ${invitation.guest.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
  ).toHaveCount(0);
  await expect(page.locator(".welcome-navigation")).toHaveCount(0);
  const waitingResponse = await page.request.get("/api/welcome");
  expect(waitingResponse.status()).toBe(200);
  expect(await waitingResponse.json()).toEqual({
    open: false,
    revision: expect.any(Number),
    progressRevision: expect.any(Number),
    step: null,
    canPrevious: false,
    canNext: false,
    canFinish: false,
    rulesAccepted: false,
  });
  const initialHTML = await page.content();
  for (const step of steps) {
    expect(initialHTML).not.toContain(titleOf(step));
    expect(initialHTML).not.toContain(bodyOf(step));
  }
  await page.screenshot({
    path: test.info().outputPath("welcome-waiting-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("welcome-waiting-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });

  // A deep link and a reload must retain the same waiting state and identity.
  await page.goto("/programme");
  await expect(page).toHaveURL(/\/attente$/);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await (await page.request.get("/api/session")).json()).guest.id).toBe(
    invitation.guest.id,
  );

  await transition("next");
  await expectStep(page, steps[0]);
  await expect(
    page.getByRole("button", { name: /^(Commencer|Suivant)$/ }),
  ).toHaveCount(0);
  expect(progressRequests).toEqual([]);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expectStep(page, steps[0]);
  expect(await (await page.request.get("/api/welcome")).json()).toEqual({
    open: false,
    revision: expect.any(Number),
    progressRevision: expect.any(Number),
    step: { position: 1, ...steps[0] },
    canPrevious: false,
    canNext: false,
    canFinish: false,
    rulesAccepted: false,
  });
  const lockedProgress = await (await page.request.get("/api/welcome")).json();
  const rejectedNext = await page.request.post("/api/welcome/progress", {
    headers: mutationHeaders,
    data: { revision: lockedProgress.progressRevision, action: "next" },
  });
  expect(rejectedNext.status()).toBe(409);
  expect(await rejectedNext.json()).toMatchObject({
    code: "invalid_welcome_transition",
  });
  await expectStep(page, steps[0]);
  const stageResponse = await page.request.get("/attente");
  expect(stageResponse.status()).toBe(200);
  const stageHTML = await stageResponse.text();
  expect(stageHTML).not.toContain(titleOf(steps[1]));
  expect(stageHTML).not.toContain(bodyOf(steps[1]));

  await page.route("**/api/welcome", (route) => route.abort("failed"), {
    times: 1,
  });
  // A host save signals every guest; this guest's next check then fails once.
  await setRequired(false);
  const connectionError = page.getByText(
    "Impossible de vérifier s’il y a du nouveau.",
    { exact: true },
  );
  await expect(connectionError).toBeVisible();
  await expectStep(page, steps[0]);
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(connectionError).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("welcome-step-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test.info().outputPath("welcome-step-desktop.png"),
    fullPage: true,
  });

  const lateContext = await browser.newContext({
    baseURL,
    locale: "fr-CH",
    viewport: { width: 390, height: 844 },
  });
  try {
    const latePage = await lateContext.newPage();
    const lateInvitation = await invite(host, "Alex Welcome Test");
    await enterWaiting(latePage, lateInvitation.invitationUrl);
    await expectStep(latePage, steps[0]);
    const firstProgress = (
      await (await page.request.get("/api/welcome")).json()
    ).progressRevision;
    await transition("next");
    await expect(
      latePage.getByRole("button", { name: "Suivant", exact: true }),
    ).toBeEnabled();
    await expectStep(latePage, steps[0]);
    await guestNext(latePage);
    await expectStep(latePage, steps[1]);
    await expect(latePage.locator("#welcome-position")).toBeFocused();
    await expect(
      latePage.getByRole("button", { name: "Suivant", exact: true }),
    ).toHaveCount(0);
    // Unlocking a step and another guest moving must preserve this guest's position.
    await page.bringToFront();
    await expectStep(page, steps[0]);
    expect(
      (await (await page.request.get("/api/welcome")).json()).progressRevision,
    ).toBe(firstProgress);
    await page.reload();
    if (new URL(page.url()).pathname === "/parametres") {
      await openSettingsSection(page, "welcome");
    }
    await expectStep(page, steps[0]);
    await guestNext(page);
    await expectStep(page, steps[1]);
    await guestPrevious(page);
    await expectStep(page, steps[0]);
    await page.reload();
    if (new URL(page.url()).pathname === "/parametres") {
      await openSettingsSection(page, "welcome");
    }
    await expectStep(page, steps[0]);
    await guestNext(page);
    await expectStep(page, steps[1]);
    await latePage.bringToFront();
    await latePage.reload();
    await expectStep(latePage, steps[1]);
    expect((await adminState()).open).toBe(false);

    await transition("open");
    await page.bringToFront();
    await expectStep(page, steps[1]);
    await finishWelcome(page);
    const navigation = page.getByRole("navigation");
    for (const name of ["Programme", "Médias", "Livre d'or"]) {
      await expect(
        navigation.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    }
    await latePage.bringToFront();
    await expectStep(latePage, steps[1]);
    await finishWelcome(latePage);
  } finally {
    await lateContext.close();
  }
});

test("required late arrivals complete every step before entering an already open app", async ({
  page,
}) => {
  const steps = [
    step(
      "First welcome instruction",
      "Read this instruction before continuing.",
    ),
    step("Second welcome instruction", "Read this next instruction as well."),
    step(
      "Last welcome instruction",
      "You can enter after this last instruction.",
    ),
  ];
  await saveSteps(steps);
  await setRequired(true);
  await transition("start");
  for (let index = 0; index < steps.length; index++) await transition("next");
  await transition("open");
  const invitation = await invite(host, "Required Late Arrival Test");
  await enterWaiting(page, invitation.invitationUrl);
  await expectStep(page, steps[0]);
  expect((await page.request.get("/api/photos")).status()).toBe(423);
  const first = await (await page.request.get("/api/welcome")).json();
  expect(first).toMatchObject({
    open: false,
    canPrevious: false,
    canNext: true,
    canFinish: false,
  });
  expect(JSON.stringify(first)).not.toContain(titleOf(steps[1]));
  expect(JSON.stringify(first)).not.toContain(titleOf(steps[2]));
  const finishEarly = await page.request.post("/api/welcome/progress", {
    headers: mutationHeaders,
    data: { revision: first.progressRevision, action: "finish" },
  });
  expect(finishEarly.status()).toBe(409);
  expect(await finishEarly.json()).toMatchObject({
    code: "invalid_welcome_transition",
  });
  await guestNext(page);
  await expectStep(page, steps[1]);
  await guestPrevious(page);
  await expectStep(page, steps[0]);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expectStep(page, steps[0]);
  await guestNext(page);
  await expectStep(page, steps[1]);
  await guestNext(page);
  await expectStep(page, steps[2]);
  await expect(
    page.getByRole("button", { name: "Suivant", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/photos")).status()).toBe(423);
  await expect(
    page.getByRole("button", {
      name: "Entrer dans l’application",
      exact: true,
    }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test
      .info()
      .outputPath("welcome-progress", "required-last-step-mobile-320.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: test
      .info()
      .outputPath("welcome-progress", "required-last-step-desktop.png"),
    fullPage: true,
  });
  await finishWelcome(page);
  expect((await page.request.get("/api/photos")).status()).toBe(200);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(page).toHaveURL(/\/photos$/);
  await page.goto("/attente");
  await expect(page).toHaveURL(/\/photos$/);
});

test("optional late arrivals enter directly after the host opens the app", async ({
  page,
}) => {
  const steps = [
    step(
      "Optional welcome instruction",
      "This welcome has already taken place.",
    ),
    step(
      "Optional final instruction",
      "Late arrivals can join the party directly.",
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  await transition("next");
  await transition("open");
  const invitation = await invite(host, "Optional Late Arrival Test");
  await page.goto(invitation.invitationUrl);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/photos$/);
  expect((await (await page.request.get("/api/welcome")).json()).open).toBe(
    true,
  );
  expect((await page.request.get("/api/photos")).status()).toBe(200);
  await page.goto("/attente");
  await expect(page).toHaveURL(/\/photos$/);
});

test("the host prepares, reorders and unlocks welcome steps from settings", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const summary = page.getByRole("heading", {
    name: "Accueil des invités",
    exact: true,
    level: 1,
  });
  await expect(summary).toBeVisible();
  const title = () => page.getByLabel("Titre du widget 1", { exact: true });
  const action = page.getByRole("button", {
    name: "Ajouter le widget Photo de profil",
    exact: true,
  });
  const selectStep = (position: number) =>
    page
      .getByRole("button", {
        name: `Modifier l’étape ${position}`,
        exact: true,
      })
      .click();
  const add = page.getByRole("button", {
    name: "Ajouter une étape",
    exact: true,
  });
  const start = page.getByRole("button", {
    name: /^(Activer l’écran d’attente|Relancer l’accueil)$/,
  });

  await add.click();
  await addTextWidgets(
    page,
    "Read the table card",
    "Find the name of your team on the table card.",
  );
  await expect(action).toBeEnabled();
  await add.click();
  await addTextWidgets(
    page,
    "Collect your envelope at the entrance",
    "Take one envelope for your table and keep it closed.",
  );
  await action.click();
  await expect(start).toBeEnabled();

  await page
    .getByRole("button", { name: "Monter l’étape 2", exact: true })
    .click();
  await expect(title()).toHaveValue("Collect your envelope at the entrance");
  await expect(action).toBeDisabled();
  await selectStep(2);
  await expect(title()).toHaveValue("Read the table card");
  await expect(action).toBeEnabled();
  await title().fill("Find your team on the table card");
  await saveEditor(page);
  expect((await adminState()).steps).toEqual([
    step(
      "Collect your envelope at the entrance",
      "Take one envelope for your table and keep it closed.",
      "profile_photo",
    ),
    step(
      "Find your team on the table card",
      "Find the name of your team on the table card.",
      null,
    ),
  ]);

  const required = page.getByLabel("Obligatoire", { exact: true });
  await expect(required).not.toBeChecked();
  const requiredSaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/welcome/required" &&
      response.request().method() === "PATCH",
  );
  await required.click();
  expect((await requiredSaved).status()).toBe(200);
  await expect(required).toBeChecked();
  expect((await adminState()).required).toBe(true);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(required).toBeChecked();
  await expect(summary).toBeVisible();
  await selectStep(1);
  await expect(title()).toHaveValue("Collect your envelope at the entrance");
  await expect(action).toBeDisabled();
  await selectStep(2);
  await expect(title()).toHaveValue("Find your team on the table card");
  await expect(action).toBeEnabled();
  await selectStep(1);
  await page.screenshot({
    path: test.info().outputPath("welcome-admin-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: test.info().outputPath("welcome-admin-desktop.png"),
    fullPage: true,
  });

  // Starting the welcome and opening the app ask the host to confirm first.
  async function pressTransition(name: string, confirmed = false) {
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/welcome/transition") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    if (confirmed) await acceptConfirmation(page);
    expect((await response).status()).toBe(200);
  }

  await pressTransition(
    (await adminState()).currentStep > 0
      ? "Relancer l’accueil"
      : "Activer l’écran d’attente",
    true,
  );
  await expect(page).toHaveURL(/\/parametres\?section=welcome$/);
  // The desktop settings sidebar is a navigation landmark too.
  await expect(
    page.getByRole("navigation", {
      name: "Navigation principale",
      exact: true,
    }),
  ).toBeVisible();
  expect(await adminState()).toMatchObject({ open: false, currentStep: 0 });
  await pressTransition("Débloquer la première étape");
  expect(await adminState()).toMatchObject({ open: false, currentStep: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".welcome-control").screenshot({
    path: test.info().outputPath("welcome-progress", "host-unlock-mobile.png"),
  });
  await page.locator(".welcome-required").screenshot({
    path: test
      .info()
      .outputPath("welcome-progress", "host-required-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".welcome-control").screenshot({
    path: test.info().outputPath("welcome-progress", "host-unlock-desktop.png"),
  });
  await page.locator(".welcome-required").screenshot({
    path: test
      .info()
      .outputPath("welcome-progress", "host-required-desktop.png"),
  });
  await expect(action).toBeDisabled();
  await pressTransition("Débloquer l’étape suivante");
  expect(await adminState()).toMatchObject({ open: false, currentStep: 2 });
  await expect(
    page.getByRole("button", {
      name: "Débloquer l’étape suivante",
      exact: true,
    }),
  ).toHaveCount(0);
  await pressTransition("Ouvrir l’application", true);
  expect((await adminState()).open).toBe(true);
});

test("a connected guest moves to waiting when the host closes access and can sign out", async ({
  page,
}) => {
  const invitation = await invite(host, "Jordan Waiting Test");
  const accepted = await page.request.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitation.invitationUrl) },
  });
  expect(accepted.status()).toBe(200);
  await page.goto("/photos");
  await expect(page.getByRole("navigation")).toBeVisible();

  await transition("start");
  await expect(page).toHaveURL(/\/attente$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: `Bienvenue ${invitation.guest.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(page).toHaveURL(/\/invitation$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
});

test("the host keeps a conflicting draft until deliberately discarding it and can continue", async ({
  page,
  context,
}) => {
  const savedSteps: WelcomeStep[] = [
    step("Collect the table card", "Take one card for your table.", null),
    step("Read the team name", "Read the name written on your card.", null),
  ];
  await saveSteps(savedSteps);
  await transition("start");
  await shareSession(context, host);
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const title = page.getByLabel("Titre du widget 1", { exact: true });
  const draftTitle = "Unpublished changes from this browser";
  await title.fill(draftTitle);

  // Another host reveals a step while this browser still holds an unsaved draft.
  await transition("next");
  const rejectedSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/welcome") &&
      response.request().method() === "PUT",
  );
  await title.blur();
  const response = await rejectedSave;
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: "welcome_conflict" });
  await expect(
    page.getByText(
      "L’accueil a changé. Actualise son état avant de réessayer.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actualiser l’état", exact: true })
    .click();
  await expect(
    page.getByText(
      "L’état a été actualisé. Tes étapes non enregistrées sont toujours dans le formulaire.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(title).toHaveValue(draftTitle);
  await expect(title).toBeEnabled();
  const next = page.getByRole("button", {
    name: "Débloquer l’étape suivante",
    exact: true,
  });
  await expect(next).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Ouvrir l’application", exact: true }),
  ).toBeEnabled();

  const discard = page.getByRole("button", {
    name: "Abandonner les modifications",
    exact: true,
  });
  await discard.click();
  await declineConfirmation(page);
  await expect(title).toHaveValue(draftTitle);
  await discard.click();
  await acceptConfirmation(page);
  await expect(title).toHaveValue(titleOf(savedSteps[0]));
  await expect(discard).toHaveCount(0);
  await expect(next).toBeEnabled();
  expect((await adminState()).steps).toEqual(savedSteps);

  await next.click();
  await expect(
    page.getByRole("heading", { name: "Étape 2 sur 2 débloquée", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ouvrir l’application", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(
    page.getByRole("heading", { name: "Application ouverte", exact: true }),
  ).toBeVisible();
  expect((await adminState()).open).toBe(true);
});

test("the host saves a conflicting draft after an unlock and edits again after opening the app", async ({
  page,
  context,
}) => {
  const savedSteps = [
    step("Saved first step", "Saved instructions for the first step."),
    step("Saved second step", "Saved instructions for the second step."),
  ];
  await saveSteps(savedSteps);
  await transition("start");
  await shareSession(context, host);
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const title = page.getByLabel("Titre du widget 1", { exact: true });
  const draftTitle = "Keep this unsaved title after the unlock";
  await title.fill(draftTitle);
  await transition("next");
  const rejectedSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/welcome" &&
      response.request().method() === "PUT",
  );
  await title.blur();
  expect((await rejectedSave).status()).toBe(409);
  await page
    .getByRole("button", { name: "Actualiser l’état", exact: true })
    .click();
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue(draftTitle);
  await saveEditor(page);
  expect(await adminState()).toMatchObject({ open: false, currentStep: 1 });
  expect(titleOf((await adminState()).steps[0])).toBe(draftTitle);
  await page
    .getByRole("button", { name: "Ouvrir l’application", exact: true })
    .click();
  await acceptConfirmation(page);
  const restart = page.getByRole("button", {
    name: "Relancer l’accueil",
    exact: true,
  });
  await expect(restart).toBeEnabled();
  await expect(title).toBeEnabled();
  const openTitle = "Instructions updated after opening the app";
  await title.fill(openTitle);
  await expect(restart).toBeEnabled();
  await saveEditor(page);
  expect(await adminState()).toMatchObject({ open: true, currentStep: 2 });
  expect(titleOf((await adminState()).steps[0])).toBe(openTitle);
});

const editorSteps: WelcomeStep[] = [
  step("Find your table", "Read the table names beside the entrance.", null),
  step("Choose your photo", "Choose a photo for your profile.", null),
  step("Collect your envelope", "Take one envelope for your table.", null),
];

test("welcome autosave preserves newer text and reordered steps before changing the required switch", async ({
  page,
  context,
}) => {
  const original = editorSteps.slice(0, 2);
  await saveSteps(original);
  await shareSession(context, host);
  await page.goto("/parametres?section=welcome");
  const title = page.getByLabel("Titre du widget 1", { exact: true });
  const editor = page.locator(".welcome-admin");
  let releaseResponse!: () => void;
  const heldResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markAccepted!: () => void;
  const accepted = new Promise<void>((resolve) => {
    markAccepted = resolve;
  });
  const requests: { revision: number; steps: WelcomeStep[] }[] = [];
  await page.route("**/api/admin/welcome", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (requests.length === 1) {
      markAccepted();
      await heldResponse;
    }
    await route.fulfill({ response });
  });
  try {
    await title.fill("First autosaved title");
    await title.blur();
    await accepted;
    await expect(editor).toHaveAttribute("aria-busy", "true");
    await expect(title).toBeEnabled();
    const latestTitle = "Newer title typed during the pending save";
    await title.fill(latestTitle);
    await page
      .getByRole("button", { name: "Descendre l’étape 1", exact: true })
      .click();
    await expect(title).toHaveValue(latestTitle);
    const requiredSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/welcome/required" &&
        response.request().method() === "PATCH",
    );
    await page.getByLabel("Obligatoire", { exact: true }).click();
    releaseResponse();
    expect((await requiredSaved).status()).toBe(200);
    await saveEditor(page);
    expect((await adminState()).steps).toEqual([
      original[1],
      step(latestTitle, bodyOf(original[0])),
    ]);
    expect((await adminState()).required).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1].revision).toBeGreaterThan(requests[0].revision);
    await expect(title).toHaveValue(latestTitle);
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: "wait" });
  }
});

async function saveEditor(page: Page) {
  const editor = page.locator(".welcome-admin");
  await editor.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const retry = editor.getByRole("button", { name: "Réessayer", exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect(editor).not.toHaveAttribute("data-dirty", "true");
  await expect(editor).toHaveAttribute("aria-busy", "false");
  await expect(
    editor.getByRole("button", { name: "Enregistrer les étapes", exact: true }),
  ).toHaveCount(0);
}

async function addTextWidgets(page: Page, title: string, body: string) {
  await page
    .getByRole("button", { name: "Ajouter le widget Titre", exact: true })
    .click();
  await page.getByLabel("Titre du widget 1", { exact: true }).fill(title);
  await page
    .getByRole("button", { name: "Ajouter le widget Texte", exact: true })
    .click();
  await page.getByLabel("Texte du widget 2", { exact: true }).fill(body);
}

test("the host drags widgets into a step, reorders them and retains their content after saving", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const editor = page.locator(".welcome-admin");
  await editor
    .getByRole("button", { name: "Ajouter une étape", exact: true })
    .click();
  const canvas = editor.locator(".welcome-widget-list");
  const widgets = canvas.locator("[data-widget-key]");
  await expect(widgets).toHaveCount(0);
  await expect(
    editor.getByLabel(/Titre de l’étape|Texte de l’étape/),
  ).toHaveCount(0);

  async function paletteDrag(name: string, beforeFirst = false) {
    await canvas.scrollIntoViewIfNeeded();
    const handle = editor.getByRole("button", {
      name: `Glisser le widget ${name} dans l’étape`,
      exact: true,
    });
    const source = await handle.boundingBox();
    const target = await canvas.boundingBox();
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    await page.mouse.move(
      source!.x + source!.width / 2,
      source!.y + source!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target!.x + target!.width / 2,
      target!.y + (beforeFirst ? 4 : target!.height / 2),
      { steps: 15 },
    );
    await page.mouse.up();
  }

  await paletteDrag("Titre");
  await expect(widgets).toHaveCount(1);
  await page
    .getByLabel("Titre du widget 1", { exact: true })
    .fill("Find your table");
  // Let the autosave finish first: its notice appears above the canvas and
  // would move the drop target measured for the drag.
  await saveEditor(page);
  await paletteDrag("Texte", true);
  await expect(widgets).toHaveCount(2);
  await expect(widgets.first()).toHaveAttribute("data-widget-type", "text");
  await page
    .getByLabel("Texte du widget 1", { exact: true })
    .fill("Read the card beside the entrance.");
  await editor
    .getByRole("button", {
      name: "Ajouter le widget Photo de profil",
      exact: true,
    })
    .press("Enter");
  await expect(widgets).toHaveCount(3);
  await expect(
    editor.getByRole("button", {
      name: "Ajouter le widget Photo de profil",
      exact: true,
    }),
  ).toBeDisabled();
  await editor
    .getByRole("button", {
      name: "Ajouter le widget Photos et vidéos",
      exact: true,
    })
    .press("Enter");
  await expect(widgets).toHaveCount(4);
  await expect(
    page.getByLabel("Destination des envois", { exact: true }),
  ).toHaveValue("");
  await editor
    .getByRole("button", { name: "Monter le widget 2", exact: true })
    .press("Enter");
  await expect(widgets.first()).toHaveAttribute("data-widget-type", "title");
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue("Find your table");

  // The drag handle moves an existing widget without changing its form data.
  await canvas.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const source = await editor
    .getByRole("button", { name: "Déplacer le widget 2", exact: true })
    .boundingBox();
  const target = await widgets.first().boundingBox();
  expect(source).toBeTruthy();
  expect(target).toBeTruthy();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 4, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(widgets.first()).toHaveAttribute("data-widget-type", "text");
  await expect(
    page.getByLabel("Texte du widget 1", { exact: true }),
  ).toHaveValue("Read the card beside the entrance.");

  const expected: WelcomeStep[] = [
    {
      widgets: [
        { type: "text", text: "Read the card beside the entrance." },
        { type: "title", text: "Find your table" },
        { type: "profile_photo" },
        { type: "media_upload", mediaUpload: { categoryId: null } },
      ],
    },
  ];
  await saveEditor(page);
  expect((await adminState()).steps).toEqual(expected);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(widgets).toHaveCount(4);
  await expect(
    page.getByLabel("Titre du widget 2", { exact: true }),
  ).toHaveValue("Find your table");
  await expect(
    page.getByLabel("Texte du widget 1", { exact: true }),
  ).toHaveValue("Read the card beside the entrance.");
  await editor
    .getByRole("button", { name: "Ajouter le widget Titre", exact: true })
    .press("Enter");
  const invalidTitle = page.getByLabel("Titre du widget 5", { exact: true });
  await invalidTitle.focus();
  await invalidTitle.blur();
  await expect(invalidTitle).toBeFocused();
  expect((await adminState()).steps).toEqual(expected);
  await editor
    .getByRole("button", { name: "Supprimer le widget 5", exact: true })
    .click();
  await expect(widgets).toHaveCount(4);
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await canvas.evaluate((element) => {
    element.scrollTop = 0;
  });
  await editor.screenshot({
    path: test.info().outputPath("welcome-widgets-editor-desktop.png"),
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await canvas.evaluate((element) => {
    element.scrollTop = 0;
  });
  await editor.screenshot({
    path: test.info().outputPath("welcome-widgets-editor-mobile-320.png"),
  });
});

test("dragging a selected welcome step preserves its draft and action settings through save and reload", async ({
  page,
  context,
}) => {
  await saveSteps(editorSteps);
  await shareSession(context, host);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const editor = page.locator(".welcome-admin");
  const list = editor.locator(".welcome-step-list");
  const rows = list.locator("li");
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  const editedTitle = "Choose a photo that your friends recognize";
  const editedBody =
    "You can change your profile photo again after the welcome.";
  await page.getByLabel("Titre du widget 1", { exact: true }).fill(editedTitle);
  await page.getByLabel("Texte du widget 2", { exact: true }).fill(editedBody);
  const action = editor.getByRole("button", {
    name: "Ajouter le widget Photo de profil",
    exact: true,
  });
  await action.click();
  await expect(
    editor.locator('[data-widget-type="profile_photo"]'),
  ).toHaveCount(1);
  const selectedKey = await rows.nth(1).getAttribute("data-step-key");
  await list.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const source = await editor
    .getByRole("button", { name: "Déplacer l’étape 2", exact: true })
    .boundingBox();
  const target = await rows.first().boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 4, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(rows).toContainText([
    editedTitle,
    titleOf(editorSteps[0]),
    titleOf(editorSteps[2]),
  ]);
  await expect(rows.first()).toHaveAttribute("data-step-key", selectedKey!);
  await expect(
    editor.getByRole("button", { name: "Déplacer l’étape 1", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(editedTitle);
  await expect(
    page.getByLabel("Texte du widget 2", { exact: true }),
  ).toHaveValue(editedBody);
  await expect(action).toBeDisabled();

  await editor
    .getByRole("button", { name: "Supprimer le widget 3", exact: true })
    .click();
  await expect(action).toBeEnabled();
  await editor
    .getByRole("button", { name: "Modifier l’étape 3", exact: true })
    .click();
  await expect(action).toBeEnabled();
  await editor
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Texte du widget 2", { exact: true }),
  ).toHaveValue(editedBody);
  await expect(action).toBeEnabled();
  await action.click();
  await saveEditor(page);
  expect((await adminState()).steps).toEqual([
    step(editedTitle, editedBody, "profile_photo"),
    editorSteps[0],
    editorSteps[2],
  ]);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(rows).toContainText([
    editedTitle,
    titleOf(editorSteps[0]),
    titleOf(editorSteps[2]),
  ]);
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(editedTitle);
  await expect(action).toBeDisabled();
  await editor.screenshot({
    path: test.info().outputPath("welcome-editor-desktop.png"),
  });

  let unexpectedSaves = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/admin/welcome" &&
      request.method() === "PUT"
    ) {
      unexpectedSaves += 1;
    }
  });
  const add = editor.getByRole("button", {
    name: "Ajouter une étape",
    exact: true,
  });
  await add.click();
  await editor
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  // Desktop has no back button: leaving means choosing another section. The
  // empty step blocks it, takes the focus and nothing is sent.
  await page.locator('a[href="/parametres?section=guests"]').click();
  await expect(
    editor.getByRole("button", {
      name: "Ajouter le widget Titre",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/parametres\?section=welcome$/);
  await expect(editor).toBeVisible();
  expect(unexpectedSaves).toBe(0);
  await editor
    .getByRole("button", { name: "Supprimer l’étape 4", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Modifier l’étape 3", exact: true }),
  ).toBeFocused();
  // Removing a step that holds widgets asks for confirmation.
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 2", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(titleOf(editorSteps[2]));
  await expect(
    editor.getByRole("button", { name: "Modifier l’étape 2", exact: true }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 2", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(
    editor.getByRole("button", { name: "Modifier l’étape 1", exact: true }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 1", exact: true })
    .click();
  await acceptConfirmation(page);
  await expect(add).toBeFocused();
  await expect(rows).toHaveCount(0);
});

test("the welcome editor supports touch dragging, escape cancellation and keyboard reordering on a narrow screen", async ({
  browser,
}) => {
  await saveSteps(editorSteps);
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    viewport: { width: 390, height: 844 },
    locale: "fr-CH",
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/parametres");
    await openSettingsSection(page, "welcome");
    const editor = page.locator(".welcome-admin");
    const list = editor.locator(".welcome-step-list");
    const rows = list.locator("li");
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    const draftBody =
      "Keep this envelope closed until the host tells you to open it.";
    await page.getByLabel("Texte du widget 2", { exact: true }).fill(draftBody);
    await editor
      .getByRole("button", { name: "Monter l’étape 3", exact: true })
      .press("Enter");
    await expect(rows).toContainText([
      titleOf(editorSteps[0]),
      titleOf(editorSteps[2]),
      titleOf(editorSteps[1]),
    ]);
    await expect(
      page.getByLabel("Texte du widget 2", { exact: true }),
    ).toHaveValue(draftBody);
    await expect(
      editor.getByRole("button", { name: "Monter l’étape 2", exact: true }),
    ).toBeFocused();
    await editor
      .getByRole("button", { name: "Monter l’étape 2", exact: true })
      .press("Enter");
    await expect(
      editor.getByRole("button", { name: "Modifier l’étape 1", exact: true }),
    ).toBeFocused();
    await editor
      .getByRole("button", { name: "Descendre l’étape 1", exact: true })
      .press("Enter");
    await editor
      .getByRole("button", { name: "Descendre l’étape 2", exact: true })
      .press("Enter");
    await expect(
      editor.getByRole("button", { name: "Modifier l’étape 3", exact: true }),
    ).toBeFocused();
    await editor
      .getByRole("button", { name: "Monter l’étape 3", exact: true })
      .press("Enter");
    await editor
      .getByRole("button", { name: "Déplacer l’étape 2", exact: true })
      .tap();
    await expect(rows).toContainText([
      titleOf(editorSteps[0]),
      titleOf(editorSteps[2]),
      titleOf(editorSteps[1]),
    ]);
    const cdp = await context.newCDPSession(page);
    async function touchDrag(position: number, cancel = false) {
      await list.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const source = await editor
        .getByRole("button", {
          name: `Déplacer l’étape ${position}`,
          exact: true,
        })
        .boundingBox();
      const target = await rows.first().boundingBox();
      expect(source).not.toBeNull();
      expect(target).not.toBeNull();
      const x = source!.x + source!.width / 2;
      const startY = source!.y + source!.height / 2;
      const endY = target!.y + 4;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY, id: 1 }],
      });
      for (let progress = 1; progress <= 8; progress++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x, y: startY + ((endY - startY) * progress) / 8, id: 1 },
          ],
        });
      }
      if (cancel) await page.keyboard.press("Escape");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await touchDrag(2, true);
    await expect(rows).toContainText([
      titleOf(editorSteps[0]),
      titleOf(editorSteps[2]),
      titleOf(editorSteps[1]),
    ]);
    await touchDrag(3);
    await expect(rows).toContainText([
      titleOf(editorSteps[1]),
      titleOf(editorSteps[0]),
      titleOf(editorSteps[2]),
    ]);
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    await expect(
      page.getByLabel("Texte du widget 2", { exact: true }),
    ).toHaveValue(draftBody);
    await editor
      .getByRole("button", {
        name: "Ajouter le widget Photo de profil",
        exact: true,
      })
      .click();
    await saveEditor(page);
    expect((await adminState()).steps).toEqual([
      editorSteps[1],
      editorSteps[0],
      step(titleOf(editorSteps[2]), draftBody, "profile_photo"),
    ]);
    await page.reload();
    if (new URL(page.url()).pathname === "/parametres") {
      await openSettingsSection(page, "welcome");
    }
    await expect(rows).toContainText([
      titleOf(editorSteps[1]),
      titleOf(editorSteps[0]),
      titleOf(editorSteps[2]),
    ]);
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    await expect(
      page.getByLabel("Texte du widget 2", { exact: true }),
    ).toHaveValue(draftBody);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await editor.screenshot({
      path: test.info().outputPath("welcome-editor-mobile.png"),
    });

    const widgetList = editor.locator(".welcome-widget-list");
    const widgetRows = widgetList.locator("[data-widget-key]");
    async function touchWidgetDrag(cancel: boolean) {
      await widgetList.evaluate((element) =>
        element.scrollIntoView({ block: "start" }),
      );
      const source = await editor
        .getByRole("button", { name: "Déplacer le widget 2", exact: true })
        .boundingBox();
      const target = await widgetRows.first().boundingBox();
      expect(source).toBeTruthy();
      expect(target).toBeTruthy();
      const x = source!.x + source!.width / 2;
      const startY = source!.y + source!.height / 2;
      // Keep the drop away from page-edge scrolling and above the first row's midpoint.
      const endY = target!.y + target!.height / 3;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY, id: 1 }],
      });
      for (let progress = 1; progress <= 12; progress++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x, y: startY + ((endY - startY) * progress) / 12, id: 1 },
          ],
        });
      }
      if (cancel) await page.keyboard.press("Escape");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await touchWidgetDrag(true);
    await expect(widgetRows.first()).toHaveAttribute(
      "data-widget-type",
      "title",
    );
    await touchWidgetDrag(false);
    await expect(widgetRows.first()).toHaveAttribute(
      "data-widget-type",
      "text",
    );
    await expect(
      page.getByLabel("Texte du widget 1", { exact: true }),
    ).toHaveValue(draftBody);
    await editor
      .getByRole("button", { name: "Descendre le widget 1", exact: true })
      .press("Enter");
    await expect(widgetRows.first()).toHaveAttribute(
      "data-widget-type",
      "title",
    );
    await expect(
      page.getByLabel("Texte du widget 2", { exact: true }),
    ).toHaveValue(draftBody);

    await transition("start");
    await transition("next");
    await page.reload();
    if (new URL(page.url()).pathname === "/parametres") {
      await openSettingsSection(page, "welcome");
    }
    await expect(
      editor.getByRole("button", { name: "Déplacer l’étape 1", exact: true }),
    ).toBeEnabled();
    const photoAction = editor.getByRole("button", {
      name: "Ajouter le widget Photo de profil",
      exact: true,
    });
    await expect(photoAction).toBeEnabled();
    const title = page.getByLabel("Titre du widget 1", { exact: true });
    await expect(title).toBeEnabled();
    const updatedTitle = "Choose a photo while the first step is unlocked";
    await title.fill(updatedTitle);
    await photoAction.click();
    await saveEditor(page);
    const updated = await adminState();
    expect(updated).toMatchObject({ open: false, currentStep: 1 });
    expect(updated.steps).toEqual([
      step(updatedTitle, bodyOf(editorSteps[1]), "profile_photo"),
      editorSteps[0],
      step(titleOf(editorSteps[2]), draftBody, "profile_photo"),
    ]);
    await page.reload();
    if (new URL(page.url()).pathname === "/parametres") {
      await openSettingsSection(page, "welcome");
    }
    await expect(title).toHaveValue(updatedTitle);
    await expect(title).toBeEnabled();
    await expect(photoAction).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("dragging through twelve welcome steps scrolls the list and preserves the moved action", async ({
  page,
  context,
}) => {
  const steps: WelcomeStep[] = Array.from({ length: 12 }, (_, index) =>
    step(
      index % 2 === 0
        ? `Welcome activity ${index + 1}: collect the card assigned to your table`
        : `Welcome activity ${index + 1}`,
      `Instructions for welcome activity ${index + 1}.`,
      index === 0 ? "profile_photo" : null,
    ),
  );
  await saveSteps(steps);
  await shareSession(context, host);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/parametres");
  await openSettingsSection(page, "welcome");
  const editor = page.locator(".welcome-admin");
  const list = editor.locator(".welcome-step-list");
  const rows = list.locator("li");
  await expect(rows).toHaveCount(12);
  await expect(
    editor.getByRole("button", { name: "Ajouter une étape", exact: true }),
  ).toBeDisabled();
  await list.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const source = await editor
    .getByRole("button", { name: "Déplacer l’étape 1", exact: true })
    .boundingBox();
  const bounds = await list.boundingBox();
  expect(source).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(
    await list.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height - 8,
    { steps: 12 },
  );
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  const destination = await rows.last().boundingBox();
  expect(destination).not.toBeNull();
  await page.mouse.move(
    destination!.x + destination!.width / 2,
    destination!.y + destination!.height - 4,
  );
  await page.mouse.up();
  const ordered = [...steps.slice(1), steps[0]];
  await expect(rows).toContainText(ordered.map((step) => titleOf(step)));
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(titleOf(steps[0]));
  await expect(
    page.getByLabel("Texte du widget 2", { exact: true }),
  ).toHaveValue(bodyOf(steps[0]));
  await expect(
    editor.getByRole("button", {
      name: "Ajouter le widget Photo de profil",
      exact: true,
    }),
  ).toBeDisabled();
  await saveEditor(page);
  expect((await adminState()).steps).toEqual(ordered);
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expect(rows).toContainText(ordered.map((step) => titleOf(step)));
  await page.setViewportSize({ width: 390, height: 844 });
  // Confirm hydration before sending low-level pointer events after a full reload.
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(titleOf(ordered[1]));
  await editor
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre du widget 1", { exact: true }),
  ).toHaveValue(titleOf(ordered[0]));
  await list.evaluate((element) => {
    element.scrollTop = 0;
    window.scrollBy(
      0,
      element.getBoundingClientRect().top - (window.innerHeight - 220),
    );
  });
  const mobileSource = await editor
    .getByRole("button", { name: "Déplacer l’étape 1", exact: true })
    .boundingBox();
  const navigation = await page.getByRole("navigation").boundingBox();
  expect(mobileSource).not.toBeNull();
  expect(navigation).not.toBeNull();
  const visibleEdge = navigation!.y - 8;
  await page.mouse.move(
    mobileSource!.x + mobileSource!.width / 2,
    mobileSource!.y + mobileSource!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    mobileSource!.x + mobileSource!.width / 2,
    visibleEdge,
    { steps: 8 },
  );
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(rows).toContainText(ordered.map((step) => titleOf(step)));
});

function profileImage(page: Page) {
  return canvasImage(page, {
    name: "welcome-profile-test.png",
    width: 384,
    height: 256,
    color: "#60917e",
  });
}

test("live welcome edits preserve the guest's position and photo selection before and after opening", async ({
  page,
}) => {
  const currentStep = step(
    "Choose your profile photo",
    "Choose a photo that the other guests will recognize.",
    "profile_photo",
  );
  const futureStep = step(
    "Read your table card",
    "Keep the instructions on your card for later.",
  );
  await saveSteps([currentStep, futureStep]);
  await transition("start");
  await transition("next");
  const invitation = await invite(host, "Camille Live Welcome Edit Test");
  await enterWaiting(page, invitation.invitationUrl);
  await expectStep(page, currentStep);
  const widget = page.locator(".welcome-profile");
  await widget
    .locator('input[type="file"]')
    .setInputFiles(await profileImage(page));
  const preview = widget.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(preview).toBeVisible();
  const previewURL = await preview.getAttribute("src");
  expect(previewURL).toBeTruthy();
  const initial = await (await page.request.get("/api/welcome")).json();

  const correctedStep = step(
    "Choose a photo for your profile",
    "You can change it later in settings.",
    "profile_photo",
  );
  const corrected = await saveSteps([correctedStep, futureStep]);
  await expectStep(page, correctedStep);
  await expect(preview).toHaveAttribute("src", previewURL!);
  expect(await (await page.request.get("/api/welcome")).json()).toMatchObject({
    progressRevision: initial.progressRevision,
    revision: corrected.revision,
    step: { position: 1 },
  });

  const revisedFuture = step(
    "PRIVATE-FUTURE-LIVE-EDIT",
    "These updated instructions belong to the next step.",
    "media_upload",
  );
  const [futureRefresh, futureSaved] = await Promise.all([
    page.waitForResponse(async (response) => {
      if (new URL(response.url()).pathname !== "/api/welcome" || !response.ok())
        return false;
      return (await response.json()).revision > corrected.revision;
    }),
    saveSteps([correctedStep, revisedFuture]),
  ]);
  expect(await futureRefresh.json()).toMatchObject({
    progressRevision: initial.progressRevision,
    revision: futureSaved.revision,
    step: { position: 1 },
  });
  await expectStep(page, correctedStep);
  await expect(preview).toHaveAttribute("src", previewURL!);
  expect(await page.content()).not.toContain(titleOf(revisedFuture));

  await transition("open");
  await expect(
    page.getByRole("button", {
      name: "Entrer dans l’application",
      exact: true,
    }),
  ).toBeEnabled();
  await expectStep(page, correctedStep);
  const openStep = step(
    "Your profile photo is ready to save",
    "Save your photo when you are ready.",
    "profile_photo",
  );
  const opened = await saveSteps([openStep, revisedFuture]);
  expect(opened).toMatchObject({ open: true, currentStep: 2 });
  await expectStep(page, openStep);
  await expect(preview).toHaveAttribute("src", previewURL!);
  expect(await (await page.request.get("/api/welcome")).json()).toMatchObject({
    open: false,
    progressRevision: initial.progressRevision,
    revision: opened.revision,
    step: { position: 1 },
  });

  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/profile/avatar" &&
      response.request().method() === "PUT",
  );
  await widget
    .getByRole("button", { name: "Enregistrer la photo", exact: true })
    .click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  await expect(widget.locator(".avatar img")).toHaveAttribute(
    "src",
    (await saved.json()).guest.avatarUrl,
  );
  await expectStep(page, openStep);
});

test("a welcome profile action becomes available only for its step and keeps the rest of the app closed", async ({
  page,
}) => {
  const steps: WelcomeStep[] = [
    step(
      "Find your seat",
      "Take a seat with your group before the next activity.",
      null,
    ),
    step(
      "Choose your profile photo",
      "Add a photo so the other guests can recognize you.",
      "profile_photo",
    ),
    step(
      "Keep the table envelope closed",
      "Wait for the organizer to explain the next activity.",
      null,
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  const invitation = await invite(host, "Camille Welcome Photo Test");
  const profileRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/profile") {
      profileRequests.push(request.url());
    }
  });
  await enterWaiting(page, invitation.invitationUrl);
  const widget = page.locator(".welcome-profile");
  await expect(widget).toHaveCount(0);
  await transition("next");
  await expectStep(page, steps[0]);
  expect(profileRequests).toEqual([]);
  const plainState = await (await page.request.get("/api/welcome")).json();
  expect(plainState.step).toEqual({ position: 1, ...steps[0] });
  expect(JSON.stringify(plainState)).not.toContain("profile_photo");
  const initialHTML = await page.content();
  expect(initialHTML).not.toContain(titleOf(steps[1]));
  expect(initialHTML).not.toContain(titleOf(steps[2]));
  expect((await page.request.get("/api/profile")).status()).toBe(423);

  await transition("next");
  await expectStep(page, steps[0]);
  await guestNext(page);
  await expectStep(page, steps[1]);
  const input = widget.locator('input[type="file"]');
  await expect(
    widget.getByRole("button", { name: "Choisir une photo", exact: true }),
  ).toBeVisible();
  await expect(input).toBeHidden();
  await input.setInputFiles(await profileImage(page));
  const preview = widget.getByRole("img", {
    name: "Aperçu de ta photo de profil",
    exact: true,
  });
  await expect(preview).toBeVisible();
  const previewURL = await preview.getAttribute("src");
  await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/welcome",
    ),
    reconnectRealtime(page),
  ]);
  await expect(preview).toHaveAttribute("src", previewURL!);
  await page.screenshot({
    path: test.info().outputPath("welcome-photo-preview-mobile.png"),
    fullPage: true,
  });
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile/avatar") &&
      response.request().method() === "PUT",
  );
  await widget
    .getByRole("button", { name: "Enregistrer la photo", exact: true })
    .click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  const avatarURL = (await saved.json()).guest.avatarUrl as string;
  await expect(widget.locator(".avatar img")).toHaveAttribute("src", avatarURL);
  await expect(
    widget.getByText("Photo de profil enregistrée.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/attente$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get(avatarURL)).status()).toBe(200);
  for (const path of [
    "/api/photos",
    "/api/programme",
    "/api/guestbook",
    "/api/party",
  ]) {
    expect((await page.request.get(path)).status()).toBe(423);
  }
  await page.reload();
  if (new URL(page.url()).pathname === "/parametres") {
    await openSettingsSection(page, "welcome");
  }
  await expectStep(page, steps[1]);
  await expect(widget.locator(".avatar img")).toHaveAttribute("src", avatarURL);
  await expect(widget.locator(".avatar img")).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await page.screenshot({
    path: test.info().outputPath("welcome-photo-mobile.png"),
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
    path: test.info().outputPath("welcome-photo-desktop.png"),
    fullPage: true,
  });

  await transition("next");
  await expectStep(page, steps[1]);
  await expect(widget.locator(".avatar img")).toHaveAttribute("src", avatarURL);
  await guestNext(page);
  await expectStep(page, steps[2]);
  await expect(widget).toHaveCount(0);
  expect((await page.request.get("/api/profile")).status()).toBe(423);
  expect(
    (
      await page.request.delete("/api/profile/avatar", {
        headers: mutationHeaders,
      })
    ).status(),
  ).toBe(423);
  expect((await page.request.get(avatarURL)).status()).toBe(423);
  expect((await host.get(avatarURL)).status()).toBe(200);
  await transition("open");
  await finishWelcome(page);
  await expect(page.locator(".navigation-profile .avatar img")).toHaveAttribute(
    "src",
    avatarURL,
  );
});

test("guest navigation discards stale profile loads and prevents a pending photo from saving", async ({
  page,
}) => {
  const steps: WelcomeStep[] = [
    step(
      "First profile photo prompt",
      "Choose a photo for your profile.",
      "profile_photo",
    ),
    step(
      "Second profile photo prompt",
      "You can still choose your photo during this step.",
      "profile_photo",
    ),
    step(
      "Listen to the next instructions",
      "Leave your phone aside for the next activity.",
      null,
    ),
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  const invitation = await invite(host, "Alex Welcome Pending Test");
  let releaseLoad!: () => void;
  let loadHeld = false;
  let holdLoads = true;
  let canceledLoads = 0;
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/profile") canceledLoads += 1;
  });
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  await page.route("**/api/profile", async (route) => {
    // Development StrictMode can start another load before the initial effect settles.
    if (!holdLoads) return route.continue();
    const response = await route.fetch();
    loadHeld = true;
    await loadGate;
    await route.fulfill({ response });
  });
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let uploadHeld = false;
  let uploadStatus: number | undefined;
  try {
    await enterWaiting(page, invitation.invitationUrl);
    await expect.poll(() => loadHeld).toBe(true);
    await expect(
      page.getByText("Chargement de ton profil…", { exact: true }),
    ).toBeVisible();
    const previouslyCanceled = canceledLoads;
    holdLoads = false;
    await transition("next");
    await expectStep(page, steps[0]);
    await guestNext(page);
    await expectStep(page, steps[1]);
    const widget = page.locator(".welcome-profile");
    await expect(
      widget.getByRole("button", { name: "Choisir une photo", exact: true }),
    ).toBeVisible();
    await expect.poll(() => canceledLoads).toBeGreaterThan(previouslyCanceled);
    releaseLoad();
    await expectStep(page, steps[1]);
    await widget
      .locator('input[type="file"]')
      .setInputFiles(await profileImage(page));
    await page.route("**/api/profile/avatar", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      uploadHeld = true;
      await uploadGate;
      const response = await route.fetch();
      uploadStatus = response.status();
      await route.fulfill({ response });
    });
    await widget
      .getByRole("button", { name: "Enregistrer la photo", exact: true })
      .click();
    await expect.poll(() => uploadHeld).toBe(true);
    await transition("next");
    await expectStep(page, steps[1]);
    await guestNext(page);
    await expectStep(page, steps[2]);
    await expect(widget).toHaveCount(0);
    releaseUpload();
    await expect.poll(() => uploadStatus).toBe(423);
    await expectStep(page, steps[2]);
    expect(
      (await (await page.request.get("/api/session")).json()).guest.avatarUrl,
    ).toBeNull();
    expect((await page.request.get("/api/photos")).status()).toBe(423);
  } finally {
    releaseLoad();
    releaseUpload();
    await page.unrouteAll({ behavior: "wait" });
  }
});
