import { openSettingsSection } from "./settings-navigation";
import {
  test,
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};

type Guest = { id: number; name: string };
type Invitation = { guest: Guest; invitationUrl: string };
type Vote = {
  question: string;
  status: "draft" | "open" | "closed" | "revealed";
  candidates: Guest[];
  allowSelfVote: boolean;
  myCandidateId: number | null;
  participationCount: number | null;
  results: { candidateId: number; votes: number }[] | null;
};
type ProgrammeEvent = {
  id: number;
  type: "event" | "vote";
  revision: number;
  title: string;
  description: string;
  teaser: string;
  startsAt: string | null;
  unlockAt: string | null;
  locked: boolean;
  vote: Vote | null;
};

let host: APIRequestContext;
const eventIDs: number[] = [];
const contexts: BrowserContext[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function activate(client: APIRequestContext, url: string) {
  const response = await client.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(url) },
  });
  expect(response.status()).toBe(200);
}

async function invite(name: string): Promise<Invitation> {
  const response = await host.post("/api/admin/guests", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function programme(client = host): Promise<ProgrammeEvent[]> {
  const path = client === host ? "/api/admin/programme" : "/api/programme";
  const response = await client.get(path);
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}

async function eventFrom(client: APIRequestContext, id: number) {
  const event = (await programme(client)).find((item) => item.id === id);
  if (!event) throw new Error(`Programme event ${id} was not returned.`);
  return event;
}

async function voteFrom(client: APIRequestContext, id: number) {
  const event = await eventFrom(client, id);
  if (!event.vote)
    throw new Error(`Programme event ${id} has no visible vote.`);
  return event.vote;
}

async function createEvent(title: string): Promise<ProgrammeEvent> {
  const response = await host.post("/api/admin/programme", {
    data: {
      type: "event",
      title,
      description: "On se retrouve pour partager les souvenirs de la soirée.",
      teaser: "",
      startsAt: null,
      unlockAt: null,
      vote: null,
    },
  });
  expect(response.status()).toBe(201);
  const event = await response.json();
  eventIDs.push(event.id);
  return event;
}

async function createVote(
  title: string,
  question: string,
  candidates: Guest[],
  unlockAt: string | null = null,
): Promise<ProgrammeEvent> {
  const response = await host.post("/api/admin/programme", {
    data: {
      type: "vote",
      title,
      description: "Choisis la personne qui t’a le plus fait sourire ce soir.",
      teaser: "Un vote se prépare",
      startsAt: null,
      unlockAt,
      vote: {
        question,
        candidateIds: candidates.map((guest) => guest.id),
        allowSelfVote: false,
      },
    },
  });
  expect(response.status()).toBe(201);
  const event = await response.json();
  eventIDs.push(event.id);
  return event;
}

async function changeStatus(
  eventID: number,
  status: "open" | "closed" | "revealed",
) {
  const event = await eventFrom(host, eventID);
  const response = await host.post(
    `/api/admin/programme/${eventID}/vote/state`,
    {
      data: { status, revision: event.revision },
    },
  );
  expect(response.status()).toBe(200);
}

async function castVote(
  client: APIRequestContext,
  eventID: number,
  candidateId: number,
) {
  const response = await client.put(`/api/programme/${eventID}/vote`, {
    headers: mutationHeaders,
    data: { candidateId },
  });
  expect(response.status()).toBe(200);
}

async function startVoteEditor(page: Page, title: string, question: string) {
  await page
    .getByRole("button", { name: "Ajouter un événement", exact: true })
    .click();
  await page.getByRole("button", { name: /^Vote pour une personne/ }).click();
  const form = page.locator(".event-editor");
  await form.locator("#event-title").fill(title);
  await form.getByLabel("Question du vote", { exact: true }).fill(question);
  return form;
}

async function addAvatar(page: Page, invitation: Invitation) {
  // Synthetic portraits keep screenshots recognizable without using guest data.
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#80748c";
    drawing.fillRect(0, 0, 256, 256);
    drawing.fillStyle = "#3b3043";
    drawing.beginPath();
    drawing.ellipse(128, 256, 90, 96, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#edc3a4";
    drawing.beginPath();
    drawing.ellipse(128, 104, 48, 57, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#45362f";
    drawing.beginPath();
    drawing.ellipse(123, 66, 51, 26, -0.2, 0, Math.PI * 2);
    drawing.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const client = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  try {
    await activate(client, invitation.invitationUrl);
    const response = await client.put("/api/profile/avatar", {
      multipart: {
        file: {
          name: "candidate.png",
          mimeType: "image/png",
          buffer: Buffer.from(image, "base64"),
        },
      },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).guest.avatarUrl as string;
  } finally {
    await client.dispose();
  }
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    [
      "scripts/backend.mjs",
      "invite-admin",
      "--name",
      "Programme Activities Test Host",
    ],
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
  await activate(host, match[0]);
});

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const id of eventIDs.splice(0)) {
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  }
});

test.afterAll(async () => {
  await host?.dispose();
});

test("the host creates a vote directly in the programme with selected candidates and profile photos", async ({
  browser,
  page,
}) => {
  const camille = await invite("Camille — costume");
  const robin = await invite("Robin — costume");
  const avatarURL = await addAvatar(page, camille);
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
    viewport: { width: 1440, height: 1100 },
  });
  contexts.push(context);
  const editor = await context.newPage();
  await editor.goto("/parametres");
  await openSettingsSection(editor, "programme");
  const title = "Les costumes de la soirée";
  const question = "Qui a le mieux réussi son déguisement ?";
  const form = await startVoteEditor(editor, title, question);
  await form
    .getByLabel("Détails", { exact: true })
    .fill("Un vote pour départager les déguisements.");
  for (const guest of [camille.guest, robin.guest]) {
    await form.getByRole("checkbox", { name: guest.name, exact: true }).check();
  }
  await expect(form.locator(`img[src="${avatarURL}"]`)).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await expectNoOverflow(editor);
  await form.screenshot({
    path: "test-results/programme-vote-editor-desktop.png",
  });
  await editor.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(editor);
  await editor.setViewportSize({ width: 1440, height: 1100 });
  await expect(
    form.getByRole("button", { name: "Enregistrer l’événement", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      (await programme()).some((event) => event.title === title),
    )
    .toBe(true);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const saved = (await programme()).find((event) => event.title === title)!;
  eventIDs.push(saved.id);
  expect(saved.type).toBe("vote");
  expect(saved.vote?.status).toBe("draft");
  expect(saved.vote?.results).toBeNull();
  expect(saved.vote?.candidates.map((guest) => guest.id).sort()).toEqual(
    [camille.guest.id, robin.guest.id].sort(),
  );
  const eventCard = editor
    .locator(".admin-event-list > li")
    .filter({ hasText: title });
  editor.once("dialog", (dialog) => dialog.accept());
  await eventCard
    .getByRole("button", { name: "Ouvrir le vote", exact: true })
    .click();
  await expect(
    eventCard.getByRole("button", { name: "Fermer le vote", exact: true }),
  ).toBeVisible();
  expect((await voteFrom(host, saved.id)).status).toBe("open");
  await editor.screenshot({
    path: "test-results/programme-vote-admin-desktop.png",
    fullPage: true,
  });
  await editor.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(editor);
});

test("guest changes update an open vote editor without reloading settings", async ({
  browser,
}) => {
  await createEvent("Les retrouvailles");
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
    viewport: { width: 1440, height: 1100 },
  });
  contexts.push(context);
  const editor = await context.newPage();
  await editor.goto("/programme");
  const manageProgramme = editor.getByRole("link", {
    name: "Gérer le programme",
    exact: true,
  });
  await expect(manageProgramme).toBeVisible();
  await expectNoOverflow(editor);
  await editor.screenshot({
    path: "test-results/programme-admin-navigation-desktop.png",
    fullPage: true,
  });
  await editor.setViewportSize({ width: 390, height: 844 });
  await expect(manageProgramme).toBeVisible();
  await expectNoOverflow(editor);
  await editor.screenshot({
    path: "test-results/programme-admin-navigation-mobile.png",
    fullPage: true,
  });
  await manageProgramme.click();
  await expect(editor).toHaveURL(
    (url) =>
      url.pathname === "/parametres" &&
      url.searchParams.get("section") === "programme",
  );
  await expect(
    editor.getByRole("heading", { name: "Programme", exact: true, level: 1 }),
  ).toBeVisible();
  await editor.setViewportSize({ width: 1440, height: 1100 });
  const title = "Un vote préparé ensemble";
  const question = "Qui a proposé la meilleure idée ?";
  const eventEditor = await startVoteEditor(editor, "", "");
  expect((await programme()).some((event) => event.title === title)).toBe(
    false,
  );

  await openSettingsSection(editor, "guests");
  const names = ["Camille — nouveau candidat", "Robin — nouveau candidat"];
  const excluded = "Alex — candidat retiré";
  for (const name of [...names, excluded]) {
    await editor.getByLabel("Prénom de l’invité", { exact: true }).fill(name);
    await editor
      .getByRole("button", { name: "Créer l’invitation", exact: true })
      .click();
    await expect(
      editor.locator(".guest-list").getByText(name, { exact: true }),
    ).toBeVisible();
    await openSettingsSection(editor, "programme");
    await expect(
      eventEditor.getByRole("checkbox", { name, exact: true }),
    ).toBeVisible();
    await openSettingsSection(editor, "guests");
  }
  await openSettingsSection(editor, "programme");
  await eventEditor.locator("#event-title").fill(title);
  await eventEditor
    .getByLabel("Question du vote", { exact: true })
    .fill(question);
  for (const name of names) {
    await eventEditor.getByRole("checkbox", { name, exact: true }).check();
  }
  const selectedCount = eventEditor.locator(
    ".activity-selection-actions > .fine-print",
  );
  await expect(selectedCount).toContainText("2 sélectionnés");
  await expect
    .poll(async () =>
      (await programme()).some((event) => event.title === title),
    )
    .toBe(true);
  const saved = (await programme()).find((event) => event.title === title)!;
  eventIDs.push(saved.id);

  const robin = names[1];
  await openSettingsSection(editor, "guests");
  editor.once("dialog", (dialog) => dialog.accept());
  await editor
    .getByRole("button", { name: `Retirer l’accès de ${robin}`, exact: true })
    .click();
  await openSettingsSection(editor, "programme");
  await expect(
    eventEditor.getByRole("checkbox", { name: robin, exact: true }),
  ).toHaveCount(0);
  await expect(selectedCount).toContainText("1 sélectionnés");
  await openSettingsSection(editor, "guests");
  await editor
    .getByRole("button", { name: `Nouveau lien pour ${robin}`, exact: true })
    .click();
  await openSettingsSection(editor, "programme");
  await expect(
    eventEditor.getByRole("checkbox", { name: robin, exact: true }),
  ).toBeChecked();
  await expect(selectedCount).toContainText("2 sélectionnés");

  await eventEditor
    .getByRole("checkbox", { name: excluded, exact: true })
    .check();
  await expect(selectedCount).toContainText("3 sélectionnés");
  await openSettingsSection(editor, "guests");
  editor.once("dialog", (dialog) => dialog.accept());
  await editor
    .getByRole("button", {
      name: `Retirer l’accès de ${excluded}`,
      exact: true,
    })
    .click();
  await openSettingsSection(editor, "programme");
  await expect(
    eventEditor.getByRole("checkbox", { name: excluded, exact: true }),
  ).toHaveCount(0);
  await expect(selectedCount).toContainText("2 sélectionnés");

  await expect(
    eventEditor.getByLabel("Question du vote", { exact: true }),
  ).toHaveValue(question);
  await eventEditor
    .getByLabel("Question du vote", { exact: true })
    .fill(`${question} `);
  await eventEditor.getByLabel("Question du vote", { exact: true }).blur();
  await expect
    .poll(async () => (await eventFrom(host, saved.id)).vote?.candidates.length)
    .toBe(2);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const updated = await eventFrom(host, saved.id);
  expect(updated.vote?.question).toBe(question);
  expect(
    updated.vote?.candidates.map((candidate) => candidate.name).sort(),
  ).toEqual([...names].sort());
});

