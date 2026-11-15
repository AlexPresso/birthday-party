import type { Translator } from "@/lib/i18n";
import type { Photo } from "./contracts";

// A medium keeps no author once its guest was deleted: it is shown as
// anonymous and described without a name.

export function authorName(photo: Photo, t: Translator) {
  return photo.author?.name ?? t("guestbook.anonymous");
}

export function mediaAlt(photo: Photo, t: Translator) {
  const video = photo.kind === "video";
  return photo.author
    ? t(video ? "photos.videoAlt" : "photos.alt", { name: photo.author.name })
    : t(video ? "photos.videoAltUnknown" : "photos.altUnknown");
}

export function openLabel(photo: Photo, t: Translator, date: string) {
  const video = photo.kind === "video";
  return photo.author
    ? t(video ? "photos.openVideo" : "photos.open", {
        name: photo.author.name,
        date,
      })
    : t(video ? "photos.openVideoUnknown" : "photos.openUnknown", { date });
}

export function downloadLabel(photo: Photo, t: Translator) {
  return photo.author
    ? t("photos.downloadFrom", { name: photo.author.name })
    : t("photos.download");
}
