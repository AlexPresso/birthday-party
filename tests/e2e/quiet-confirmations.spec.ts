import { test, expect, type APIRequestContext } from "@playwright/test";
import { bootstrapHost, shareSession, signInGuest } from "./support/party";
import { canvasImage } from "./support/images";
import {
  expectSavedAnnouncement,
  openSettingsSection,
} from "./support/settings";
import { expectNoSuccessColour } from "./support/success-colour";
import { createVote, setVoteStatus } from "./support/votes";

// A finished action shows its result, never a green "saved" or "sent" line:
// the confirmation is a visually hidden status for screen readers.

let host: APIRequestContext;
let previousParty: unknown;
const eventIDs: number[] = [];
const entryIDs: number[] = [];
const guestIDs: number[] = [];

test.use({ viewport: { width: 390, height: 844 }, locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Quiet Confirmation Host");
  previousParty = await (await host.get("/api/party")).json();
});

test.afterEach(async ({ page }) => {
  // Leave the activity pages before their events are deleted.
  await page.goto("about:blank");
  for (const id of eventIDs.splice(0))
    expect((await host.delete(`/api/admin/programme/${id}`)).status()).toBe(
      204,
    );
  for (const id of entryIDs.splice(0))
    await host.delete(`/api/guestbook/${id}`);
  for (const id of guestIDs.splice(0))
    await host.delete(`/api/admin/guests/${id}`);
});

test.afterAll(async () => {
  if (previousParty)
    expect(
      (await host.patch("/api/admin/party", { data: previousParty })).status(),
    ).toBe(200);
  await host?.dispose();
});

function screenshot(name: string) {
  return {
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  } as const;
}

test("a guest's vote, message, question and photo show their result without a success message", async ({
  page,
}) => {
  const guest = await signInGuest(host, page, "Invitée Discrète");
  guestIDs.push(guest.id);

  const vote = await createVote(host, {
    title: "Le dessert de minuit",
    question: "Quel dessert pour minuit ?",
    source: { labels: ["Tarte au citron", "Mousse au chocolat"] },
  });
  eventIDs.push(vote.id);
  await setVoteStatus(host, vote.id, "open");
  await page.goto(`/programme/${vote.id}`);
  await page
    .getByRole("radio", { name: "Tarte au citron", exact: true })
    .check();
  await page.getByRole("button", { name: "Voter", exact: true }).click();
  await expect(
    page
      .locator(".vote-option")
      .filter({ hasText: "Tarte au citron" })
      .getByText("Ton vote", { exact: true }),
  ).toBeVisible();
  await expectSavedAnnouncement(
    page,
    "Ton vote pour Tarte au citron est enregistré.",
  );
  await expect(
    page.getByRole("button", { name: "Changer mon vote", exact: true }),
  ).toBeDisabled();
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("vote-after-voting"));

  await page.goto("/livre-d-or");
  const message = "Merci pour cette soirée, on recommence quand tu veux.";
  await page.getByLabel("Ton message", { exact: true }).fill(message);
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/guestbook") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Publier le message", exact: true })
    .click();
  entryIDs.push((await (await posted).json()).id);
  await expect(
    page.locator(".guestbook-entry").getByText(message, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Ton message", { exact: true })).toHaveValue("");
  await expectSavedAnnouncement(page, "Message publié.");
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("guestbook-after-posting"));

  const created = await host.post("/api/admin/programme", {
    data: {
      type: "questions",
      title: "Sans filtre",
      description: "",
      teaser: "",
      startsAt: null,
      unlockAt: null,
    },
  });
  expect(created.status()).toBe(201);
  const round = await created.json();
  eventIDs.push(round.id);
  await page.goto(`/programme/${round.id}`);
  const question = "Quel est ton meilleur souvenir de cette année ?";
  await page
    .getByRole("button", { name: "Poser une question", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Ta question anonyme", { exact: true }).fill(question);
  await sheet
    .getByRole("button", { name: "Envoyer la question", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.locator(".question-item").filter({ hasText: question }),
  ).toBeVisible();
  await expectSavedAnnouncement(page, "Ta question anonyme a été envoyée.");
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("questions-after-sending"));

  await page.goto("/profil");
  const panel = page.locator(".profile-panel");
  const image = await canvasImage(page, { width: 384, height: 256 });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile/avatar") &&
      response.request().method() === "PUT",
  );
  const photo = panel.getByRole("button", {
    name: "Photo de profil",
    exact: true,
  });
  const choose = panel.getByRole("menuitem", {
    name: "Choisir une photo",
    exact: true,
  });
  // The photo opens its menu only once the page is interactive.
  await expect(async () => {
    if (!(await choose.isVisible())) await photo.click();
    await expect(choose).toBeVisible({ timeout: 1000 });
  }).toPass();
  const chooser = page.waitForEvent("filechooser");
  await choose.click();
  await (await chooser).setFiles(image);
  const { avatarUrl } = (await (await saved).json()).guest;
  await expect(panel.locator(".avatar img")).toHaveAttribute("src", avatarUrl);
  await expect(photo).toBeEnabled();
  await expectSavedAnnouncement(page, "Photo de profil enregistrée.");
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("profile-after-photo"));
});

