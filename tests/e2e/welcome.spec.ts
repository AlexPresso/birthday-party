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
type WelcomeStep = {
  title: string;
  body: string;
  action: "profile_photo" | null;
};
type AdminWelcome = {
  open: boolean;
  revision: number;
  currentStep: number;
  steps: WelcomeStep[];
};
let host: APIRequestContext;
let previousSteps: WelcomeStep[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function adminState(): Promise<AdminWelcome> {
  const response = await host.get("/api/admin/welcome");
  expect(response.status()).toBe(200);
  return response.json();
}

async function transition(action: "start" | "next" | "open") {
  const { revision } = await adminState();
  const response = await host.post("/api/admin/welcome/transition", {
    data: { revision, action },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<AdminWelcome>;
}

async function saveSteps(steps: WelcomeStep[]) {
  const { revision } = await adminState();
  const response = await host.put("/api/admin/welcome", {
    data: { revision, steps },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<AdminWelcome>;
}

async function restoreOpen(steps: WelcomeStep[]) {
  if (!(await adminState()).open) await transition("open");
  await saveSteps(steps);
}

async function invite(name: string) {
  const response = await host.post("/api/admin/guests", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{
    guest: { id: number; name: string };
    invitationUrl: string;
  }>;
}

async function enterWaiting(page: Page, invitationUrl: string) {
  await page.goto(invitationUrl);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page).toHaveURL(/\/attente$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
}

async function expectStep(page: Page, step: WelcomeStep) {
  await expect(
    page.getByRole("heading", { name: step.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(step.body, { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page).toHaveURL(/\/attente$/);
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Welcome Test Host"],
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
  previousSteps = (await adminState()).steps;
});

test.beforeEach(async () => {
  await restoreOpen([]);
});

test.afterEach(async () => {
  // The browser suite shares one disposable database across its specifications.
  await restoreOpen(previousSteps);
});

test.afterAll(async () => {
  await host?.dispose();
});

test("guests wait for the host, discover only the current step and enter when access opens", async ({
  page,
  browser,
}) => {
  const steps = [
    {
      title: "Find your table and keep your invitation nearby",
      body: "The table numbers are on the cards beside the entrance. Keep your invitation with you for the next activity.",
      action: null,
    },
    {
      title: "Open the envelope on your table",
      body: "Read the note together, then leave the envelope beside the flowers.",
      action: null,
    },
  ];
  await saveSteps(steps);
  await transition("start");
  const invitation = await invite("Camille Welcome Test");
  await enterWaiting(page, invitation.invitationUrl);
  await expect(
    page.getByRole("heading", {
      name: `Bienvenue ${invitation.guest.name}`,
      exact: true,
    }),
  ).toBeVisible();
  const waitingResponse = await page.request.get("/api/welcome");
  expect(waitingResponse.status()).toBe(200);
  expect(await waitingResponse.json()).toEqual({
    open: false,
    revision: expect.any(Number),
    step: null,
  });
  const initialHTML = await page.content();
  for (const step of steps) {
    expect(initialHTML).not.toContain(step.title);
    expect(initialHTML).not.toContain(step.body);
  }
  await page.screenshot({
    path: "test-results/welcome-waiting-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/welcome-waiting-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });

  // A deep link and a reload must retain the same waiting state and identity.
  await page.goto("/programme");
  await expect(page).toHaveURL(/\/attente$/);
  await page.reload();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await (await page.request.get("/api/session")).json()).guest.id).toBe(
    invitation.guest.id,
  );

  await transition("next");
  await expectStep(page, steps[0]);
  expect(await (await page.request.get("/api/welcome")).json()).toEqual({
    open: false,
    revision: expect.any(Number),
    step: { position: 1, ...steps[0] },
  });
  const stageResponse = await page.request.get("/attente");
  expect(stageResponse.status()).toBe(200);
  const stageHTML = await stageResponse.text();
  expect(stageHTML).not.toContain(steps[1].title);
  expect(stageHTML).not.toContain(steps[1].body);

  await page.route("**/api/welcome", (route) => route.abort("failed"), {
    times: 1,
  });
  const connectionError = page.getByText(
    "Impossible de vérifier s’il y a du nouveau. On réessaie automatiquement.",
    { exact: true },
  );
  await expect(connectionError).toBeVisible();
  await expectStep(page, steps[0]);
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(connectionError).toHaveCount(0);
  await page.screenshot({
    path: "test-results/welcome-step-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/welcome-step-desktop.png",
    fullPage: true,
  });

  const lateContext = await browser.newContext({
    baseURL,
    locale: "fr-CH",
    viewport: { width: 390, height: 844 },
  });
  try {
    const latePage = await lateContext.newPage();
    const lateInvitation = await invite("Alex Welcome Test");
    await enterWaiting(latePage, lateInvitation.invitationUrl);
    await expectStep(latePage, steps[0]);
    await transition("next");
    await expectStep(latePage, steps[1]);
    // The first context may be backgrounded; a returning guest reads the latest state.
    await page.bringToFront();
    await expectStep(page, steps[1]);
    await page.reload();
    await expectStep(page, steps[1]);
    expect((await adminState()).open).toBe(false);

    await transition("open");
    await expect(page).toHaveURL(/\/photos$/);
    const navigation = page.getByRole("navigation");
    for (const name of ["Médias", "Programme", "Livre d'or", "Paramètres"]) {
      await expect(
        navigation.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    }
    await latePage.bringToFront();
    await expect(latePage).toHaveURL(/\/photos$/);
  } finally {
    await lateContext.close();
  }
});

test("the host prepares, reorders and reveals welcome steps from settings", async ({
  page,
  context,
}) => {
  await context.addCookies((await host.storageState()).cookies);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/parametres");
  const summary = page.getByText("Accueil des invités", { exact: true });
  await expect(summary).toBeVisible();
  const title = (position: number) =>
    page.getByLabel(`Titre de l’étape ${position}`, { exact: true });
  const body = (position: number) =>
    page.getByLabel(`Texte de l’étape ${position}`, { exact: true });
  const action = page.getByRole("button", {
    name: "Définir une photo de profil",
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
    name: "Activer l’écran d’attente",
    exact: true,
  });

  await add.click();
  await title(1).fill("Read the table card");
  await body(1).fill("Find the name of your team on the table card.");
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await add.click();
  await title(2).fill("Collect your envelope at the entrance");
  await body(2).fill("Take one envelope for your table and keep it closed.");
  await action.click();
  await expect(start).toBeDisabled();

  await page
    .getByRole("button", { name: "Monter l’étape 2", exact: true })
    .click();
  await expect(title(1)).toHaveValue("Collect your envelope at the entrance");
  await expect(action).toHaveAttribute("aria-pressed", "true");
  await selectStep(2);
  await expect(title(2)).toHaveValue("Read the table card");
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await title(2).fill("Find your team on the table card");
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/welcome") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Enregistrer les étapes", exact: true })
    .click();
  expect((await savedResponse).status()).toBe(200);
  expect((await adminState()).steps).toEqual([
    {
      title: "Collect your envelope at the entrance",
      body: "Take one envelope for your table and keep it closed.",
      action: "profile_photo",
    },
    {
      title: "Find your team on the table card",
      body: "Find the name of your team on the table card.",
      action: null,
    },
  ]);

  await page.reload();
  await expect(summary).toBeVisible();
  await selectStep(1);
  await expect(title(1)).toHaveValue("Collect your envelope at the entrance");
  await expect(action).toHaveAttribute("aria-pressed", "true");
  await selectStep(2);
  await expect(title(2)).toHaveValue("Find your team on the table card");
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await selectStep(1);
  await page.screenshot({
    path: "test-results/welcome-admin-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "test-results/welcome-admin-desktop.png",
    fullPage: true,
  });

  async function pressTransition(name: string) {
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/welcome/transition") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    expect((await response).status()).toBe(200);
  }

  await pressTransition("Activer l’écran d’attente");
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(await adminState()).toMatchObject({ open: false, currentStep: 0 });
  await pressTransition("Afficher la première étape");
  expect(await adminState()).toMatchObject({ open: false, currentStep: 1 });
  await expect(action).toBeDisabled();
  await pressTransition("Passer à l’étape suivante");
  expect(await adminState()).toMatchObject({ open: false, currentStep: 2 });
  await expect(
    page.getByRole("button", {
      name: "Passer à l’étape suivante",
      exact: true,
    }),
  ).toHaveCount(0);
  await pressTransition("Ouvrir l’application");
  expect((await adminState()).open).toBe(true);
});

test("a connected guest moves to waiting when the host closes access and can sign out", async ({
  page,
}) => {
  const invitation = await invite("Jordan Waiting Test");
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
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(page).toHaveURL(/\/invitation$/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
});

test("the host keeps a conflicting draft until deliberately discarding it and can continue", async ({
  page,
  context,
}) => {
  const savedSteps: WelcomeStep[] = [
    {
      title: "Collect the table card",
      body: "Take one card for your table.",
      action: null,
    },
    {
      title: "Read the team name",
      body: "Read the name written on your card.",
      action: null,
    },
  ];
  await saveSteps(savedSteps);
  await transition("start");
  await context.addCookies((await host.storageState()).cookies);
  await page.goto("/parametres");
  const title = page.getByLabel("Titre de l’étape 1", { exact: true });
  const draftTitle = "Unpublished changes from this browser";
  await title.fill(draftTitle);

  // Another host reveals a step while this browser still holds an unsaved draft.
  await transition("next");
  const rejectedSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/welcome") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Enregistrer les étapes", exact: true })
    .click();
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
  await expect(title).toBeDisabled();
  const next = page.getByRole("button", {
    name: "Passer à l’étape suivante",
    exact: true,
  });
  await expect(next).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Ouvrir l’application", exact: true }),
  ).toBeEnabled();

  const discard = page.getByRole("button", {
    name: "Abandonner les modifications",
    exact: true,
  });
  page.once("dialog", (dialog) => void dialog.dismiss());
  await discard.click();
  await expect(title).toHaveValue(draftTitle);
  page.once("dialog", (dialog) => void dialog.accept());
  await discard.click();
  await expect(title).toHaveValue(savedSteps[0].title);
  await expect(discard).toHaveCount(0);
  await expect(next).toBeEnabled();
  expect((await adminState()).steps).toEqual(savedSteps);

  await next.click();
  await expect(
    page.getByRole("heading", { name: "Étape 2 sur 2 affichée", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Ouvrir l’application", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Application ouverte", exact: true }),
  ).toBeVisible();
  expect((await adminState()).open).toBe(true);
});

const editorSteps: WelcomeStep[] = [
  {
    title: "Find your table",
    body: "Read the table names beside the entrance.",
    action: null,
  },
  {
    title: "Choose your photo",
    body: "Choose a photo for your profile.",
    action: null,
  },
  {
    title: "Collect your envelope",
    body: "Take one envelope for your table.",
    action: null,
  },
];

async function saveEditor(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/welcome") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Enregistrer les étapes", exact: true })
    .click();
  expect((await response).status()).toBe(200);
}

test("dragging a selected welcome step preserves its draft and action settings through save and reload", async ({
  page,
  context,
}) => {
  await saveSteps(editorSteps);
  await context.addCookies((await host.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/parametres");
  const editor = page.locator(".welcome-admin");
  const list = editor.locator(".welcome-step-list");
  const rows = list.locator("li");
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  const editedTitle = "Choose a photo that your friends recognize";
  const editedBody =
    "You can change your profile photo again after the welcome.";
  await page
    .getByLabel("Titre de l’étape 2", { exact: true })
    .fill(editedTitle);
  await page.getByLabel("Texte de l’étape 2", { exact: true }).fill(editedBody);
  const action = editor.getByRole("button", {
    name: "Définir une photo de profil",
    exact: true,
  });
  await action.click();
  await expect(
    editor.getByText("Aucun réglage pour cette action.", { exact: true }),
  ).toBeVisible();
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
    editorSteps[0].title,
    editorSteps[2].title,
  ]);
  await expect(rows.first()).toHaveAttribute("data-step-key", selectedKey!);
  await expect(
    editor.getByRole("button", { name: "Déplacer l’étape 1", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel("Titre de l’étape 1", { exact: true }),
  ).toHaveValue(editedTitle);
  await expect(
    page.getByLabel("Texte de l’étape 1", { exact: true }),
  ).toHaveValue(editedBody);
  await expect(action).toHaveAttribute("aria-pressed", "true");

  await editor
    .getByRole("button", { name: "Retirer l’action", exact: true })
    .click();
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await editor
    .getByRole("button", { name: "Modifier l’étape 3", exact: true })
    .click();
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await editor
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Texte de l’étape 1", { exact: true }),
  ).toHaveValue(editedBody);
  await expect(action).toHaveAttribute("aria-pressed", "false");
  await action.click();
  await saveEditor(page);
  expect((await adminState()).steps).toEqual([
    { title: editedTitle, body: editedBody, action: "profile_photo" },
    editorSteps[0],
    editorSteps[2],
  ]);
  await page.reload();
  await expect(rows).toContainText([
    editedTitle,
    editorSteps[0].title,
    editorSteps[2].title,
  ]);
  await expect(
    page.getByLabel("Titre de l’étape 1", { exact: true }),
  ).toHaveValue(editedTitle);
  await expect(action).toHaveAttribute("aria-pressed", "true");
  await editor.screenshot({ path: "test-results/welcome-editor-desktop.png" });

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
  await editor
    .getByRole("button", { name: "Enregistrer les étapes", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 4", { exact: true }),
  ).toBeFocused();
  expect(unexpectedSaves).toBe(0);
  await editor
    .getByRole("button", { name: "Supprimer l’étape 4", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 3", { exact: true }),
  ).toBeFocused();
  page.on("dialog", (dialog) => void dialog.accept());
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 2", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 2", { exact: true }),
  ).toHaveValue(editorSteps[2].title);
  await expect(
    page.getByLabel("Titre de l’étape 2", { exact: true }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 2", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 1", { exact: true }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Supprimer l’étape 1", exact: true })
    .click();
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
    const editor = page.locator(".welcome-admin");
    const list = editor.locator(".welcome-step-list");
    const rows = list.locator("li");
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    const draftBody =
      "Keep this envelope closed until the host tells you to open it.";
    await page
      .getByLabel("Texte de l’étape 3", { exact: true })
      .fill(draftBody);
    await editor
      .getByRole("button", { name: "Monter l’étape 3", exact: true })
      .press("Enter");
    await expect(rows).toContainText([
      editorSteps[0].title,
      editorSteps[2].title,
      editorSteps[1].title,
    ]);
    await expect(
      page.getByLabel("Texte de l’étape 2", { exact: true }),
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
      editorSteps[0].title,
      editorSteps[2].title,
      editorSteps[1].title,
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
      editorSteps[0].title,
      editorSteps[2].title,
      editorSteps[1].title,
    ]);
    await touchDrag(3);
    await expect(rows).toContainText([
      editorSteps[1].title,
      editorSteps[0].title,
      editorSteps[2].title,
    ]);
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    await expect(
      page.getByLabel("Texte de l’étape 3", { exact: true }),
    ).toHaveValue(draftBody);
    await editor
      .getByRole("button", { name: "Définir une photo de profil", exact: true })
      .click();
    await saveEditor(page);
    expect((await adminState()).steps).toEqual([
      editorSteps[1],
      editorSteps[0],
      { ...editorSteps[2], body: draftBody, action: "profile_photo" },
    ]);
    await page.reload();
    await expect(rows).toContainText([
      editorSteps[1].title,
      editorSteps[0].title,
      editorSteps[2].title,
    ]);
    await editor
      .getByRole("button", { name: "Modifier l’étape 3", exact: true })
      .click();
    await expect(
      page.getByLabel("Texte de l’étape 3", { exact: true }),
    ).toHaveValue(draftBody);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await editor.screenshot({ path: "test-results/welcome-editor-mobile.png" });

    await transition("start");
    await transition("next");
    await page.reload();
    await expect(
      editor.getByRole("button", { name: "Déplacer l’étape 1", exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", {
        name: "Définir une photo de profil",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Titre de l’étape 1", { exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("dragging through twelve welcome steps scrolls the list and preserves the moved action", async ({
  page,
  context,
}) => {
  const steps: WelcomeStep[] = Array.from({ length: 12 }, (_, index) => ({
    title:
      index % 2 === 0
        ? `Welcome activity ${index + 1}: collect the card assigned to your table`
        : `Welcome activity ${index + 1}`,
    body: `Instructions for welcome activity ${index + 1}.`,
    action: index === 0 ? "profile_photo" : null,
  }));
  await saveSteps(steps);
  await context.addCookies((await host.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/parametres");
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
  await expect(rows).toContainText(ordered.map((step) => step.title));
  await expect(
    page.getByLabel("Titre de l’étape 12", { exact: true }),
  ).toHaveValue(steps[0].title);
  await expect(
    page.getByLabel("Texte de l’étape 12", { exact: true }),
  ).toHaveValue(steps[0].body);
  await expect(
    editor.getByRole("button", {
      name: "Définir une photo de profil",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await saveEditor(page);
  expect((await adminState()).steps).toEqual(ordered);
  await page.reload();
  await expect(rows).toContainText(ordered.map((step) => step.title));
  await page.setViewportSize({ width: 390, height: 844 });
  // Confirm hydration before sending low-level pointer events after a full reload.
  await editor
    .getByRole("button", { name: "Modifier l’étape 2", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 2", { exact: true }),
  ).toHaveValue(ordered[1].title);
  await editor
    .getByRole("button", { name: "Modifier l’étape 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Titre de l’étape 1", { exact: true }),
  ).toHaveValue(ordered[0].title);
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
  await expect(rows).toContainText(ordered.map((step) => step.title));
});

async function profileImage(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 256;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#60917e";
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
  });
  return {
    name: "welcome-profile-test.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

test("a welcome profile action becomes available only for its step and keeps the rest of the app closed", async ({
  page,
}) => {
  const steps: WelcomeStep[] = [
    {
      title: "Find your seat",
      body: "Take a seat with your group before the next activity.",
      action: null,
    },
    {
      title: "Choose your profile photo",
      body: "Add a photo so the other guests can recognize you.",
      action: "profile_photo",
    },
    {
      title: "Keep the table envelope closed",
      body: "Wait for the organizer to explain the next activity.",
      action: null,
    },
  ];
  await saveSteps(steps);
  await transition("start");
  const invitation = await invite("Camille Welcome Photo Test");
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
  expect(initialHTML).not.toContain(steps[1].title);
  expect(initialHTML).not.toContain(steps[2].title);
  expect((await page.request.get("/api/profile")).status()).toBe(423);

  await transition("next");
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
  await page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/welcome",
  );
  await expect(preview).toHaveAttribute("src", previewURL!);
  await page.screenshot({
    path: "test-results/welcome-photo-preview-mobile.png",
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
  await expectStep(page, steps[1]);
  await expect(widget.locator(".avatar img")).toHaveAttribute("src", avatarURL);
  await expect(widget.locator(".avatar img")).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await page.screenshot({
    path: "test-results/welcome-photo-mobile.png",
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
    path: "test-results/welcome-photo-desktop.png",
    fullPage: true,
  });

  await transition("next");
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
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.locator(".app-header .avatar img")).toHaveAttribute(
    "src",
    avatarURL,
  );
});

test("advancing a welcome action discards stale profile loads and prevents a pending photo from saving", async ({
  page,
}) => {
  const steps: WelcomeStep[] = [
    {
      title: "First profile photo prompt",
      body: "Choose a photo for your profile.",
      action: "profile_photo",
    },
    {
      title: "Second profile photo prompt",
      body: "You can still choose your photo during this step.",
      action: "profile_photo",
    },
    {
      title: "Listen to the next instructions",
      body: "Leave your phone aside for the next activity.",
      action: null,
    },
  ];
  await saveSteps(steps);
  await transition("start");
  await transition("next");
  const invitation = await invite("Alex Welcome Pending Test");
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
