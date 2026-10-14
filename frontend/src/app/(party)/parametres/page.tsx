import { SettingsPanel } from "@/components/settings";
import { AdminPanel } from "@/components/admin";
import { PageHeading } from "@/components/ui";
import { getParty, getSession, serverApi } from "@/lib/server-api";
import { guestsSchema, eventsSchema } from "@/lib/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.settings") };
}

export default async function SettingsPage() {
  const { t } = await getI18n();
  const [{ guest }, party] = await Promise.all([getSession(), getParty()]);
  const admin =
    guest.role === "admin"
      ? await Promise.all([
          serverApi("/admin/guests", guestsSchema),
          serverApi("/admin/programme", eventsSchema),
        ])
      : null;
  return (
    <>
      <PageHeading title={t("page.settings")} />
      <SettingsPanel guest={guest} />
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
