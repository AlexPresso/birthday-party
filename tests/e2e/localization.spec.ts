import { openSettingsSection } from "./settings-navigation";
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
    logout:
      "¿Cerrar sesión en este dispositivo? Necesitarás un nuevo enlace del organizador para volver.",
  },
] as const;

function tokenFrom(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

async function createGuest(name: string) {
  const response = await host.post("/api/admin/guests", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{
    guest: { id: number; name: string };
    invitationUrl: string;
  }>;
}

async function signIn(page: Page, invitationUrl: string) {
  const response = await page.request.post("/api/invitations/accept", {
    data: { token: tokenFrom(invitationUrl) },
    headers: mutationHeaders,
  });
  expect(response.status()).toBe(200);
}

test.beforeAll(async () => {
  if (!process.env.BIRTHDAY_E2E_DATA_DIR)
    throw new Error("The isolated E2E data directory is required.");
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", "Localization test host"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: process.env.BIRTHDAY_E2E_DATA_DIR,
        PUBLIC_URL: baseURL,
        COOKIE_SECURE: "false",
        PRINT_ADMIN_INVITATION: "false",
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
    data: { token: tokenFrom(match[0]) },
  });
  expect(accepted.status()).toBe(200);
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
          path: "test-results/invitation-mobile.png",
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
      const invitation = await createGuest(name);
      await signIn(page, invitation.invitationUrl);
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
      await expect(
        page.getByText(language.uploadError, { exact: true }),
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
      const dialog = page.waitForEvent("dialog");
      const click = page
        .getByRole("button", { name: language.signOut, exact: true })
        .click();
      const confirmation = await dialog;
      expect(confirmation.message()).toBe(language.logout);
      await confirmation.dismiss();
      await click;
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
  const invitation = await createGuest("Invité François");
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
    await page
      .getByLabel("Zeitzone der Feier", { exact: true })
      .fill("Invalid/Zone");
    await page
      .getByRole("button", { name: "Feier speichern", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Gib eine gültige Zeitzone ein" }),
    ).toHaveText("Gib eine gültige Zeitzone ein, zum Beispiel Europe/Zurich.");

    await openSettingsSection(page, "guests");
    await expect(
      page.getByLabel("Vorname des Gastes", { exact: true }),
    ).toBeVisible();
    const dialog = page.waitForEvent("dialog");
    const click = page
      .getByRole("button", {
        name: "Zugang für Invité François entfernen",
        exact: true,
      })
      .click();
    const confirmation = await dialog;
    expect(confirmation.message()).toBe(
      "Zugang für Invité François entfernen? Die Person wird auf allen Geräten abgemeldet. Ihre Fotos, Videos und Nachrichten bleiben erhalten.",
    );
    await confirmation.dismiss();
    await click;
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
    await expect(
      page.getByRole("button", {
        name: "Programmpunkt speichern",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/localization-host-german-mobile.png",
      fullPage: true,
      caret: "initial",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/localization-host-german-desktop.png",
      fullPage: true,
      caret: "initial",
    });
    await page
      .getByRole("button", { name: "Bearbeitung abbrechen", exact: true })
      .click();
    await expect(
      page.getByLabel("Titel des Programmpunkts", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