test("the host's settings confirm a category, a copied link and a save without a success message", async ({
  page,
  context,
}) => {
  await shareSession(context, host);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/parametres");

  // A created category shows in the list.
  await openSettingsSection(page, "categories");
  const categories = page.locator(".media-categories-admin");
  const name = `Photos discrètes ${Date.now()}`;
  await categories
    .getByLabel("Nom de la catégorie", { exact: true })
    .fill(name);
  await categories
    .getByRole("button", { name: "Créer la catégorie", exact: true })
    .click();
  await expect(
    categories.locator(".media-category-list").getByText(name, { exact: true }),
  ).toBeVisible();
  await expectSavedAnnouncement(categories, "Catégorie créée.");
  await expect(categories.getByRole("status")).toHaveCount(1);
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("categories-after-creating"));

  // The copy button confirms by itself, then goes back to its label.
  await openSettingsSection(page, "guests");
  await page
    .getByLabel("Prénom de l’invité", { exact: true })
    .fill("Invité Discret");
  const invited = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/guests") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Créer l’invitation", exact: true })
    .click();
  guestIDs.push((await (await invited).json()).guest.id);
  const result = page.locator(".invitation-result");
  const link = await result.getByLabel("Lien personnel").inputValue();
  await result
    .getByRole("button", { name: "Copier le lien", exact: true })
    .click();
  const copied = result.getByRole("button", {
    name: "Lien copié",
    exact: true,
  });
  await expect(copied).toBeVisible();
  await expect(result.getByRole("status")).toHaveText("Lien copié");
  await expect(result.getByRole("status")).toHaveClass("visually-hidden");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expectNoSuccessColour(page);
  await page.screenshot(screenshot("guests-after-copying"));
  await expect(
    result.getByRole("button", { name: "Copier le lien", exact: true }),
  ).toBeVisible();
  await expect(copied).toHaveCount(0);

  // A running save is a neutral line; a finished one shows nothing.
  await openSettingsSection(page, "party");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/party", async (route) => {
    if (route.request().method() === "PATCH") await gate;
    await route.continue();
  });
  const title = page.getByLabel("Nom de la fête", { exact: true });
  await title.fill("Une fête sans message vert");
  await title.blur();
  const form = page.locator('[data-settings-screen="party"]');
  await expect(
    form.getByText("Enregistrement…", { exact: true }),
  ).toBeVisible();
  await expectNoSuccessColour(page);
  release();
  await expectSavedAnnouncement(
    form,
    "Les infos de la fête sont enregistrées.",
  );
  await expect(form.getByText("Enregistrement…", { exact: true })).toHaveCount(
    0,
  );
  await expectNoSuccessColour(page);
});
