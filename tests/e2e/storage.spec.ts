import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  bootstrapHost,
  expectNoHorizontalOverflow,
  shareSession,
} from "./support/party";
import { openSettingsSection } from "./support/settings";

let host: APIRequestContext;

test.use({ locale: "fr-CH" });

test.beforeAll(async () => {
  host = await bootstrapHost("Storage Test Host");
});

test.afterAll(async () => {
  await host.dispose();
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 1280, height: 800 },
]) {
  test(`the host sees the disk's used and free space at ${viewport.width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    await shareSession(context, host);
    const storage = await (await host.get("/api/admin/storage")).json();
    await page.goto("/parametres");
    // The menu row shows the free space.
    await expect(
      page.locator('a[href="/parametres?section=storage"]'),
    ).toContainText(/libres/);
    await openSettingsSection(page, "storage");
    const panel = page.locator('[data-settings-screen="storage"]');
    const meter = panel.getByRole("meter", { name: "Espace disque utilisé" });
    await expect(meter).toHaveAttribute("aria-valuetext", /utilisés sur/);
    const percent = Math.round(
      ((storage.totalBytes - storage.availableBytes) / storage.totalBytes) *
        100,
    );
    await expect(meter).toHaveAttribute("aria-valuenow", String(percent));
    await expect(panel.getByText(/libres$/)).toBeVisible();
    await expect(panel.getByText(/^Presque plein/)).toHaveCount(
      storage.warning ? 1 : 0,
    );
    await expectNoHorizontalOverflow(page);
  });
}
