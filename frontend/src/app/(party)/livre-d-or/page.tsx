import { Guestbook } from "@/features/guestbook/guestbook";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/features/guests/server";
import { getParty } from "@/features/party/server";
import { entriesSchema } from "@/features/guestbook/contracts";
import { getBirthdayConfig } from "@/features/party/birthday-config";
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
