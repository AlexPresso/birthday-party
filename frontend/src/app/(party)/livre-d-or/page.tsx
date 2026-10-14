import { Guestbook } from "@/components/guestbook";
import { serverApi, getSession, getParty } from "@/lib/server-api";
import { entriesSchema } from "@/lib/contracts";
import { getBirthdayConfig } from "@/lib/birthday-config";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.guestbook") };
}
export default async function GuestbookPage() {
  const [initial, { guest }, party, { age }] = await Promise.all([
    serverApi("/guestbook?limit=24", entriesSchema),
    getSession(),
    getParty(),
    getBirthdayConfig(),
  ]);
  return (
    <Guestbook
      initial={initial}
      guest={guest}
      timezone={party.timezone}
      age={age}
    />
  );
}
