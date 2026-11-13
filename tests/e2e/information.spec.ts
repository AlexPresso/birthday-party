import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  baseURL,
  bootstrapHost,
  expectNoHorizontalOverflow,
  shareSession,
  signInGuest,
} from "./support/party";
import { openSettingsSection } from "./support/settings";
import { acceptConfirmation } from "./support/confirm";

type InformationTab = { title: string; body: string };
type AdminInformation = {
  enabled: boolean;
  revision: number;
  tabs: InformationTab[];
};

const phone = { width: 390, height: 844 };
const useful: InformationTab = {
  title: "Utiles",
  body: [
    "Rendez-vous le 14.11.2026, 18:00 - 19:30.",
    "",
    "Plan : https://example.com/plan.",
    "Écris à lea@example.com ou appelle le +41 79 123 45 67.",
  ].join("\n"),
};
const sleeping: InformationTab = {
  title: "Dormir",
  body: `Hôtel du Lac\nwww.example.org/hotel\n${"Trèslongmotsansespace".repeat(8)}`,
};

let host: APIRequestContext;

test.use({ viewport: phone, locale: "fr-CH" });

async function adminInformation(): Promise<AdminInformation> {
  const response = await host.get("/api/admin/information");
  expect(response.status()).toBe(200);
  return response.json();
}

async function saveInformation(enabled: boolean, tabs: InformationTab[]) {
  const { revision } = await adminInformation();
  const response = await host.put("/api/admin/information", {
    data: { revision, enabled, tabs },
  });
  expect(response.status()).toBe(200);
}

test.beforeAll(async () => {
  host = await bootstrapHost("Information Test Host");
});

test.beforeEach(async () => {
  await saveInformation(false, []);
});

test.afterEach(async () => {
  // The browser suite shares one disposable database across its specifications.
  await saveInformation(false, []);
});

test.afterAll(async () => {
  await host?.dispose();
});

type Save = { revision: number; enabled: boolean; tabs: InformationTab[] };

function isSave(url: string, method: string) {
  return new URL(url).pathname === "/api/admin/information" && method === "PUT";
}

/** Collects the body of every save the editor sends from this page. */
function recordSaves(page: Page) {
  const saves: Save[] = [];
  page.on("request", (request) => {
    if (isSave(request.url(), request.method()))
      saves.push(request.postDataJSON());
  });
  return saves;
}

/**
 * Runs an editor action and waits for the autosave it triggers. The editor
 * stays dirty afterwards when an unfinished tab still holds the tabs back.
 */
async function saved(
  page: Page,
  action: () => Promise<unknown>,
  { dirty = false } = {},
) {
  const response = page.waitForResponse((response) =>
    isSave(response.url(), response.request().method()),
  );
  await action();
  expect((await response).status()).toBe(200);
  const editor = page.locator(".information-editor");
  if (dirty) await expect(editor).toHaveAttribute("data-dirty", "true");
  else await expect(editor).not.toHaveAttribute("data-dirty", "true");
  await expect(editor).toHaveAttribute("aria-busy", "false");
}

/** Runs an editor action that an unfinished tab must keep from being saved. */
async function held(page: Page, saves: Save[], action: () => Promise<unknown>) {
  const sent = saves.length;
  const before = await adminInformation();
  await action();
  const editor = page.locator(".information-editor");
  await expect(editor).toHaveAttribute("data-dirty", "true");
  await expect(editor).toHaveAttribute("aria-busy", "false");
  await expect(incompleteHint(page)).toBeVisible();
  // Reading the saved page also leaves a wrongly sent request time to arrive.
  expect(await adminInformation()).toEqual(before);
  expect(saves.length).toBe(sent);
}

function incompleteHint(page: Page) {
  return page.getByText(
    "Ajoute un titre et un texte à cet onglet, ou supprime-le. En attendant, les modifications des onglets ne sont pas enregistrées.",
    { exact: true },
  );
}

