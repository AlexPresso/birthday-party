import { Programme } from "@/features/programme/programme";
import { serverApi } from "@/lib/server-api";
import { getParty } from "@/features/party/server";
import { eventsSchema } from "@/features/programme/contracts";
import { getI18n } from "@/lib/server-i18n";
import { getSession } from "@/features/guests/server";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.programme") };
}
export default async function ProgrammePage() {
  const [events, party, session] = await Promise.all([
    serverApi("/programme", eventsSchema),
    getParty(),
    getSession(),
  ]);
  return (
    <Programme
      initial={events.items}
      party={party}
      guestId={session.guest.id}
      isAdmin={session.guest.role === "admin"}
    />
  );
}
