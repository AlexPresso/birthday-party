import {
  test,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import type {
  Configuration,
  Party,
} from "../../frontend/src/features/party/contracts";
import { openSettingsSection } from "./settings-navigation";

const baseURL = "http://localhost:3300";
const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};
let host: APIRequestContext;

test.use({ locale: "fr-CH", viewport: { width: 390, height: 844 } });

function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

function fallbackInvitation(): Configuration["invitation"] {
  return {
    title: null,
    description: null,
    locales: {
      en: { title: null, description: null },
      fr: { title: null, description: null },
      de: { title: null, description: null },
      it: { title: null, description: null },
      es: { title: null, description: null },
    },
  };
}

async function configuration() {
  const response = await host.get("/api/admin/config");
  expect(response.status()).toBe(200);
  return response.json() as Promise<Configuration>;
}

async function saveConfiguration(value: Configuration) {
  const response = await host.put("/api/admin/config", { data: value });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(value);
}

test.beforeAll(async () => {
  const output = execFileSync(
    process.execPath,
    [
      "scripts/backend.mjs",
      "invite-admin",
      "--name",
      "Configuration Test Host",
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
  const accepted = await host.post("/api/invitations/accept", {
    data: { token: invitationToken(match[0]) },
  });
  expect(accepted.status()).toBe(200);
});

test.afterAll(async () => {
  await host?.dispose();
});

test("public configuration excludes upload settings and guests cannot read or change administration", async () => {
  const original = await configuration();
  const visitor = await request.newContext({
    baseURL,
    extraHTTPHeaders: mutationHeaders,
  });
  try {
    const publicResponse = await visitor.get("/api/config");
    expect(publicResponse.status()).toBe(200);
    expect(await publicResponse.json()).toEqual({
      age: original.age,
      invitation: original.invitation,
    });
    expect((await visitor.get("/api/admin/config")).status()).toBe(401);
    expect(
      (await visitor.put("/api/admin/config", { data: original })).status(),
    ).toBe(401);

    const created = await host.post("/api/admin/guests", {
      data: { name: "Configuration Access Guest" },
    });
    expect(created.status()).toBe(201);
    const { invitationUrl } = (await created.json()) as {
      invitationUrl: string;
    };
    const accepted = await visitor.post("/api/invitations/accept", {
      data: { token: invitationToken(invitationUrl) },
    });
    expect(accepted.status()).toBe(200);
    expect((await visitor.get("/api/admin/config")).status()).toBe(403);
    expect(
      (await visitor.put("/api/admin/config", { data: original })).status(),
    ).toBe(403);
    expect(await configuration()).toEqual(original);
  } finally {
    await visitor.dispose();
  }
});

test("admin configuration persists and updates invitation, header and upload limits without restarting", async ({
  page,
  context,
  browser,
}) => {
  const original = await configuration();
  const partyResponse = await host.get("/api/party");
  expect(partyResponse.status()).toBe(200);
  const originalParty = (await partyResponse.json()) as Party;
  const baseline = { ...original, invitation: fallbackInvitation() };
  const updated: Configuration = {
    ...baseline,
    age: 41,
    imageSizeMB: 2,
    videoSizeMB: 7,
    invitation: {
      ...fallbackInvitation(),
      title: "Configuration birthday title",
      description: "Details saved from the configuration form.",
      locales: {
        ...fallbackInvitation().locales,
        fr: {
          title: "Invitation d’anniversaire modifiée",
          description: "",
        },
      },
    },
  };
  try {
    await saveConfiguration(baseline);
    expect(
      (
        await host.patch("/api/admin/party", {
          data: { ...originalParty, title: "" },
        })
      ).status(),
    ).toBe(200);
    await context.addCookies((await host.storageState()).cookies);
    await page.goto("/parametres");
    const form = page.getByRole("form", { name: "Configuration", exact: true });
    async function saveCurrentSection(expected: Configuration) {
      const field = form
        .locator("input:visible, textarea:visible, select:visible")
        .first();
      await field.focus();
      await field.blur();
      await expect.poll(configuration).toEqual(expected);
      await expect(
        form.getByText("Enregistrement…", { exact: true }),
      ).toHaveCount(0);
    }

    await expect(
      page.getByRole("heading", { name: "La fête", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Invités et accès", exact: true }),
    ).toBeVisible();
    await openSettingsSection(page, "party");
    await form.getByLabel("Âge", { exact: true }).fill("41");
    const ageSaved = { ...baseline, age: updated.age };
    await saveCurrentSection(ageSaved);
    await page.reload();
    await expect(form.getByLabel("Âge", { exact: true })).toHaveValue("41");

    await openSettingsSection(page, "uploads");
    await form.getByLabel("Photos (Mio)", { exact: true }).fill("2");
    await form.getByLabel("Vidéos (Mio)", { exact: true }).fill("7");
    const uploadsSaved = {
      ...ageSaved,
      imageSizeMB: updated.imageSizeMB,
      videoSizeMB: updated.videoSizeMB,
    };
    await saveCurrentSection(uploadsSaved);
    await page.reload();
    await expect(form.getByLabel("Photos (Mio)", { exact: true })).toHaveValue(
      "2",
    );
    await expect(form.getByLabel("Vidéos (Mio)", { exact: true })).toHaveValue(
      "7",
    );

    await openSettingsSection(page, "invitation");
    const scope = form.getByLabel("Texte à modifier", { exact: true });
    await scope.selectOption("shared");
    const common = form.getByRole("group", {
      name: "Texte commun",
      exact: true,
    });
    await common
      .getByLabel("Affichage du titre", { exact: true })
      .selectOption("custom");
    await common
      .getByLabel("Titre", { exact: true })
      .fill(updated.invitation.title!);
    await common
      .getByLabel("Affichage de la description", { exact: true })
      .selectOption("custom");
    await common
      .getByLabel("Description", { exact: true })
      .fill(updated.invitation.description!);
    await scope.selectOption("fr");
    const french = form.getByRole("group", { name: "Français", exact: true });
    await french
      .getByLabel("Affichage du titre", { exact: true })
      .selectOption("custom");
    await french
      .getByLabel("Titre", { exact: true })
      .fill(updated.invitation.locales.fr.title!);
    await french
      .getByLabel("Affichage de la description", { exact: true })
      .selectOption("hidden");

    await scope.selectOption("shared");
    await expect(common.getByLabel("Titre", { exact: true })).toHaveValue(
      updated.invitation.title!,
    );
    await expect(common.getByLabel("Description", { exact: true })).toHaveValue(
      updated.invitation.description!,
    );
    await scope.selectOption("fr");
    await expect(french.getByLabel("Titre", { exact: true })).toHaveValue(
      updated.invitation.locales.fr.title!,
    );
    await expect(
      french.getByLabel("Affichage de la description", { exact: true }),
    ).toHaveValue("hidden");
    await saveCurrentSection(updated);
    await expect(page.locator(".brand strong")).toHaveText(
      updated.invitation.locales.fr.title!,
    );

    await page.reload();
    await scope.selectOption("shared");
    await expect(common.getByLabel("Titre", { exact: true })).toHaveValue(
      updated.invitation.title!,
    );
    await expect(common.getByLabel("Description", { exact: true })).toHaveValue(
      updated.invitation.description!,
    );
    await scope.selectOption("fr");
    await expect(french.getByLabel("Titre", { exact: true })).toHaveValue(
      updated.invitation.locales.fr.title!,
    );
    await expect(
      french.getByLabel("Affichage de la description", { exact: true }),
    ).toHaveValue("hidden");
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/configuration-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/configuration-desktop.png",
      fullPage: true,
    });

    const visitor = await browser.newContext({ baseURL, locale: "fr-CH" });
    try {
      const invitationPage = await visitor.newPage();
      await invitationPage.goto("/invitation");
      await expect(
        invitationPage.locator(".invitation-ring > span"),
      ).toHaveText("41");
      await expect(
        invitationPage.locator(".invitation-card > .brand strong"),
      ).toHaveText(updated.invitation.locales.fr.title!);
      await expect(invitationPage.locator(".invitation-intro")).toHaveCount(0);
    } finally {
      await visitor.close();
    }

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Médias", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/photos$/);
    expect(
      (await (await page.request.get("/api/photos")).json()).limits,
    ).toEqual({
      imageBytes: 2 * 1024 * 1024,
      videoBytes: 7 * 1024 * 1024,
    });
    await expect(page.locator(".photo-privacy")).toContainText(
      "Photos : JPEG, PNG, WebP, 2 Mo max.",
    );
    await expect(page.locator(".photo-privacy")).toContainText(
      "Vidéos : MP4, MOV, WebM, 7 Mo et 5 minutes max.",
    );
    await page.getByRole("link", { name: /^Profil:/ }).press("Enter");
    await expect(page).toHaveURL(/\/profil$/);
    expect(
      (await (await page.request.get("/api/profile")).json()).limits,
    ).toEqual({
      imageBytes: 2 * 1024 * 1024,
    });
    const editor = page.locator(".profile-photo-editor");
    await expect(editor).toContainText("JPEG, PNG ou WebP, jusqu’à 2 Mo.");
    let avatarUploads = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/profile/avatar") &&
        request.method() === "PUT"
      )
        avatarUploads++;
    });
    await editor.locator('input[type="file"]').setInputFiles({
      name: "oversized-profile.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(editor.getByRole("alert")).toHaveText(
      "La photo dépasse 2 Mo. Choisis un fichier plus petit.",
    );
    expect(avatarUploads).toBe(0);
  } finally {
    try {
      await saveConfiguration(original);
    } finally {
      expect(
        (
          await host.patch("/api/admin/party", { data: originalParty })
        ).status(),
      ).toBe(200);
    }
  }
});

