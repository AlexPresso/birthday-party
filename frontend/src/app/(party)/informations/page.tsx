import { redirect } from "next/navigation";
import { PageTransition } from "@/components/page-transition";
import { InformationPage } from "@/features/information/information-page";
import { getInformation } from "@/features/information/server";
import { getI18n } from "@/lib/server-i18n";

export async function generateMetadata() {
  return { title: (await getI18n()).t("page.information") };
}

export default async function InformationRoute() {
  const information = await getInformation();
  // Hidden by the host, or without any tab: Go sent nothing to show.
  if (!information.enabled) redirect("/programme");
  return (
    <PageTransition>
      <InformationPage tabs={information.tabs} />
    </PageTransition>
  );
}
