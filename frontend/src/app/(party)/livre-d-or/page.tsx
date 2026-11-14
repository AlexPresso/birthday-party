import { PageTransition } from "@/components/page-transition";
import { Guestbook } from "@/features/guestbook/guestbook";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/features/guests/server";
import { getParty } from "@/features/party/server";
import { entriesSchema } from "@/features/guestbook/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.guestbook") };
}
export default async function GuestbookPage() {
  const [initial, { guest }, party] = await Promise.all([
    serverApi("/guestbook?limit=24", entriesSchema),
    getSession(),
    getParty(),
  ]);
  return (
    <PageTransition>
      <Guestbook initial={initial} guest={guest} timezone={party.timezone} />
    </PageTransition>
  );
}
