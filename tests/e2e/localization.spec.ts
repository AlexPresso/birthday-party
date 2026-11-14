import { openSettingsSection } from "./support/settings";
import {
  acceptConfirmation,
  confirmation,
  declineConfirmation,
} from "./support/confirm";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { activate, baseURL, bootstrapHost, invite } from "./support/party";

const unlockAt = new Date(
  Date.UTC(new Date().getUTCFullYear() + 1, 10, 23, 17),
).toISOString();
let host: APIRequestContext;
let eventId: number;

const languages = [
  {
    locale: "fr-CH",
    lang: "fr",
    title: "Anniversaire",
    welcome: "Bienvenue !",
    invalidInvitation:
      "Ce lien est invalide ou a expiré. Demande un nouveau lien à l’organisateur.",
    tabs: ["Programme", "Médias", "Livre d'or"],
    mediaInput: "Ajouter des médias",
    uploadDetails: "Détail des envois",
    uploadError:
      "Choisis une photo JPEG, PNG ou WebP, ou une vidéo MP4, MOV ou WebM. Convertis d’abord les fichiers HEIC en JPEG.",
    surprise: "Surprise",
    emptyProgramme: "Pas encore d'événements",
    refresh: "Actualiser le programme",
    message: "Ton message",
    anonymous: "Publier anonymement",
    publish: "Publier le message",
    settings: "Paramètres",
    profile: "Profil",
    signOut: "Se déconnecter",
    cancel: "Annuler",
    confirm: "Confirmer",
    logout:
      "Te déconnecter de cet appareil ? Il te faudra un nouveau lien de l’organisateur pour revenir.",
  },
  {
    locale: "en-GB",
    lang: "en",
    title: "Birthday party",
    welcome: "Welcome!",
    invalidInvitation:
      "This link is invalid or has expired. Ask the host for a new invitation.",
    tabs: ["Schedule", "Media", "Guestbook"],
    mediaInput: "Add media",
    uploadDetails: "Upload details",
    uploadError:
      "Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video. Convert HEIC files to JPEG first.",
    surprise: "Surprise",
    emptyProgramme: "No events yet",
    refresh: "Refresh schedule",
    message: "Your message",
    anonymous: "Post anonymously",
    publish: "Post message",
    settings: "Settings",
    profile: "Profile",
    signOut: "Sign out",
    cancel: "Cancel",
    confirm: "Confirm",
    logout:
      "Sign out of this device? You’ll need a new link from the host to get back in.",
  },
  {
    locale: "de-CH",
    lang: "de",
    title: "Geburtstagsfeier",
    welcome: "Willkommen!",
    invalidInvitation:
      "Dieser Link ist ungültig oder abgelaufen. Bitte den Gastgeber um eine neue Einladung.",
    tabs: ["Programm", "Medien", "Gästebuch"],
    mediaInput: "Medien hinzufügen",
    uploadDetails: "Upload-Details",
    uploadError:
      "Wähle ein Foto im Format JPEG, PNG oder WebP oder ein Video im Format MP4, MOV oder WebM. Wandle HEIC-Dateien zuerst in JPEG um.",
    surprise: "Überraschung",
    emptyProgramme: "Noch keine Programmpunkte",
    refresh: "Programm aktualisieren",
    message: "Deine Nachricht",
    anonymous: "Anonym veröffentlichen",
    publish: "Nachricht veröffentlichen",
    settings: "Einstellungen",
    profile: "Profil",
    signOut: "Abmelden",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    logout:
      "Von diesem Gerät abmelden? Du brauchst danach einen neuen Link vom Gastgeber, um dich wieder anzumelden.",
  },
  {
    locale: "it-CH",
    lang: "it",
    title: "Festa di compleanno",
    welcome: "Benvenuto!",
    invalidInvitation:
      "Questo link non è valido o è scaduto. Chiedi un nuovo invito a chi organizza.",
    tabs: ["Programma", "Media", "Dediche"],
    mediaInput: "Aggiungi foto e video",
    uploadDetails: "Dettagli degli invii",
    uploadError:
      "Scegli una foto JPEG, PNG o WebP, oppure un video MP4, MOV o WebM. Converti prima i file HEIC in JPEG.",
    surprise: "Sorpresa",
    emptyProgramme: "Non ci sono ancora eventi",
    refresh: "Aggiorna il programma",
    message: "Il tuo messaggio",
    anonymous: "Pubblica in forma anonima",
    publish: "Pubblica il messaggio",
    settings: "Impostazioni",
    profile: "Profilo",
    signOut: "Esci",
    cancel: "Annulla",
    confirm: "Conferma",
    logout:
      "Uscire da questo dispositivo? Per rientrare ti servirà un nuovo link dell’organizzatore.",
  },
  {
    locale: "es-ES",
    lang: "es",
    title: "Fiesta de cumpleaños",
    welcome: "¡Te damos la bienvenida!",
    invalidInvitation:
      "Este enlace no es válido o ha caducado. Pide una nueva invitación a quien organiza.",
    tabs: ["Programa", "Multimedia", "Dedicatorias"],
    mediaInput: "Añadir fotos y vídeos",
    uploadDetails: "Detalles de los envíos",
    uploadError:
      "Elige una foto JPEG, PNG o WebP, o un vídeo MP4, MOV o WebM. Convierte primero los archivos HEIC a JPEG.",
    surprise: "Sorpresa",
    emptyProgramme: "Todavía no hay eventos",
    refresh: "Actualizar el programa",
    message: "Tu mensaje",
    anonymous: "Publicar de forma anónima",
    publish: "Publicar mensaje",
    settings: "Ajustes",
    profile: "Perfil",
    signOut: "Cerrar sesión",
    cancel: "Cancelar",
    confirm: "Confirmar",
    logout:
      "¿Cerrar sesión en este dispositivo? Necesitarás un nuevo enlace del organizador para volver.",
  },
] as const;

