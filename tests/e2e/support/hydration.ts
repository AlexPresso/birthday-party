import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated an element. Before that, a change made to
 * a server-rendered control reaches no handler; worse, React then records the
 * value it finds as current, so setting the same value again is not a change.
 * React keeps an element's props under a "__reactProps$" key once it owns it:
 * a test-only reading of an internal detail, which a React upgrade could move.
 */
export async function expectHydrated(element: Locator) {
  await expect
    .poll(() =>
      element.evaluate((node) =>
        Object.keys(node).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}
