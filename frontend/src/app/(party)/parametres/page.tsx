import { SettingsPanel } from "@/components/settings";
import { AdminPanel } from "@/components/admin";
import { WelcomeSettings } from "@/components/media-categories-admin";
import { PageHeading } from "@/components/ui";
import { getParty, serverApi } from "@/lib/server-api";
import {
  guestsSchema,
  eventsSchema,
  adminWelcomeSchema,
  profileSchema,
  mediaCategoriesSchema,
} from "@/lib/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.settings") };
}

export default async function SettingsPage() {
  const { t } = await getI18n();
  const [{ guest, limits }, party] = await Promise.all([
    serverApi("/profile", profileSchema),
    getParty(),
  ]);
  const admin =
    guest.role === "admin"
      ? await Promise.all([
          serverApi("/admin/guests", guestsSchema),
          serverApi("/admin/programme", eventsSchema),
          serverApi("/admin/welcome", adminWelcomeSchema),
          serverApi("/media-categories", mediaCategoriesSchema),
        ])
      : null;
  return (
    <>
      <PageHeading title={t("page.settings")} />
      <SettingsPanel guest={guest} imageBytes={limits.imageBytes} />
      {admin && (
        <WelcomeSettings
          initial={admin[2]}
          initialCategories={admin[3].items}
        />
      )}
      {admin && (
        <AdminPanel
          guest={guest}
          party={party}
          guests={admin[0].items}
          events={admin[1].items}
        />
      )}
    </>
  );
}
