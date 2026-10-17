import type { MetadataRoute } from "next";
import { getBirthdayConfig } from "@/features/party/birthday-config";
import { getI18n } from "@/lib/server-i18n";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { title, description } = await getBirthdayConfig();
  const { locale, t } = await getI18n();
  return {
    id: "/",
    name: title || t("birthday.fallback"),
    short_name: title || t("birthday.fallback"),
    description: description || undefined,
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#151218",
    theme_color: "#151218",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