test("pending autosaves retain newer edits and preserve settings from other pages", async ({
  page,
  context,
}) => {
  const original = await configuration();
  const updated = {
    ...original,
    age: original.age === 150 ? 149 : original.age + 1,
    imageSizeMB: 6,
    videoSizeMB: 9,
  };
  let releaseResponse!: () => void;
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestHeld = false;
  await page.route("**/api/admin/config", async (route) => {
    if (route.request().method() !== "PUT" || requestHeld)
      return route.continue();
    requestHeld = true;
    const response = await route.fetch();
    await responseHeld;
    await route.fulfill({ response });
  });
  try {
    await context.addCookies((await host.storageState()).cookies);
    await page.goto("/parametres?section=party");
    const form = page.getByRole("form", { name: "Configuration", exact: true });
    const age = form.getByLabel("Âge", { exact: true });
    const intermediateAge = updated.age === 150 ? 148 : updated.age + 1;
    await age.fill(String(intermediateAge));
    await age.blur();
    await expect.poll(() => requestHeld).toBe(true);
    await expect(age).toBeEnabled();
    await age.fill(String(updated.age));
    await age.blur();
    await page
      .getByRole("button", { name: "Retour aux paramètres", exact: true })
      .click();
    await expect(page).toHaveURL(/\/parametres\?section=party$/);
    await expect(age).toHaveValue(String(updated.age));

    releaseResponse();
    await expect(page).toHaveURL(/\/parametres$/);
    await expect.poll(configuration).toEqual({ ...original, age: updated.age });
    await openSettingsSection(page, "uploads");
    const imageLimit = form.getByLabel("Photos (Mio)", { exact: true });
    const videoLimit = form.getByLabel("Vidéos (Mio)", { exact: true });
    await imageLimit.fill(String(updated.imageSizeMB));
    await videoLimit.fill(String(updated.videoSizeMB));
    await videoLimit.blur();
    await expect.poll(configuration).toEqual(updated);
    await expect(form.getByRole("button", { name: /Enregistrer/ })).toHaveCount(
      0,
    );
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: "wait" });
    await saveConfiguration(original);
  }
});

