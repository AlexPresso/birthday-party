import {
  expectSavedAnnouncement,
  openSettingsSection,
} from "./support/settings";
import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import {
  activate,
  baseURL,
  bootstrapHost,
  expectNoHorizontalOverflow,
  invite,
} from "./support/party";
import { acceptConfirmation, declineConfirmation } from "./support/confirm";
import {
  addAvatar,
  castVote,
  createVote,
  eventFrom,
  optionOf,
  programme,
  setVoteStatus,
  voteFrom,
  type ProgrammeEvent,
} from "./support/votes";

let host: APIRequestContext;
const eventIDs: number[] = [];
const contexts: BrowserContext[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

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

/** Opens the host's settings in a desktop window of its own. */
async function hostSettings(browser: Browser) {
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
  return editor;
}

async function startVoteEditor(page: Page, title: string, question: string) {
  await page
    .getByRole("button", { name: "Ajouter un événement", exact: true })
    .click();
  await page.getByRole("button", { name: /^Vote Les invités votent/ }).click();
  const form = page.locator(".event-editor");
  await form.locator("#event-title").fill(title);
  await form.getByLabel("Question du vote", { exact: true }).fill(question);
  return form;
}

/** The card of a saved event in the host's list. */
function eventCard(page: Page, title: string) {
  return page.locator(".admin-event-list > li").filter({ hasText: title });
}

test.beforeAll(async () => {
  host = await bootstrapHost("Programme Activities Test Host");
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

test("the host creates a vote for guests with selected candidates and profile photos, then opens and closes it", async ({
  browser,
  page,
}) => {
  const camille = await invite(host, "Camille — costume");
  const robin = await invite(host, "Robin — costume");
  const avatarURL = await addAvatar(page, camille);
  const editor = await hostSettings(browser);
  const title = "Les costumes de la soirée";
  const question = "Qui a le mieux réussi son déguisement ?";
  const form = await startVoteEditor(editor, title, question);
  await form
    .getByLabel("Détails", { exact: true })
    .fill("Un vote pour départager les déguisements.");
  await expect(
    form.getByRole("radio", { name: "Invités", exact: true }),
  ).toBeChecked();
  for (const guest of [camille.guest, robin.guest]) {
    await form.getByRole("checkbox", { name: guest.name, exact: true }).check();
  }
  await expect(form.locator(`img[src="${avatarURL}"]`)).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  await expectNoHorizontalOverflow(editor);
  await form.screenshot({
    path: test.info().outputPath("programme-vote-editor-desktop.png"),
  });
  await editor.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(editor);
  await editor.setViewportSize({ width: 1440, height: 1100 });
  await expect(
    form.getByRole("button", { name: "Enregistrer l’événement", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      (await programme(host, true)).some((event) => event.title === title),
    )
    .toBe(true);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const saved = (await programme(host, true)).find(
    (event) => event.title === title,
  )!;
  eventIDs.push(saved.id);
  expect(saved.type).toBe("vote");
  expect(saved.vote).toMatchObject({
    status: "draft",
    choices: "guests",
    allowSelfVote: false,
    allowWriteIns: false,
    myOptionId: null,
  });
  expect(saved.vote?.options.map((option) => option.guestId).sort()).toEqual(
    [camille.guest.id, robin.guest.id].sort(),
  );
  expect(saved.vote?.options.every((option) => option.votes === 0)).toBe(true);

  const card = eventCard(editor, title);
  await expect(card.getByText("Brouillon", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Ouvrir le vote", exact: true })
    .click();
  await acceptConfirmation(
    editor,
    "Ouvrir le vote ? Les choix et leurs règles ne pourront plus changer.",
  );
  await expect(
    card.getByRole("button", { name: "Fermer le vote", exact: true }),
  ).toBeVisible();
  expect((await voteFrom(host, saved.id, true)).status).toBe("open");
  // The source and the candidates are fixed once the vote has opened.
  await expect(form.getByRole("radio")).toHaveCount(0);
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await expect(
    form.getByText("Le vote a commencé. Tu peux encore corriger la question.", {
      exact: true,
    }),
  ).toBeVisible();
  await editor.screenshot({
    path: test.info().outputPath("programme-vote-admin-desktop.png"),
    fullPage: true,
  });
  await editor.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(editor);
  await editor.setViewportSize({ width: 1440, height: 1100 });

  // Closing is the last step: nothing is left to reveal.
  await card
    .getByRole("button", { name: "Fermer le vote", exact: true })
    .click();
  await acceptConfirmation(
    editor,
    "Fermer le vote ? Les invités ne pourront plus voter ni changer leur choix.",
  );
  await expect(card.getByText("Vote terminé", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /vote/i })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /révéler/i })).toHaveCount(0);
  expect((await voteFrom(host, saved.id, true)).status).toBe("closed");
  const closed = await eventFrom(host, saved.id, true);
  for (const status of ["revealed", "open", "draft"]) {
    const response = await host.post(
      `/api/admin/programme/${saved.id}/vote/state`,
      { data: { status, revision: closed.revision } },
    );
    expect(response.status(), status).toBeGreaterThanOrEqual(400);
  }
  await card.getByRole("link", { name: "Voir le vote", exact: true }).click();
  await expect(editor).toHaveURL(`/programme/${saved.id}`);
  await expect(
    editor.getByRole("heading", { level: 1, name: question, exact: true }),
  ).toBeVisible();
});

test("the host prepares a vote on custom choices and may let guests add theirs", async ({
  browser,
}) => {
  const editor = await hostSettings(browser);
  const title = "Le repas de minuit";
  const question = "Qu’est-ce qu’on mange à minuit ?";
  const form = await startVoteEditor(editor, title, question);
  const error = editor
    .locator('[data-settings-screen="programme"]')
    .getByRole("alert");
  await form.getByRole("radio", { name: "Choix libres", exact: true }).check();
  await expect(form.getByRole("checkbox")).toHaveCount(1);
  await expect(error).toHaveText(
    "Ajoute au moins 2 choix, ou laisse les invités en ajouter.",
  );

  const add = form.getByRole("button", {
    name: "Ajouter un choix",
    exact: true,
  });
  const choice = (row: number) =>
    form.getByLabel(`Choix ${row}`, { exact: true });
  await add.click();
  await expect(choice(1)).toBeFocused();
  await choice(1).fill("Pizza");
  await add.click();
  await choice(2).fill(" pizza ");
  await add.click();
  await choice(3).blur();
  await expect(error).toHaveText(
    "Remplis chaque choix ou retire les lignes vides.",
  );
  await form
    .getByRole("button", { name: "Retirer le choix 3", exact: true })
    .click();
  await expect(add).toBeFocused();
  await expect(error).toHaveText("Chaque choix doit être différent.");
  expect(
    (await programme(host, true)).some((event) => event.title === title),
  ).toBe(false);

  // The rows stay in the host's order although the server sorts by name.
  await choice(2).fill("Raclette");
  await add.click();
  await choice(3).fill("Burgers");
  await choice(3).blur();
  await expect
    .poll(async () =>
      (await programme(host, true))
        .find((event) => event.title === title)
        ?.vote?.options.map((option) => option.label),
    )
    .toEqual(["Burgers", "Pizza", "Raclette"]);
  await expect(error).toHaveCount(0);
  const saved = (await programme(host, true)).find(
    (event) => event.title === title,
  )!;
  eventIDs.push(saved.id);
  expect(saved.vote).toMatchObject({
    status: "draft",
    choices: "custom",
    allowSelfVote: false,
    allowWriteIns: false,
  });
  expect(
    saved.vote?.options.every(
      (option) =>
        option.guestId === null && option.avatarUrl === null && !option.writeIn,
    ),
  ).toBe(true);
  // The saved vote came back in another order: the rows do not move and the
  // editor reports neither unsaved changes nor a conflict.
  await expectSavedAnnouncement(editor, "Le programme est enregistré.");
  await expect(editor.locator(".programme-save-status")).toBeEmpty();
  await expect(choice(1)).toHaveValue("Pizza");
  await expect(choice(2)).toHaveValue("Raclette");
  await expect(choice(3)).toHaveValue("Burgers");
  await expect(
    form.getByRole("button", {
      name: "Enregistrer mon brouillon",
      exact: true,
    }),
  ).toHaveCount(0);
  let saves = 0;
  const countSave = (request: Request) => {
    if (request.method() === "PUT") saves++;
  };
  editor.on("request", countSave);
  await choice(1).focus();
  await choice(1).blur();
  await form.getByLabel("Question du vote", { exact: true }).focus();
  await form.getByLabel("Question du vote", { exact: true }).blur();
  // Long enough for an autosave to start, had the draft looked changed.
  await editor.waitForTimeout(300);
  editor.off("request", countSave);
  expect(saves).toBe(0);
  await expect(error).toHaveCount(0);

  await form
    .getByRole("checkbox", {
      name: "Les invités peuvent ajouter un choix",
      exact: true,
    })
    .check();
  await expect
    .poll(async () => (await voteFrom(host, saved.id, true)).allowWriteIns)
    .toBe(true);
  // With write-ins, a vote may start from a single choice.
  for (const row of [3, 2]) {
    await form
      .getByRole("button", { name: `Retirer le choix ${row}`, exact: true })
      .click();
  }
  await expect
    .poll(async () =>
      (await voteFrom(host, saved.id, true)).options.map(
        (option) => option.label,
      ),
    )
    .toEqual(["Pizza"]);
  await expect(error).toHaveCount(0);
  await expectNoHorizontalOverflow(editor);
  await form.screenshot({
    path: test.info().outputPath("programme-custom-vote-editor-desktop.png"),
  });
  await editor.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(editor);
  await editor.setViewportSize({ width: 1440, height: 1100 });

  const card = eventCard(editor, title);
  await card
    .getByRole("button", { name: "Ouvrir le vote", exact: true })
    .click();
  await acceptConfirmation(editor);
  await expect(
    card.getByRole("button", { name: "Fermer le vote", exact: true }),
  ).toBeVisible();
  await expect(choice(1)).toHaveCount(0);
  await expect(form.getByRole("radio")).toHaveCount(0);
  // The question can still be corrected; the choices stay as they were.
  await form
    .getByLabel("Question du vote", { exact: true })
    .fill("On mange quoi à minuit ?");
  await form.getByLabel("Question du vote", { exact: true }).blur();
  await expect
    .poll(async () => (await voteFrom(host, saved.id, true)).question)
    .toBe("On mange quoi à minuit ?");
  expect(await voteFrom(host, saved.id, true)).toMatchObject({
    status: "open",
    choices: "custom",
    allowWriteIns: true,
    options: [{ label: "Pizza", writeIn: false, votes: 0 }],
  });
});

test("guest changes update an open vote editor without reloading settings", async ({
  browser,
}) => {
  await createEvent("Les retrouvailles");
  const editor = await hostSettings(browser);
  await editor.goto("/programme");
  const manageProgramme = editor.getByRole("link", {
    name: "Gérer le programme",
    exact: true,
  });
  await expect(manageProgramme).toBeVisible();
  await expectNoHorizontalOverflow(editor);
  await editor.screenshot({
    path: test.info().outputPath("programme-admin-navigation-desktop.png"),
    fullPage: true,
  });
  await editor.setViewportSize({ width: 390, height: 844 });
  await expect(manageProgramme).toBeVisible();
  await expectNoHorizontalOverflow(editor);
  await editor.screenshot({
    path: test.info().outputPath("programme-admin-navigation-mobile.png"),
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
  expect(
    (await programme(host, true)).some((event) => event.title === title),
  ).toBe(false);

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
      (await programme(host, true)).some((event) => event.title === title),
    )
    .toBe(true);
  const saved = (await programme(host, true)).find(
    (event) => event.title === title,
  )!;
  eventIDs.push(saved.id);

  const robin = names[1];
  await openSettingsSection(editor, "guests");
  await editor
    .getByRole("button", { name: `Retirer l’accès de ${robin}`, exact: true })
    .click();
  await acceptConfirmation(editor);
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
  await editor
    .getByRole("button", {
      name: `Retirer l’accès de ${excluded}`,
      exact: true,
    })
    .click();
  await acceptConfirmation(editor);
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
    .poll(async () => (await voteFrom(host, saved.id, true)).options.length)
    .toBe(2);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const updated = await voteFrom(host, saved.id, true);
  expect(updated.question).toBe(question);
  expect(updated.options.map((option) => option.label).sort()).toEqual(
    [...names].sort(),
  );
});

test("editing a vote event and deleting another event preserves the ballots", async ({
  browser,
  page,
}) => {
  const camille = await invite(host, "Camille — souvenirs");
  const robin = await invite(host, "Robin — souvenirs");
  const voter = await invite(host, "Lou — souvenirs");
  await activate(page.request, voter.invitationUrl);
  const event = await createVote(host, {
    title: "Les souvenirs de la soirée",
    question: "Qui a raconté la meilleure anecdote ?",
    source: { candidates: [camille.guest, robin.guest] },
  });
  eventIDs.push(event.id);
  await setVoteStatus(host, event.id, "open");
  const choice = optionOf(
    await voteFrom(page.request, event.id),
    camille.guest.name,
  );
  expect((await castVote(page.request, event.id, choice.id)).status()).toBe(
    200,
  );
  const other = await createEvent("La pause avant le gâteau");
  const editor = await hostSettings(browser);
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
    .poll(async () => (await voteFrom(host, event.id, true)).question)
    .toBe(question);
  await expect(editor.getByText(title, { exact: true })).toBeVisible();
  const updated = await eventFrom(host, event.id, true);
  expect(updated.description).toBe("On repense aux histoires de ce soir.");
  expect(updated.vote).toMatchObject({ question, status: "open" });
  expect(optionOf(updated.vote!, camille.guest.name)).toMatchObject({
    id: choice.id,
    votes: 1,
  });
  await expect(
    eventCard(editor, title).getByText("Votes reçus : 1", { exact: true }),
  ).toBeVisible();

  await editor
    .getByRole("button", { name: `Supprimer ${other.title}`, exact: true })
    .click();
  await acceptConfirmation(editor);
  await expect(editor.getByText(other.title, { exact: true })).toHaveCount(0);
  eventIDs.splice(eventIDs.indexOf(other.id), 1);
  expect(
    (await programme(host, true)).some((item) => item.id === other.id),
  ).toBe(false);
  expect((await voteFrom(page.request, event.id)).myOptionId).toBe(choice.id);
  await page.goto("/programme");
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article", { name: title, exact: true })
    .getByRole("link", { name: "Voter", exact: true })
    .click();
  await expect(page).toHaveURL(`/programme/${event.id}`);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: camille.guest.name, exact: true }),
  ).toBeChecked();
  // Leave before the vote is deleted: its page would navigate during teardown.
  await page.locator(".activity-back").click();
  await expect(page).toHaveURL("/programme");
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
        const event = (await programme(host, true)).find(
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
  expect((await eventFrom(host, event.id, true)).title).toBe(event.title);
  await form.getByRole("button", { name: "Fermer", exact: true }).click();
  await declineConfirmation(editor);
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
  expect((await eventFrom(host, event.id, true)).title).toBe(event.title);
  await title.focus();
  await title.blur();
  await expect
    .poll(async () => (await eventFrom(host, event.id, true)).title)
    .toBe("Le titre conservé après une erreur");
  await expect(error).toHaveCount(0);
  await expect(form).toBeVisible();
});
