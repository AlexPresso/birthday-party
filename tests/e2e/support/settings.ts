import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Settings show no "saved" message: a finished save is announced to screen
 * readers only, through a visually hidden status.
 */
export async function expectSavedAnnouncement(
  scope: Page | Locator,
  message: string,
) {
  await expect(scope.getByText(message, { exact: true })).toHaveClass(
    "visually-hidden",
  );
}

export type SettingsSection =
  | "party"
  | "age"
  | "programme"
  | "guests"
  | "invitation"
  | "welcome"
  | "information"
  | "categories"
  | "uploads";

export async function openSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  if (section === "age") section = "party";
  if (new URL(page.url()).pathname !== "/parametres") {
    await page.goto("/parametres");
  }
  if ((page.viewportSize()?.width ?? 0) >= 960) {
    const panel = page.locator(`[data-settings-screen="${section}"]`);
    if (!(await panel.isVisible())) {
      await page.locator(`a[href="/parametres?section=${section}"]`).click();
    }
    await expect(panel).toBeVisible();
    await expect(
      page.locator(`a[href="/parametres?section=${section}"]`),
    ).toHaveAttribute("aria-current", "page");
    return;
  }
  if (new URL(page.url()).searchParams.get("section") === section) {
    await expect(
      page.locator(`[data-settings-screen="${section}"] .settings-back`),
    ).toBeVisible();
    await expect(page.locator(".settings-screen[data-leaving]")).toHaveCount(0);
    return;
  }
  if (new URL(page.url()).searchParams.has("section")) {
    await page.locator(".settings-back:visible").click();
    await expect(page).toHaveURL(/\/parametres$/);
  }
  await page
    .locator(`a[href="/parametres?section=${section}"]:visible`)
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/parametres" &&
      url.searchParams.get("section") === section,
  );
  // History updates before React displays the destination and starts its animation.
  await expect(
    page.locator(`[data-settings-screen="${section}"] .settings-back`),
  ).toBeVisible();
  await expect(page.locator(".settings-screen[data-leaving]")).toHaveCount(0);
}
