import { PhotoGallery } from "@/features/media/gallery";
import { serverApi } from "@/lib/server-api";
import { getSession } from "@/features/guests/server";
import { getParty } from "@/features/party/server";
import {
  photosSchema,
  mediaCategoriesSchema,
} from "@/features/media/contracts";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/server-i18n";
import { ApiError } from "@/lib/api";
export async function generateMetadata() {
  return { title: (await getI18n()).t("page.photos") };
}
export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string | string[] }>;
}) {
  const query = (await searchParams).categoryId;
  if (
    query !== undefined &&
    (typeof query !== "string" ||
      !/^[1-9]\d*$/.test(query) ||
      !Number.isSafeInteger(Number(query)))
  )
    notFound();
  const categoryId = query === undefined ? null : Number(query);
  const [initial, { guest }, party, categories] = await Promise.all([
    serverApi(
      `/photos?limit=24${categoryId === null ? "" : `&categoryId=${categoryId}`}`,
      photosSchema,
    ).catch((error) => {
      if (
        error instanceof ApiError &&
        error.code === "errors.media_category_not_found"
      )
        notFound();
      throw error;
    }),
    getSession(),
    getParty(),
    serverApi("/media-categories", mediaCategoriesSchema),
  ]);
  return (
    <PhotoGallery
      key={categoryId ?? "main"}
      initial={initial}
      guest={guest}
      timezone={party.timezone}
      categories={categories.items}
      categoryId={categoryId}
    />
  );
}
