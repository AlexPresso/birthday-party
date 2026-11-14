import { expect, type Page } from "@playwright/test";

/**
 * The green of the former "saved" messages (`--success`, #9fd8b4) and its
 * soft background (`--success-soft`, #1f3328), as browsers compute them.
 */
const successColours = ["rgb(159, 216, 180)", "rgb(31, 51, 40)"];

/**
 * Fails when something on screen is drawn in the success green. A finished
 * action is announced to screen readers only; the page shows its result, not
 * a confirmation.
 */
export async function expectNoSuccessColour(page: Page) {
  const green = await page.evaluate((colours) => {
    const found: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      if (
        !colours.includes(style.color) &&
        !colours.includes(style.backgroundColor)
      )
        continue;
      const box = element.getBoundingClientRect();
      // Visually hidden announcements are one pixel wide and clipped.
      if (box.width <= 1 || box.height <= 1 || !element.checkVisibility())
        continue;
      const text = element.textContent?.trim().slice(0, 60) ?? "";
      const classes = element.getAttribute("class") ?? "";
      found.push(`<${element.localName} class="${classes}"> ${text}`);
    }
    return found;
  }, successColours);
  expect(green).toEqual([]);
}