test.beforeAll(async () => {
  host = await bootstrapHost("Localization test host");
  const event = await host.post("/api/admin/programme", {
    data: {
      title: "LOCALIZATION-HIDDEN-TITLE",
      description: "LOCALIZATION-HIDDEN-DETAILS",
      teaser: "",
      startsAt: null,
      unlockAt,
    },
  });
  expect(event.status()).toBe(201);
  eventId = (await event.json()).id;
});

test.afterAll(async () => {
  if (eventId) await host.delete(`/api/admin/programme/${eventId}`);
  await host?.dispose();
});

for (const language of languages) {
  test.describe(language.locale, () => {
    test.use({
      locale: language.locale,
      viewport: { width: 390, height: 844 },
    });

    test("uses the phone language for server HTML, metadata and invitation errors", async ({
      page,
    }) => {
      const response = await page.goto("/invitation");
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(html).toMatch(new RegExp(`<html[^>]*lang="${language.lang}"`));
      expect(html).toContain(language.welcome);
      await expect(page.locator("html")).toHaveAttribute("lang", language.lang);
      await expect(page).toHaveTitle(language.title);
      await expect(
        page.getByRole("heading", { name: language.welcome, exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".invitation-card > .brand strong"),
      ).toHaveCount(0);
      await expect(page.locator(".invitation-intro")).toHaveCount(0);
      await expect(page.locator('meta[name="description"]')).toHaveCount(0);
      if (language.lang === "fr") {
        await page.screenshot({
          path: test.info().outputPath("invitation-mobile.png"),
          fullPage: true,
          caret: "initial",
        });
      }

      await page.goto("about:blank");
      const invalidResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/invitations/preview"),
      );
      await page.goto("/invitation#token=invalid");
      const invalid = await invalidResponse;
      expect(invalid.status()).toBe(401);
      expect((await invalid.json()).code).toBe("invalid_invitation");
      await expect(
        page.getByRole("alert").filter({ hasText: language.invalidInvitation }),
      ).toHaveText(language.invalidInvitation);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
    });

    test("translates the tabs, upload errors, programme and profile while preserving guest content", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const name = `Invité Élise ${language.lang}`;
      const invitation = await invite(host, name);
      await activate(page.request, invitation.invitationUrl);
      await page.goto("/photos");
      const navigation = page.getByRole("navigation");
      const labels = [...language.tabs, `${language.profile}: ${name}`];
      await expect(navigation.getByRole("link")).toHaveCount(labels.length);
      for (const [index, label] of labels.entries()) {
        await expect(navigation.getByRole("link").nth(index)).toHaveAttribute(
          "aria-label",
          label,
        );
      }
      await expect(
        page.getByRole("link", { name: language.settings, exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("lang", language.lang);
      const fileChooser = page.waitForEvent("filechooser");
      await page.locator("button.upload-button").click();
      await (
        await fileChooser
      ).setFiles({
        name: "not-media.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Upload validation fixture"),
      });
      // The pill reports the failure; each file's reason sits in its details.
      const queue = page.locator(".upload-queue");
      await expect(queue).toBeVisible();
      await expect(queue).toHaveAttribute("data-state", "error");
      await queue
        .getByRole("button", { name: language.uploadDetails, exact: true })
        .click();
      const details = page.getByRole("dialog", {
        name: language.uploadDetails,
        exact: true,
      });
      await expect(
        details.getByText(language.uploadError, { exact: true }),
      ).toBeVisible();

      if (language.lang === "de") {
        const failedUpload = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/photos") &&
            response.request().method() === "POST",
        );
        await page
          .getByLabel(language.mediaInput, { exact: true })
          .setInputFiles({
            name: "broken.png",
            mimeType: "image/png",
            buffer: Buffer.from("Invalid PNG content"),
          });
        const failure = await failedUpload;
        expect(failure.status()).toBe(415);
        expect((await failure.json()).code).toBe("unsupported_photo_type");
        await expect(
          page.getByText(
            "Wähle ein Foto im Format JPEG, PNG oder WebP oder ein Video im Format MP4, MOV oder WebM.",
            {
              exact: true,
            },
          ),
        ).toBeVisible();
      }

      // The details are modal: leave them before using the dock.
      await page.keyboard.press("Escape");
      await expect(details).toHaveCount(0);
      await navigation
        .getByRole("link", { name: language.tabs[0], exact: true })
        .press("Enter");
      const surprise = page.locator("article").filter({
        has: page.getByRole("heading", {
          name: language.surprise,
          exact: true,
        }),
      });
      await expect(surprise).toBeVisible();
      await expect(page.locator("body")).not.toContainText(
        "LOCALIZATION-HIDDEN",
      );
      const payload = await (await page.request.get("/api/programme")).json();
      const hidden = payload.items.find(
        (event: { id: number }) => event.id === eventId,
      );
      expect(hidden).toMatchObject({
        title: "",
        description: "",
        locked: true,
      });
      if (language.lang === "de") {
        await expect(surprise).toContainText("23. November");
        await expect(surprise).toContainText("18:00");
      }

      // Exercise the refreshed empty state without changing another test's events.
      await page.route("**/api/programme", (route) =>
        route.fulfill({ json: { items: [] } }),
      );
      await page.goto("/programme");
      await expect(
        page.getByRole("heading", {
          name: language.emptyProgramme,
          exact: true,
        }),
      ).toBeVisible();

      await navigation
        .getByRole("link", { name: language.tabs[2], exact: true })
        .click();
      const message = `Un souvenir écrit en français, gardé tel quel (${language.lang}).`;
      const anonymous = page.getByRole("checkbox", {
        name: language.anonymous,
        exact: true,
      });
      await expect(anonymous).toBeVisible();
      await expect(anonymous).not.toBeChecked();
      await page.getByLabel(language.message, { exact: true }).fill(message);
      await page
        .getByRole("button", { name: language.publish, exact: true })
        .click();
      const entry = page.locator("article").filter({ hasText: message });
      await expect(entry.getByText(message, { exact: true })).toBeVisible();
      await expect(entry.getByText(name, { exact: true })).toBeVisible();

      await page
        .getByRole("link", {
          name: `${language.profile}: ${name}`,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/profil$/);
      await expect(
        page.getByRole("heading", { name: language.profile, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: language.signOut, exact: true })
        .click();
      for (const name of [language.cancel, language.confirm]) {
        await expect(
          confirmation(page).getByRole("button", { name, exact: true }),
        ).toBeVisible();
      }
      await declineConfirmation(page, language.logout);
      expect((await page.request.get("/api/session")).status()).toBe(200);
      await page.setViewportSize({ width: 320, height: 740 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      expect(errors).toEqual([]);
    });
  });
}

test("falls back to English when the phone language is unsupported", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL, locale: "ja-JP" });
  try {
    const page = await context.newPage();
    const response = await page.goto("/invitation");
    expect(await response!.text()).toMatch(/<html[^>]*lang="en"/);
    await expect(page).toHaveTitle("Birthday party");
    await expect(
      page.getByRole("heading", { name: "Welcome!", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("translates host forms and confirmation dialogs in German", async ({
  browser,
}) => {
  const invitation = await invite(host, "Invité François");
  const context = await browser.newContext({
    baseURL,
    storageState: await host.storageState(),
    locale: "de-CH",
    viewport: { width: 390, height: 844 },
    timezoneId: "Europe/Zurich",
  });
  try {
    const page = await context.newPage();
    await page.goto("/parametres");
    await openSettingsSection(page, "party");
    await expect(page.locator(".settings-back:visible")).toHaveAccessibleName(
      "Zurück zu den Einstellungen",
    );
    await expect(
      page.getByLabel("Name der Feier", { exact: true }),
    ).toBeVisible();
    // Settings save when a field loses focus; there is no save button.
    const timezone = page.getByLabel("Zeitzone der Feier", { exact: true });
    const savedTimezone = await timezone.inputValue();
    await timezone.fill("Invalid/Zone");
    await timezone.blur();
    const timezoneError = page
      .getByRole("alert")
      .filter({ hasText: "Gib eine gültige Zeitzone ein" });
    await expect(timezoneError).toHaveText(
      "Gib eine gültige Zeitzone ein, zum Beispiel Europe/Zurich.",
    );
    // An invalid draft keeps the editor open, so restore it before leaving.
    await timezone.fill(savedTimezone);
    await timezone.blur();
    await expect(timezoneError).toHaveCount(0);

    await openSettingsSection(page, "guests");
    await expect(
      page.getByLabel("Vorname des Gastes", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Zugang für Invité François entfernen",
        exact: true,
      })
      .click();
    await declineConfirmation(
      page,
      "Zugang für Invité François entfernen? Die Person wird auf allen Geräten abgemeldet. Ihre Fotos, Videos und Nachrichten bleiben erhalten.",
    );
    const guests = await (await host.get("/api/admin/guests")).json();
    expect(
      guests.items.find(
        (guest: { id: number }) => guest.id === invitation.guest.id,
      ).active,
    ).toBe(true);

    await openSettingsSection(page, "programme");
    await page
      .getByRole("button", { name: "Programmpunkt hinzufügen", exact: true })
      .click();
    await page.getByRole("button", { name: /^Programmpunkt Ein Name/ }).click();
    await expect(
      page.getByLabel("Titel des Programmpunkts", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Hinweis vor der Freigabe", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath("localization-host-german-mobile.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: test.info().outputPath("localization-host-german-desktop.png"),
      fullPage: true,
      caret: "initial",
    });
    // An untitled draft cannot be saved: closing it asks before discarding.
    const teaser = page.getByLabel("Hinweis vor der Freigabe", { exact: true });
    await teaser.fill("Bald mehr");
    await teaser.blur();
    await expect(
      page
        .locator('[data-settings-screen="programme"]')
        .getByRole("alert")
        .filter({ hasText: "Gib einen Titel" }),
    ).toBeVisible();
    const close = page.getByRole("button", { name: "Schließen", exact: true });
    await close.click();
    await declineConfirmation(page, "Ungespeicherte Änderungen verwerfen?");
    await expect(
      page.getByLabel("Hinweis vor der Freigabe", { exact: true }),
    ).toHaveValue("Bald mehr");
    await close.click();
    await acceptConfirmation(page, "Ungespeicherte Änderungen verwerfen?");
    await expect(
      page.getByLabel("Titel des Programmpunkts", { exact: true }),
    ).toHaveCount(0);
    const events = await (await host.get("/api/admin/programme")).json();
    expect(
      events.items.some(
        (event: { teaser: string }) => event.teaser === "Bald mehr",
      ),
    ).toBe(false);
  } finally {
    await context.close();
  }
});
