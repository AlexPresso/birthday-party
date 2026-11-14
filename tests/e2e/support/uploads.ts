import { expect, type Locator, type Page } from "@playwright/test";

/** The modal sheet (a dialog from 960px) listing a queue's files, in French. */
export function uploadSheet(page: Page) {
  return page.getByRole("dialog", { name: "Détail des envois", exact: true });
}

/** An element's box once its own entrance animation has ended. */
export async function restingBox(target: Locator) {
  await target.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  return (await target.boundingBox())!;
}

/** Presses a queue's pill and waits for its details. */
export async function openUploadDetails(page: Page, scope: Page | Locator) {
  await scope
    .getByRole("button", { name: "Détail des envois", exact: true })
    .click();
  await expect(uploadSheet(page)).toBeVisible();
}

/** Closes the open details with their close button. */
export async function closeUploadDetails(page: Page) {
  await uploadSheet(page)
    .getByRole("button", { name: "Masquer le détail", exact: true })
    .click();
  await expect(uploadSheet(page)).toHaveCount(0);
}