test("invalid and failed autosaves retain the configuration draft when returning to settings", async ({
  page,
  context,
}) => {
  const original = await configuration();
  const nextAge = original.age === 150 ? 149 : original.age + 1;
  let rejectSave = true;
  let requests = 0;
  await page.route("**/api/admin/config", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    requests++;
    if (rejectSave) {
      return route.fulfill({
        status: 503,
        json: {
          code: "internal_error",
          error: "Save temporarily unavailable.",
        },
      });
    }
    return route.continue();
  });
  try {
    await context.addCookies((await host.storageState()).cookies);
    await page.goto("/parametres?section=party");
    const age = page.getByLabel("Âge", { exact: true });
    const back = page.getByRole("button", {
      name: "Retour aux paramètres",
      exact: true,
    });
    await age.fill("0");
    await back.click();
    await expect(page).toHaveURL(/\/parametres\?section=party$/);
    await expect(age).toHaveValue("0");
    expect(requests).toBe(0);

    await age.fill(String(nextAge));
    await age.blur();
    const form = page.getByRole("form", { name: "Configuration", exact: true });
    await expect(form.getByRole("alert")).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/parametres\?section=party$/);
    await expect(age).toHaveValue(String(nextAge));
    expect(await configuration()).toEqual(original);

    rejectSave = false;
    await back.click();
    await expect(page).toHaveURL(/\/parametres$/);
    await expect.poll(configuration).toEqual({ ...original, age: nextAge });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await saveConfiguration(original);
  }
});

