import { expect, type Page } from "@playwright/test";

/**
 * Drops the network and restores it. The realtime client closes its socket
 * while offline, then reconnects and reads every mounted resource once: the
 * only explicit resynchronization left now that a live socket ignores focus
 * and visibility changes.
 */
export async function reconnectRealtime(page: Page) {
  const context = page.context();
  await context.setOffline(true);
  try {
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  } finally {
    await context.setOffline(false);
  }
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
}
