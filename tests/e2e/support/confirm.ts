import { expect, type Page } from "@playwright/test";

type Message = string | RegExp;

/** The in-page confirmation that replaced `window.confirm`. */
export function confirmation(page: Page) {
  return page.getByRole("alertdialog");
}

async function answer(
  page: Page,
  value: "confirm" | "cancel",
  message?: Message,
) {
  const dialog = confirmation(page);
  await expect(dialog).toBeVisible();
  // The translated question is the dialog's accessible name.
  if (message !== undefined) await expect(dialog).toHaveAccessibleName(message);
  // Button values are stable across the five interface languages.
  await dialog.locator(`button[value="${value}"]`).click();
  await expect(dialog).toBeHidden();
}

/** Confirms the open confirmation, optionally checking its question first. */
export function acceptConfirmation(page: Page, message?: Message) {
  return answer(page, "confirm", message);
}

/** Cancels the open confirmation, optionally checking its question first. */
export function declineConfirmation(page: Page, message?: Message) {
  return answer(page, "cancel", message);
}
