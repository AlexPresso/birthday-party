import { Programme } from "@/components/programme";
import { serverApi, getParty } from "@/lib/server-api";
import { eventsSchema } from "@/lib/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.programme") };
}
export default async function ProgrammePage() {
  const [events, party] = await Promise.all([
    serverApi("/programme", eventsSchema),
    getParty(),
  ]);
  return <Programme initial={events.items} party={party} />;
}
