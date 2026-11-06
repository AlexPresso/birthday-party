import { PageHeading } from "@/components/ui";
import { ProfilePanel } from "@/features/profile/profile-panel";
import { profileSchema } from "@/features/profile/contracts";
import { serverApi } from "@/lib/server-api";
import { getI18n } from "@/lib/server-i18n";

export async function generateMetadata() {
  return { title: (await getI18n()).t("page.profile") };
}

export default async function ProfilePage() {
  const [{ t }, { guest, limits }] = await Promise.all([
    getI18n(),
    serverApi("/profile", profileSchema),
  ]);
  return (
    <>
      <PageHeading title={t("page.profile")} />
      <ProfilePanel guest={guest} imageBytes={limits.imageBytes} />
    </>
  );
}
