import { redirect } from "next/navigation";
import { WaitingRoom } from "@/components/waiting-room";
import { getBirthdayConfig } from "@/lib/birthday-config";
import { getSession, getWelcome } from "@/lib/server-api";
import { getI18n } from "@/lib/server-i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getI18n()).t("welcome.title") };
}

export default async function WaitingPage() {
  const [{ guest }, welcome, { age, title }] = await Promise.all([
    getSession(),
    getWelcome(),
    getBirthdayConfig(),
  ]);
  if (guest.role === "admin" || welcome.open) redirect("/photos");
  return (
    <WaitingRoom guest={guest} initial={welcome} age={age} title={title} />
  );
}