test("guests see a vote only after opening and unlocking, and its results only after revelation", async ({
  page,
}) => {
  const mila = await invite("Mila — piste de danse");
  const camille = await invite("Camille — piste de danse");
  const robin = await invite("Robin — piste de danse");
  const avatarURL = await addAvatar(page, camille);
  await activate(page.request, mila.invitationUrl);
  const question = "Qui nous a donné envie de danser ?";
  const event = await createVote(
    "Sur la piste de danse",
    question,
    [mila.guest, camille.guest, robin.guest],
    new Date(Date.now() + 86_400_000).toISOString(),
  );
  let realtimeReady = false;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/api/realtime") return;
    socket.on("framereceived", ({ payload }) => {
      if (JSON.parse(payload.toString()).type === "ready") realtimeReady = true;
    });
  });
  await page.goto("/programme");
  await expect.poll(() => realtimeReady).toBe(true);
  await expect(
    page.getByRole("link", { name: "Gérer le programme", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toHaveCount(0);
  expect(
    (await programme(page.request)).some((item) => item.id === event.id),
  ).toBe(false);

  await changeStatus(event.id, "open");
  await expect(page.getByText(event.teaser, { exact: true })).toBeVisible();
  expect(await eventFrom(page.request, event.id)).toMatchObject({
    title: event.teaser,
    description: "",
    locked: true,
    vote: null,
  });
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
  await expect(page.getByText(camille.guest.name, { exact: true })).toHaveCount(
    0,
  );
  const current = await eventFrom(host, event.id);
  const unlocked = await host.put(`/api/admin/programme/${event.id}`, {
    data: {
      type: current.type,
      revision: current.revision,
      title: current.title,
      description: current.description,
      teaser: current.teaser,
      startsAt: current.startsAt,
      unlockAt: null,
      vote: {
        question,
        candidateIds: [mila.guest.id, camille.guest.id, robin.guest.id],
        allowSelfVote: false,
      },
    },
  });
  expect(unlocked.status()).toBe(200);
  const ballot = page.getByRole("region", { name: question, exact: true });
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  const featured = page.getByRole("article", {
    name: event.title,
    exact: true,
  });
  await expect(ballot).not.toBeVisible();
  await expect(
    featured.locator(`.programme-vote-preview img[src="${avatarURL}"]`),
  ).toHaveJSProperty("naturalWidth", 256);
  await expectNoOverflow(page);
  await page.screenshot({
    path: "test-results/programme-featured-vote-mobile.png",
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "test-results/programme-featured-vote-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await featured
    .locator("summary")
    .filter({ hasText: /^Voter$/ })
    .click();
  await expect(
    ballot.getByRole("radio", { name: mila.guest.name, exact: true }),
  ).toBeDisabled();
  await expect(ballot.locator(`img[src="${avatarURL}"]`)).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await ballot
    .getByRole("searchbox", { name: "Rechercher une personne", exact: true })
    .fill("Robin");
  await expect(
    ballot.getByRole("radio", { name: camille.guest.name, exact: true }),
  ).toHaveCount(0);
  await ballot.getByText(robin.guest.name, { exact: true }).click();
  await expect(
    ballot.getByRole("radio", { name: robin.guest.name, exact: true }),
  ).toBeChecked();
  expect((await voteFrom(page.request, event.id)).myCandidateId).toBeNull();
  await featured
    .locator("summary")
    .filter({ hasText: /^Masquer le vote$/ })
    .click();
  await expect(ballot).not.toBeVisible();
  await createEvent("Un autre rendez-vous");
  await expect(
    page.getByRole("heading", { name: "Un autre rendez-vous", exact: true }),
  ).toBeVisible();
  await featured
    .locator("summary")
    .filter({ hasText: /^Voter$/ })
    .click();
  await expect(
    ballot.getByRole("radio", { name: robin.guest.name, exact: true }),
  ).toBeChecked();
  await ballot
    .getByRole("button", {
      name: `Voter pour ${robin.guest.name}`,
      exact: true,
    })
    .click();
  await expect(
    ballot.getByText(`Ton vote pour ${robin.guest.name} est enregistré.`, {
      exact: true,
    }),
  ).toBeVisible();
  await ballot
    .getByRole("searchbox", { name: "Rechercher une personne", exact: true })
    .fill("");
  await ballot
    .getByRole("radio", { name: camille.guest.name, exact: true })
    .press("Space");
  await ballot
    .getByRole("button", {
      name: `Voter pour ${camille.guest.name}`,
      exact: true,
    })
    .click();
  await expect(
    ballot.getByText(`Ton vote pour ${camille.guest.name} est enregistré.`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await featured
    .locator("summary")
    .filter({ hasText: /^Modifier mon vote$/ })
    .click();
  await expect(
    ballot.getByRole("radio", { name: camille.guest.name, exact: true }),
  ).toBeChecked();
  await expectNoOverflow(page);
  await page.screenshot({
    path: "test-results/programme-vote-mobile.png",
    fullPage: true,
  });

  const other = await invite("Sacha — second ballot");
  const otherClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  try {
    await activate(otherClient, other.invitationUrl);
    await castVote(otherClient, event.id, robin.guest.id);
  } finally {
    await otherClient.dispose();
  }
  expect((await voteFrom(host, event.id)).results).toBeNull();
  expect((await voteFrom(host, event.id)).participationCount).toBe(2);
  await changeStatus(event.id, "closed");
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: event.title })
      .getByText("Vote fermé", { exact: true }),
  ).toBeVisible();
  await expect(
    ballot.getByRole("button", { name: /^Voter pour / }),
  ).toHaveCount(0);
  await expect(
    ballot.getByRole("list", { name: "Résultats", exact: true }),
  ).toHaveCount(0);
  const unrevealed = await voteFrom(page.request, event.id);
  expect(unrevealed.results).toBeNull();
  expect(unrevealed.participationCount).toBeNull();

  await changeStatus(event.id, "revealed");
  const results = ballot.getByRole("list", { name: "Résultats", exact: true });
  await expect(results).toBeVisible();
  for (const name of [camille.guest.name, robin.guest.name]) {
    await expect(
      results.getByRole("listitem").filter({ hasText: name }),
    ).toContainText("1 voix");
  }
  const revealed = await voteFrom(page.request, event.id);
  expect(revealed.participationCount).toBe(2);
  expect(revealed.results).toEqual(
    expect.arrayContaining([
      { candidateId: camille.guest.id, votes: 1 },
      { candidateId: robin.guest.id, votes: 1 },
      { candidateId: mila.guest.id, votes: 0 },
    ]),
  );
  await page.screenshot({
    path: "test-results/programme-vote-results-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoOverflow(page);
});

test("editing a vote event and deleting another event preserves the ballots", async ({
  browser,
  page,
}) => {
  const camille = await invite("Camille — souvenirs");
  const robin = await invite("Robin — souvenirs");
  const voter = await invite("Lou — souvenirs");
  await activate(page.request, voter.invitationUrl);
  const event = await createVote(
    "Les souvenirs de la soirée",
    "Qui a raconté la meilleure anecdote ?",
    [camille.guest, robin.guest],
  );
  await changeStatus(event.id, "open");
  await castVote(page.request, event.id, camille.guest.id);
  const other = await createEvent("La pause avant le gâteau");
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
    viewport: { width: 1440, height: 1100 },
  });
  contexts.push(context);
  const editor = await context.newPage();
  await editor.goto("/parametres");
  await openSettingsSection(editor, "programme");
  await editor
    .getByRole("button", { name: `Modifier ${event.title}`, exact: true })
    .click();
  const form = editor.locator(".event-editor");
  const title = "Les anecdotes de la soirée";
  const question = "Qui a raconté notre meilleure anecdote ?";
  await form.locator("#event-title").fill(title);
  await form
    .locator("#event-description")
    .fill("On repense aux histoires de ce soir.");
  await form.getByLabel("Question du vote", { exact: true }).fill(question);
  await expect(
    form.getByRole("checkbox", { name: camille.guest.name, exact: true }),
  ).toHaveCount(0);
  await form.getByLabel("Question du vote", { exact: true }).blur();
  await expect
    .poll(async () => (await eventFrom(host, event.id)).vote?.question)
    .toBe(question);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const updated = await eventFrom(host, event.id);
  expect(updated.description).toBe("On repense aux histoires de ce soir.");
  expect(updated.vote?.question).toBe(question);
  expect(updated.vote?.status).toBe("open");
  expect(updated.vote?.participationCount).toBe(1);

  editor.once("dialog", (dialog) => dialog.accept());
  await editor
    .getByRole("button", { name: `Supprimer ${other.title}`, exact: true })
    .click();
  await expect(editor.getByText(other.title, { exact: true })).toHaveCount(0);
  eventIDs.splice(eventIDs.indexOf(other.id), 1);
  expect((await programme()).some((item) => item.id === other.id)).toBe(false);
  expect((await voteFrom(page.request, event.id)).myCandidateId).toBe(
    camille.guest.id,
  );
  expect((await voteFrom(host, event.id)).participationCount).toBe(1);
  await page.goto("/programme");
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article", { name: title, exact: true })
    .locator("summary")
    .filter({ hasText: /^Modifier mon vote$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: camille.guest.name, exact: true }),
  ).toBeChecked();
});

test("event autosave creates once and preserves edits typed during the first request", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
  });
  contexts.push(context);
  const editor = await context.newPage();
  let creates = 0;
  let releaseResponse: () => void = () => {};
  let notifyCreated: () => void = () => {};
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const created = new Promise<void>((resolve) => {
    notifyCreated = resolve;
  });
  await editor.route("**/api/admin/programme", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates++;
    const response = await route.fetch();
    const event = (await response.json()) as ProgrammeEvent;
    eventIDs.push(event.id);
    notifyCreated();
    await responseHeld;
    await route.fulfill({ response });
  });
  try {
    await editor.goto("/parametres?section=programme");
    await editor
      .getByRole("button", { name: "Ajouter un événement", exact: true })
      .click();
    await editor.getByRole("button", { name: /^Événement Un nom/ }).click();
    const form = editor.locator(".event-editor");
    await form.locator("#event-title").fill("Le premier titre");
    const description = form.locator("#event-description");
    await description.scrollIntoViewIfNeeded();
    const descriptionTop = await description.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    await description.click();
    await created;
    await expect(description).toBeFocused();
    expect(
      await description.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ).toBe(descriptionTop);
    await expect(form.locator("#event-title")).toBeEnabled();
    await form.locator("#event-title").fill("Le titre corrigé pendant l’envoi");
    await form
      .locator("#event-description")
      .fill("La description ajoutée pendant l’envoi.");
    await form.locator("#event-teaser").fill("Le dernier indice");
    releaseResponse();
    await editor.locator(".settings-back:visible").click();
    await expect(editor).toHaveURL(/\/parametres$/);
    await expect
      .poll(async () => {
        const event = (await programme()).find(
          (item) => item.id === eventIDs.at(-1),
        );
        return (
          event && {
            title: event.title,
            description: event.description,
            teaser: event.teaser,
          }
        );
      })
      .toEqual({
        title: "Le titre corrigé pendant l’envoi",
        description: "La description ajoutée pendant l’envoi.",
        teaser: "Le dernier indice",
      });
    expect(creates).toBe(1);
    await openSettingsSection(editor, "programme");
    await expect(form.locator("#event-title")).toHaveValue(
      "Le titre corrigé pendant l’envoi",
    );
    await expect(form.locator("#event-description")).toHaveValue(
      "La description ajoutée pendant l’envoi.",
    );
    await form.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(form).toHaveCount(0);
  } finally {
    releaseResponse();
  }
});

