import { PageTransition } from "@/components/page-transition";
import { ProfilePanel } from "@/features/profile/profile-panel";
import { profileSchema } from "@/features/profile/contracts";
import { serverApi } from "@/lib/server-api";
import { getI18n } from "@/lib/server-i18n";

export async function generateMetadata() {
  return { title: (await getI18n()).t("page.profile") };
}

export default async function ProfilePage() {
  const { guest, limits } = await serverApi("/profile", profileSchema);
  return (
    <PageTransition>
      <ProfilePanel guest={guest} imageBytes={limits.imageBytes} />
    </PageTransition>
  );
}
