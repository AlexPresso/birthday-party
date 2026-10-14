import { PhotoGallery } from "@/components/photos";
import { serverApi, getSession, getParty } from "@/lib/server-api";
import { photosSchema } from "@/lib/contracts";
import { getI18n } from "@/lib/server-i18n";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.photos") };
}
export default async function PhotosPage() {
  const [initial, { guest }, party] = await Promise.all([
    serverApi("/photos?limit=24", photosSchema),
    getSession(),
    getParty(),
  ]);
  return (
    <PhotoGallery initial={initial} guest={guest} timezone={party.timezone} />
  );
}
