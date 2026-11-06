import { redirect } from "next/navigation";
import { AdminPanel } from "@/features/settings/admin-panel";
import { getParty } from "@/features/party/server";
import { configurationSchema } from "@/features/party/contracts";
import { getSession } from "@/features/guests/server";
import { serverApi } from "@/lib/server-api";
import { guestsSchema } from "@/features/guests/contracts";
import { eventsSchema } from "@/features/programme/contracts";
import { adminWelcomeSchema } from "@/features/welcome/contracts";
import { mediaCategoriesSchema } from "@/features/media/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.settings") };
}

export default async function SettingsPage() {
  const { guest } = await getSession();
  if (guest.role !== "admin") redirect("/profil");

  const [party, guests, events, welcome, categories, configuration] =
    await Promise.all([
      getParty(),
      serverApi("/admin/guests", guestsSchema),
      serverApi("/admin/programme", eventsSchema),
      serverApi("/admin/welcome", adminWelcomeSchema),
      serverApi("/media-categories", mediaCategoriesSchema),
      serverApi("/admin/config", configurationSchema),
    ]);
  return (
    <AdminPanel
      guest={guest}
      party={party}
      guests={guests.items}
      events={events.items}
      configuration={configuration}
      welcome={welcome}
      categories={categories.items}
    />
  );
}