test("localized invitation overrides preserve null fallbacks and explicit hidden text", async ({
  browser,
}) => {
  const original = await configuration();
  const invitation = fallbackInvitation();
  invitation.title = "Shared invitation title";
  invitation.description = "Shared invitation description";
  invitation.locales.fr.title = "Invitation française personnalisée";
  invitation.locales.fr.description = "Texte conservé dans sa langue.";
  invitation.locales.de.title = "";
  invitation.locales.de.description = "";
  invitation.locales.es.title = "Un título de invitación propio";
  const updated = { ...original, age: 42, invitation };
  try {
    await saveConfiguration(updated);
    for (const { locale, title, description } of [
      {
        locale: "fr-CH",
        title: invitation.locales.fr.title,
        description: invitation.locales.fr.description,
      },
      {
        locale: "en-GB",
        title: invitation.title,
        description: invitation.description,
      },
      { locale: "de-CH", title: "", description: "" },
      {
        locale: "it-CH",
        title: invitation.title,
        description: invitation.description,
      },
      {
        locale: "es-ES",
        title: invitation.locales.es.title,
        description: invitation.description,
      },
    ]) {
      const context = await browser.newContext({ baseURL, locale });
      try {
        const page = await context.newPage();
        await page.goto("/invitation");
        await expect(page.locator(".invitation-ring > span")).toHaveText("42");
        if (title) {
          await expect(
            page.locator(".invitation-card > .brand strong"),
          ).toHaveText(title);
        } else {
          await expect(
            page.locator(".invitation-card > .brand strong"),
          ).toHaveCount(0);
        }
        if (description) {
          await expect(page.locator(".invitation-intro")).toHaveText(
            description,
          );
          await expect(
            page.locator('meta[name="description"]'),
          ).toHaveAttribute("content", description);
        } else {
          await expect(page.locator(".invitation-intro")).toHaveCount(0);
          await expect(page.locator('meta[name="description"]')).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }

    const context = await browser.newContext({ baseURL, locale: "fr-CH" });
    try {
      const page = await context.newPage();
      const defaults = { ...updated, invitation: fallbackInvitation() };
      await saveConfiguration(defaults);
      await page.goto("/invitation");
      await expect(page.locator(".invitation-card > .brand strong")).toHaveText(
        "Les 42 ans",
      );
      await expect(page.locator(".invitation-intro")).toBeVisible();
      const hidden = {
        ...defaults,
        invitation: {
          ...defaults.invitation,
          title: "",
          description: "",
        },
      };
      await saveConfiguration(hidden);
      await page.reload();
      await expect(
        page.locator(".invitation-card > .brand strong"),
      ).toHaveCount(0);
      await expect(page.locator(".invitation-intro")).toHaveCount(0);
      await expect(page.locator('meta[name="description"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await saveConfiguration(original);
  }
});