test("invalid event drafts remain editable and a failed autosave retries on blur", async ({
  browser,
}) => {
  const event = await createEvent("Le titre avant modification");
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "fr-CH",
  });
  contexts.push(context);
  const editor = await context.newPage();
  await editor.goto("/parametres?section=programme");
  await editor
    .getByRole("button", { name: `Modifier ${event.title}`, exact: true })
    .click();
  const form = editor.locator(".event-editor");
  const title = form.locator("#event-title");
  const error = editor
    .locator('[data-settings-screen="programme"]')
    .getByRole("alert");
  await title.fill("");
  await title.blur();
  await expect(error).toBeVisible();
  expect((await eventFrom(host, event.id)).title).toBe(event.title);
  editor.once("dialog", (dialog) => dialog.dismiss());
  await form.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(title).toHaveValue("");

  let updates = 0;
  await editor.route(`**/api/admin/programme/${event.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    updates++;
    if (updates === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Service temporarily unavailable." }),
      });
    }
    return route.continue();
  });
  await title.fill("Le titre conservé après une erreur");
  await title.blur();
  await expect.poll(() => updates).toBe(1);
  await expect(error).toBeVisible();
  await expect(title).toHaveValue("Le titre conservé après une erreur");
  expect((await eventFrom(host, event.id)).title).toBe(event.title);
  await title.focus();
  await title.blur();
  await expect
    .poll(async () => (await eventFrom(host, event.id)).title)
    .toBe("Le titre conservé après une erreur");
  await expect(error).toHaveCount(0);
  await expect(form).toBeVisible();
});
