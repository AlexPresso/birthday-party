import { redirect } from "next/navigation";
import { PageTransition } from "@/components/page-transition";
import { AdminPanel } from "@/features/settings/admin-panel";
import { getParty } from "@/features/party/server";
import { configurationSchema } from "@/features/party/contracts";
import { getSession } from "@/features/guests/server";
import { serverApi } from "@/lib/server-api";
import { guestsSchema } from "@/features/guests/contracts";
import {
  eventsSchema,
  programmeNotificationsSchema,
} from "@/features/programme/contracts";
import { adminWelcomeSchema } from "@/features/welcome/contracts";
import { adminInformationSchema } from "@/features/information/contracts";
import {
  mediaCategoriesSchema,
  storageSchema,
} from "@/features/media/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.settings") };
}

export default async function SettingsPage() {
  const { guest } = await getSession();
  if (guest.role !== "admin") redirect("/profil");

  const [
    party,
    guests,
    events,
    programmeNotifications,
    welcome,
    information,
    categories,
    configuration,
    storage,
  ] = await Promise.all([
    getParty(),
    serverApi("/admin/guests", guestsSchema),
    serverApi("/admin/programme", eventsSchema),
    serverApi("/admin/programme/notifications", programmeNotificationsSchema),
    serverApi("/admin/welcome", adminWelcomeSchema),
    serverApi("/admin/information", adminInformationSchema),
    serverApi("/media-categories", mediaCategoriesSchema),
    serverApi("/admin/config", configurationSchema),
    serverApi("/admin/storage", storageSchema),
  ]);
  return (
    <PageTransition>
      <AdminPanel
        guest={guest}
        party={party}
        guests={guests.items}
        events={events.items}
        programmeNotifications={programmeNotifications.enabled}
        configuration={configuration}
        welcome={welcome}
        information={information}
        categories={categories.items}
        storage={storage}
      />
    </PageTransition>
  );
}