/** Adds an empty tab at this position and returns its two fields. */
async function addTab(page: Page, position: number) {
  await page
    .locator(".information-editor")
    .getByRole("button", { name: "Ajouter un onglet", exact: true })
    .click();
  const fields = tabFields(page, position);
  await expect(fields.title).toBeFocused();
  await expect(incompleteHint(page)).toBeVisible();
  return fields;
}

function tabFields(page: Page, position: number) {
  return {
    title: page.getByLabel(`Titre de l’onglet ${position}`, { exact: true }),
    body: page.getByLabel(`Texte de l’onglet ${position}`, { exact: true }),
  };
}

function dock(page: Page) {
  return page.getByRole("navigation", {
    name: "Navigation principale",
    exact: true,
  });
}

function dockNames(page: Page) {
  return dock(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("aria-label")),
    );
}

function informationLink(page: Page) {
  return dock(page).getByRole("link", { name: "Informations", exact: true });
}

async function expectSelected(tab: Locator, panel: Locator, body: string) {
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveAccessibleName((await tab.textContent()) ?? "");
  // The text is rendered exactly as typed, line breaks included.
  expect(
    await panel
      .locator(".information-text")
      .evaluate((text) => text.textContent),
  ).toBe(body);
}

test("the host writes the information page, an unfinished tab never unpublishes one, guests read tabs and links, and turning it off removes it", async ({
  page,
  browser,
}) => {
  const hostContext = await browser.newContext({
    baseURL,
    locale: "fr-CH",
    viewport: phone,
  });
  try {
    await shareSession(hostContext, host);
    const hostPage = await hostContext.newPage();
    const saves = recordSaves(hostPage);
    await hostPage.goto("/parametres");

    // The row sits in "La fête", directly under the guest welcome.
    const row = hostPage.locator('a[href="/parametres?section=information"]');
    expect(
      await hostPage
        .locator(".settings-section")
        .filter({
          has: hostPage.getByRole("heading", { name: "La fête", exact: true }),
        })
        .locator(".settings-menu-link")
        .evaluateAll((links) =>
          links.map((link) =>
            new URL((link as HTMLAnchorElement).href).searchParams.get(
              "section",
            ),
          ),
        ),
    ).toEqual(["party", "programme", "welcome", "information"]);
    await expect(row.locator(".lucide-info")).toBeVisible();
    await expect(row.locator(".settings-menu-label > span")).toHaveText(
      "Informations",
    );
    await expect(row.locator(".settings-menu-value")).toHaveText("Désactivée");
    await expect(informationLink(hostPage)).toHaveCount(0);

    await openSettingsSection(hostPage, "information");
    await expect(
      hostPage.getByRole("heading", {
        name: "Informations",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    const editor = hostPage.locator(".information-editor");
    const toggle = editor.getByRole("switch", {
      name: "Afficher la page aux invités",
      exact: true,
    });
    await expect(toggle).not.toBeChecked();

    // The switch saves at once; without a tab the page stays hidden.
    await saved(hostPage, () => toggle.check());
    await expect(toggle).toBeChecked();
    await expect(
      editor.getByText(
        "La page apparaîtra dès qu’elle aura un onglet enregistré.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await adminInformation()).toMatchObject({ enabled: true, tabs: [] });
    await expect(informationLink(hostPage)).toHaveCount(0);

    // A tab is saved when the host leaves its second field.
    const firstDraft = { title: useful.title, body: "À compléter." };
    const first = await addTab(hostPage, 1);
    await first.title.fill(firstDraft.title);
    await first.body.fill(firstDraft.body);
    await saved(hostPage, () => first.body.blur());
    await expect(incompleteHint(hostPage)).toHaveCount(0);
    expect(await adminInformation()).toMatchObject({
      enabled: true,
      tabs: [firstDraft],
    });

    // An unfinished tab holds back an edit to another tab.
    const second = await addTab(hostPage, 2);
    await second.title.fill(sleeping.title);
    await held(hostPage, saves, async () => {
      await first.body.fill(useful.body);
      await first.body.blur();
    });
    // Completing it saves both.
    await second.body.fill(sleeping.body);
    await saved(hostPage, () => second.body.blur());
    await expect(incompleteHint(hostPage)).toHaveCount(0);
    expect(await adminInformation()).toMatchObject({
      enabled: true,
      tabs: [useful, sleeping],
    });
    await expect(editor.getByRole("alert")).toHaveCount(0);

    // The host's own dock gains the item between the guestbook and settings.
    await expect(informationLink(hostPage)).toHaveAttribute(
      "href",
      "/informations",
    );
    expect(await dockNames(hostPage)).toEqual([
      "Programme",
      "Médias",
      "Livre d'or",
      "Informations",
      "Paramètres",
      "Profil: Information Test Host",
    ]);

    await hostPage.reload();
    await openSettingsSection(hostPage, "information");
    await expect(toggle).toBeChecked();
    for (const [index, tab] of [useful, sleeping].entries()) {
      await expect(
        hostPage.getByLabel(`Titre de l’onglet ${index + 1}`, { exact: true }),
      ).toHaveValue(tab.title);
      await expect(
        hostPage.getByLabel(`Texte de l’onglet ${index + 1}`, { exact: true }),
      ).toHaveValue(tab.body);
    }
    await hostPage.screenshot({
      path: test.info().outputPath("information-editor-mobile.png"),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      style: "nextjs-portal { visibility: hidden; }",
    });

    // Six dock items still fit a 320px phone, each with a full touch target.
    await hostPage.setViewportSize({ width: 320, height: 740 });
    await expectNoHorizontalOverflow(hostPage);
    const dockBox = (await dock(hostPage).boundingBox())!;
    for (const link of await dock(hostPage).getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(dockBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dockBox.x + dockBox.width);
    }
    await hostPage.setViewportSize(phone);

    // A guest finds the item in the dock and reads the tabs.
    await signInGuest(host, page, "Information Test Guest");
    expect(await (await page.request.get("/api/information")).json()).toEqual({
      enabled: true,
      tabs: [useful, sleeping],
    });
    await page.goto("/programme");
    expect(await dockNames(page)).toEqual([
      "Programme",
      "Médias",
      "Livre d'or",
      "Informations",
      "Profil: Information Test Guest",
    ]);
    await informationLink(page).click();
    await expect(page).toHaveURL(/\/informations$/);
    await expect(informationLink(page)).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        name: "Informations",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Rubriques", exact: true });
    const usefulTab = tabs.getByRole("tab", { name: "Utiles", exact: true });
    const sleepingTab = tabs.getByRole("tab", { name: "Dormir", exact: true });
    const panel = page.getByRole("tabpanel");
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await expectSelected(usefulTab, panel, useful.body);
    await expect(sleepingTab).toHaveAttribute("aria-selected", "false");
    await expect(panel.locator(".information-text")).toHaveCSS(
      "white-space",
      "pre-wrap",
    );

    // Addresses and numbers are links; the date and the times are not.
    await expect(panel.getByRole("link")).toHaveCount(3);
    const web = panel.getByRole("link", {
      name: "https://example.com/plan",
      exact: true,
    });
    await expect(web).toHaveAttribute("href", "https://example.com/plan");
    await expect(web).toHaveAttribute("target", "_blank");
    await expect(web).toHaveAttribute("rel", "noopener noreferrer");
    const mail = panel.getByRole("link", {
      name: "lea@example.com",
      exact: true,
    });
    await expect(mail).toHaveAttribute("href", "mailto:lea@example.com");
    expect(await mail.getAttribute("target")).toBeNull();
    await expect(
      panel.getByRole("link", { name: "+41 79 123 45 67", exact: true }),
    ).toHaveAttribute("href", "tel:+41791234567");
    await page.screenshot({
      path: test.info().outputPath("information-guest-mobile.png"),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { visibility: hidden; }",
    });

    // Tabs switch with a click and with the arrow, Home and End keys.
    await sleepingTab.click();
    await expectSelected(sleepingTab, panel, sleeping.body);
    await expect(usefulTab).toHaveAttribute("aria-selected", "false");
    await expect(
      panel.getByRole("link", { name: "www.example.org/hotel", exact: true }),
    ).toHaveAttribute("href", "https://www.example.org/hotel");
    await sleepingTab.press("ArrowLeft");
    await expect(usefulTab).toBeFocused();
    await expectSelected(usefulTab, panel, useful.body);
    await usefulTab.press("ArrowRight");
    await expect(sleepingTab).toBeFocused();
    await expectSelected(sleepingTab, panel, sleeping.body);
    await sleepingTab.press("ArrowRight");
    await expect(usefulTab).toBeFocused();
    await usefulTab.press("End");
    await expect(sleepingTab).toBeFocused();
    await sleepingTab.press("Home");
    await expect(usefulTab).toBeFocused();
    await expectSelected(usefulTab, panel, useful.body);

    // A long word wraps instead of widening a 320px phone.
    await sleepingTab.click();
    await page.setViewportSize({ width: 320, height: 740 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize(phone);

    // Clearing the title of a saved tab does not unpublish it: guests keep
    // the tab as last saved.
    const published = { enabled: true, tabs: [useful, sleeping] };
    await held(hostPage, saves, async () => {
      await second.title.fill("");
      await second.title.blur();
    });
    expect(await (await page.request.get("/api/information")).json()).toEqual(
      published,
    );
    // The switch still saves at once, with the tabs as last saved.
    await saved(hostPage, () => toggle.uncheck(), { dirty: true });
    expect(saves.at(-1)).toMatchObject({
      enabled: false,
      tabs: published.tabs,
    });
    await saved(hostPage, () => toggle.check(), { dirty: true });
    expect(saves.at(-1)).toMatchObject(published);
    expect(await (await page.request.get("/api/information")).json()).toEqual(
      published,
    );
    await page.reload();
    await expect(sleepingTab).toBeVisible();
    // The editor stays open while a tab is unfinished and shows which one.
    await hostPage
      .getByRole("button", { name: "Retour aux paramètres", exact: true })
      .click();
    await expect(second.title).toBeFocused();
    await expect(hostPage).toHaveURL(/\/parametres\?section=information$/);

    // The host deletes that tab through the confirmation dialog, which lets
    // the save go out.
    await saved(hostPage, async () => {
      await editor
        .getByRole("button", { name: "Supprimer l’onglet 2", exact: true })
        .click();
      await acceptConfirmation(
        hostPage,
        "Supprimer l’onglet 2 ? Son texte sera perdu.",
      );
    });
    await expect(
      hostPage.getByLabel("Titre de l’onglet 2", { exact: true }),
    ).toHaveCount(0);
    expect(await adminInformation()).toMatchObject({
      enabled: true,
      tabs: [useful],
    });
    // One tab needs no tab list: its title heads the text.
    await page.reload();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Utiles", exact: true, level: 2 }),
    ).toBeVisible();
    await expect(page.locator(".information-text")).toContainText(
      "Rendez-vous le 14.11.2026",
    );

    // Turning the page off removes the dock item and closes the route.
    await saved(hostPage, () => toggle.uncheck());
    await expect(informationLink(hostPage)).toHaveCount(0);
    await hostPage
      .getByRole("button", { name: "Retour aux paramètres", exact: true })
      .click();
    await expect(row.locator(".settings-menu-value")).toHaveText("Désactivée");
    await hostPage.goto("/informations");
    await expect(hostPage).toHaveURL(/\/programme$/);

    await page.goto("/informations");
    await expect(page).toHaveURL(/\/programme$/);
    await expect(informationLink(page)).toHaveCount(0);
    await expect(dock(page).getByRole("link")).toHaveCount(4);
    expect(await (await page.request.get("/api/information")).json()).toEqual({
      enabled: false,
      tabs: [],
    });
  } finally {
    await hostContext.close();
  }
});
