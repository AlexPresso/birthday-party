import { redirect } from "next/navigation";
import { WaitingRoom } from "@/features/welcome/waiting-room";
import { getBirthdayConfig } from "@/features/party/birthday-config";
import { getSession } from "@/features/guests/server";
import { getWelcome } from "@/features/welcome/server";
import { getI18n } from "@/lib/server-i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getI18n()).t("welcome.title") };
}

export default async function WaitingPage() {
  const [{ guest }, welcome, { title }] = await Promise.all([
    getSession(),
    getWelcome(),
    getBirthdayConfig(),
  ]);
  if (guest.role === "admin" || welcome.open) redirect("/photos");
  return <WaitingRoom guest={guest} initial={welcome} title={title} />;
}
