import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  baseURL,
  bootstrapHost,
  invitationToken,
  mutationHeaders,
} from "./support/party";
import { openSettingsSection } from "./support/settings";
import { acceptConfirmation } from "./support/confirm";

let host: APIRequestContext;

test.beforeAll(async () => {
  host = await bootstrapHost("Question Test Host");
});

test.afterAll(async () => {
  await host?.dispose();
});
test.use({ locale: "fr-CH", viewport: { width: 390, height: 844 } });

test("the activity page preserves anonymous drafts, live votes and the host's two jokers across desktop and mobile", async ({
  page,
  browser,
}) => {
  const created = await host.post("/api/admin/guests", {
    data: { name: "Anonymous Question Guest" },
  });
  expect(created.status()).toBe(201);
  const invitation = await created.json();
  expect(
    (
      await page.request.post("/api/invitations/accept", {
        headers: mutationHeaders,
        data: { token: invitationToken(invitation.invitationUrl) },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({
    storageState: await host.storageState(),
    baseURL,
    locale: "fr-CH",
    viewport: { width: 1440, height: 1000 },
  });
  let eventId: number | undefined;
  try {
    const editor = await context.newPage();
    await editor.goto("/parametres");
    await openSettingsSection(editor, "programme");
    await editor
      .getByRole("button", { name: "Ajouter un événement", exact: true })
      .click();
    await editor.getByRole("button", { name: /^Sans filtre/ }).click();
    await expect(editor.locator("#event-title")).toHaveValue("Sans filtre");
    const saved = editor.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/programme") &&
        response.request().method() === "POST",
    );
    await editor.getByLabel("Détails", { exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    eventId = (await response.json()).id;
    const activityURL = `/programme/${eventId}`;
    const roundURL = `/api/programme/${eventId}/questions`;
    await editor
      .getByLabel("Détails", { exact: true })
      .fill("Les réponses se donnent à l’oral.");
    const updateURL = `**/api/admin/programme/${eventId}`;
    await editor.route(updateURL, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "internal_error",
            error: "Temporary test failure",
          }),
        });
      } else await route.continue();
    });
    const activityLink = editor
      .locator(".programme-admin-events > li")
      .filter({ hasText: "Sans filtre" })
      .getByRole("link", { name: "Voir les questions" });
    await activityLink.click();
    await expect(editor.locator(".error-notice[role=alert]")).toBeVisible();
    await expect(editor).toHaveURL(/\/parametres\?section=programme$/);
    await expect(editor.getByLabel("Détails", { exact: true })).toHaveValue(
      "Les réponses se donnent à l’oral.",
    );
    await editor.unroute(updateURL);
    await editor
      .locator(".programme-admin-events > li")
      .filter({ hasText: "Sans filtre" })
      .getByRole("link", { name: "Voir les questions" })
      .click();
    await expect(editor).toHaveURL(activityURL);
    await expect(editor.locator(".question-description")).toHaveText(
      "Les réponses se donnent à l’oral.",
    );
    await expect(
      editor.getByText("Caché jusqu’à l’ouverture des questions."),
    ).toBeVisible();
    await page.goto(activityURL);
    await expect(
      page.getByRole("heading", { name: "Cette page n’existe pas." }),
    ).toBeVisible();
    await page.goto("/programme");
    await expect(
      page.getByRole("heading", { name: "Sans filtre", exact: true }),
    ).toHaveCount(0);
    await editor
      .getByRole("button", { name: "Ouvrir les questions", exact: true })
      .click();
    await page.getByRole("link", { name: "Voir les questions" }).click();
    await expect(page).toHaveURL(activityURL);
    await expect(
      page.locator('.navigation a[href="/programme"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText("2 / 2 jokers restants", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fermer les questions", exact: true }),
    ).toHaveCount(0);

    const launch = page.getByRole("button", {
      name: "Poser une question",
      exact: true,
    });
    const sheet = page.getByRole("dialog");
    const draft = "Brouillon conservé pendant les changements d’écran";
    await launch.click();
    await sheet.getByLabel("Ta question anonyme", { exact: true }).fill(draft);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(launch).toBeFocused();
    await launch.click();
    await expect(
      sheet.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue(draft);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue(draft);
    await page.setViewportSize({ width: 390, height: 844 });
    await launch.click();
    await expect(
      sheet.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue(draft);
    await page.keyboard.press("Escape");

    const bodies = [
      "Quel est ton plus gros mensonge ?",
      "Quel est ton souvenir le plus gênant ?",
      "Quelle surprise gardais-tu pour ce soir ?",
    ];
    let failOnce = true;
    await page.route(`**${roundURL}`, async (route) => {
      if (failOnce && route.request().method() === "POST") {
        failOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "internal_error",
            error: "Temporary test failure",
          }),
        });
      } else await route.continue();
    });
    for (const [index, body] of bodies.entries()) {
      await launch.click();
      await sheet.getByLabel("Ta question anonyme", { exact: true }).fill(body);
      await sheet
        .getByRole("button", { name: "Envoyer la question", exact: true })
        .click();
      if (index === 0) {
        await expect(sheet.getByRole("alert")).toBeVisible();
        await expect(
          sheet.getByLabel("Ta question anonyme", { exact: true }),
        ).toHaveValue(body);
        await sheet
          .getByRole("button", { name: "Envoyer la question", exact: true })
          .click();
      }
      await expect(sheet).toHaveCount(0);
      await expect(
        page.locator(".question-item").filter({ hasText: body }),
      ).toBeVisible();
      await expect(launch).toBeFocused();
    }
    await expect(editor.locator(".question-item")).toHaveCount(3);
    await expect(page.locator(".question-list")).not.toContainText(
      invitation.guest.name,
    );
    const promoted = page
      .locator(".question-item")
      .filter({ hasText: bodies[1] });
    await promoted
      .getByRole("button", { name: "Voter pour cette question", exact: true })
      .click();
    await expect(page.locator(".question-item").first()).toContainText(
      bodies[1],
    );
    await expect(editor.locator(".question-item").first()).toContainText(
      bodies[1],
    );
    await expect(promoted.locator(".question-upvote")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await promoted
      .getByRole("button", { name: "Retirer ton vote", exact: true })
      .click();
    await expect(promoted.locator(".question-upvote")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await promoted
      .getByRole("button", { name: "Voter pour cette question", exact: true })
      .click();
    await expect(promoted.locator(".question-upvote")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.reload();
    await expect(promoted.locator(".question-upvote")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(promoted.locator(".question-upvote")).toContainText("1");
    for (const current of [page, editor]) {
      for (const width of [320, 768, 1024, 1920]) {
        await current.setViewportSize({ width, height: 900 });
        expect(
          await current.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    await editor.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: test.info().outputPath("questions-guest.png"),
      fullPage: true,
    });
    await editor.screenshot({
      path: test.info().outputPath("questions-host-desktop.png"),
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await launch.click();
    await sheet
      .getByLabel("Ta question anonyme", { exact: true })
      .fill("Une autre question en cours de rédaction");
    await page.screenshot({
      path: test.info().outputPath("questions-sheet.png"),
      fullPage: true,
    });
    await editor
      .getByLabel("Ta question anonyme", { exact: true })
      .fill("Host draft stays during live updates");
    for (const body of bodies.slice(0, 2)) {
      const card = editor.locator(".question-item").filter({ hasText: body });
      await card
        .getByRole("button", { name: "Utiliser un joker", exact: true })
        .click();
      await acceptConfirmation(editor);
      await expect(card).toHaveCount(0);
    }
    await expect(
      editor.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue("Host draft stays during live updates");
    await expect(
      sheet.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue("Une autre question en cours de rédaction");
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("0 / 2 jokers restants", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Jokers", exact: true }).click();
    await expect(page.locator(".question-item")).toHaveCount(2);
    await expect(page.getByText("Joker utilisé", { exact: true })).toHaveCount(
      2,
    );
    await expect(page.locator(".question-upvote").first()).toBeDisabled();
    const remaining = editor
      .locator(".question-item")
      .filter({ hasText: bodies[2] });
    await expect(
      remaining.getByRole("button", { name: "Utiliser un joker", exact: true }),
    ).toBeDisabled();
    await remaining
      .getByRole("button", { name: "Répondu", exact: true })
      .click();
    await expect(editor.getByRole("tabpanel")).toBeFocused();
    await page.getByRole("tab", { name: "Répondues", exact: true }).click();
    await expect(page.locator(".question-item")).toHaveCount(1);
    await expect(page.locator(".question-item")).toContainText(bodies[2]);
    await expect(page.getByText("Répondu", { exact: true })).toBeVisible();
    await page
      .getByRole("tab", { name: "Répondues", exact: true })
      .press("Home");
    await expect(
      page.getByRole("tab", { name: "À répondre", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("Toutes les questions ont été traitées."),
    ).toBeVisible();

    await launch.click();
    await editor
      .getByRole("button", { name: "Fermer les questions", exact: true })
      .click();
    await acceptConfirmation(editor);
    await expect(
      sheet.getByLabel("Ta question anonyme", { exact: true }),
    ).toBeDisabled();
    await expect(
      sheet.getByLabel("Ta question anonyme", { exact: true }),
    ).toHaveValue("Une autre question en cours de rédaction");
    await sheet
      .getByRole("button", { name: "Fermer le formulaire", exact: true })
      .click();
    await expect(
      page.getByText("L’envoi des questions et les votes sont fermés.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(launch).toHaveCount(0);
    await page.locator(".question-back").click();
    await expect(page).toHaveURL("/programme");
    await page.goBack();
    await expect(page).toHaveURL(activityURL);
    await expect(
      page.getByText("0 / 2 jokers restants", { exact: true }),
    ).toBeVisible();
    expect(
      (await host.delete(`/api/admin/programme/${eventId}`)).status(),
    ).toBe(204);
    eventId = undefined;
    await expect(page).toHaveURL("/programme");
  } finally {
    await context.close();
    if (eventId)
      expect(
        (await host.delete(`/api/admin/programme/${eventId}`)).status(),
      ).toBe(204);
  }
});

test("direct activity links respect authentication and scheduled availability", async ({
  page,
}) => {
  const created = await host.post("/api/admin/programme", {
    data: {
      type: "questions",
      title: "Private scheduled questions",
      description: "Hidden activity description",
      teaser: "Scheduled activity",
      startsAt: null,
      unlockAt: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  try {
    await page.goto(`/programme/${event.id}`);
    await expect(page).toHaveURL("/invitation");
    const invitation = await (
      await host.post("/api/admin/guests", {
        data: { name: "Scheduled Question Guest" },
      })
    ).json();
    expect(
      (
        await page.request.post("/api/invitations/accept", {
          headers: mutationHeaders,
          data: { token: invitationToken(invitation.invitationUrl) },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await host.post(`/api/admin/programme/${event.id}/questions/state`, {
          data: { status: "open", revision: event.revision },
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/programme/${event.id}`);
    await expect(page).toHaveURL("/programme");
    await expect(page.getByText("Hidden activity description")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Voir les questions" }),
    ).toHaveCount(0);
    expect(
      (await page.request.get(`/api/programme/${event.id}/questions`)).status(),
    ).toBe(404);
    await page.goto("/programme/not-an-id");
    await expect(
      page.getByRole("heading", { name: "Cette page n’existe pas." }),
    ).toBeVisible();
  } finally {
    expect(
      (await host.delete(`/api/admin/programme/${event.id}`)).status(),
    ).toBe(204);
  }
});
