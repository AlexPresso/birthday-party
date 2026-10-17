"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Images,
  Download,
  Play,
  Presentation,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api, errorMessage, remove } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  photosSchema,
  type Photo,
  type PhotoPage,
  type MediaCategory,
} from "./contracts";
import { formatDate } from "@/lib/dates";
import { type Guest } from "@/features/guests/contracts";
import { PageHeading, EmptyState, ErrorNotice } from "@/components/ui";
import { useUploads } from "./upload-provider";
import { UploadQueue } from "./upload-queue";
import { MediaPicker } from "./media-picker";
import { MediaSlideshow } from "./media-slideshow";
import "./media-categories.css";

export function PhotoGallery({
  initial,
  guest,
  timezone,
  categories,
  categoryId,
}: {
  initial: PhotoPage;
  guest: Guest;
  timezone: string;
  categories: MediaCategory[];
  categoryId: number | null;
}) {
  const { locale, t } = useI18n();
  const numbers = new Intl.NumberFormat(locale);
  const plurals = new Intl.PluralRules(locale);
  const router = useRouter();
  const [filterPending, startFilter] = useTransition();
  const category = categories.find((item) => item.id === categoryId);
  const categoryName = category
    ? category.isPublic
      ? category.name
      : t("categories.privateOption", { name: category.name })
    : t("categories.main");
  const [storedPhotos, setPhotos] = useState(initial.items);
  const uploads = useUploads();
  const photos = [
    ...new Map(
      [
        ...storedPhotos,
        ...uploads.completed.filter((photo) => photo.categoryId === categoryId),
      ].map((photo) => [photo.id, photo]),
    ).values(),
  ].sort((a, b) => b.id - a.id);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [slideshow, setSlideshow] = useState<PhotoPage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (selected !== null && !dialog.current?.open) dialog.current?.showModal();
    if (selected === null && dialog.current?.open) dialog.current.close();
  }, [selected]);

  useEffect(() => {
    const playback = video.current;
    return () => playback?.pause();
  }, [selected]);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const data = await api(
        "/photos?limit=24&before=" +
          encodeURIComponent(cursor!) +
          (categoryId === null ? "" : "&categoryId=" + categoryId),
        photosSchema,
      );
      setPhotos((items) => [
        ...items,
        ...data.items.filter(
          (photo) => !items.some((item) => item.id === photo.id),
        ),
      ]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }

  const currentIndex = photos.findIndex((photo) => photo.id === selected);
  const current = photos[currentIndex];
  async function deletePhoto(photo: Photo) {
    if (!window.confirm(t("photos.deleteConfirm"))) return;
    setDeleting(true);
    setError(null);
    try {
      await remove(`/photos/${photo.id}`);
      setSelected(null);
      setPhotos((items) => items.filter((item) => item.id !== photo.id));
      uploads.forgetPhoto(photo.id);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeading
        title={t("photos.title")}
        description={t("photos.description")}
      />
      {categories.length > 0 && (
        <div className="media-category-filter">
          <label htmlFor="media-category-filter">
            {t("categories.filter")}
          </label>
          <select
            id="media-category-filter"
            value={categoryId ?? ""}
            disabled={filterPending}
            onChange={(event) => {
              const value = event.target.value;
              startFilter(() =>
                router.push(
                  value
                    ? "/photos?categoryId=" + encodeURIComponent(value)
                    : "/photos",
                  { scroll: false },
                ),
              );
            }}
          >
            <option value="">{t("categories.main")}</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.isPublic
                  ? item.name
                  : t("categories.privateOption", { name: item.name })}
              </option>
            ))}
          </select>
          {filterPending && (
            <span className="fine-print" role="status">
              {t("photos.loading")}
            </span>
          )}
        </div>
      )}
      <MediaPicker
        limits={initial.limits}
        destination={{
          categoryId,
          welcomeRevision: null,
          welcomeWidgetIndex: null,
        }}
      >
        {category && (
          <p className="fine-print">
            {t("categories.destination", { name: categoryName })}
          </p>
        )}
      </MediaPicker>
      <UploadQueue />
      <ErrorNotice message={selected === null ? error : null} />
      {photos.length === 0 ? (
        <EmptyState
          icon={<Images size={36} strokeWidth={1.4} />}
          title={t("photos.emptyTitle")}
        >
          <p>
            {t(
              categoryId === null
                ? "photos.emptyDescription"
                : "categories.emptyGallery",
            )}
          </p>
        </EmptyState>
      ) : (
        <section aria-label={t("photos.all")}>
          <div className="section-row gallery-heading">
            <div>
              <h2>{category ? categoryName : t("photos.allHeading")}</h2>
              <span className="fine-print">
                {t(
                  plurals.select(photos.length) === "one"
                    ? "photos.countOne"
                    : "photos.countOther",
                  {
                    count: `${numbers.format(photos.length)}${cursor ? "+" : ""}`,
                  },
                )}
              </span>
            </div>
            <button
              type="button"
              className="button secondary slideshow-launch"
              disabled={filterPending}
              onClick={() =>
                setSlideshow({
                  items: photos,
                  nextCursor: cursor,
                  limits: initial.limits,
                })
              }
            >
              <Presentation size={18} aria-hidden="true" />
              {t("slideshow.start")}
            </button>
          </div>
          <div className="photo-grid">
            {photos.map((photo) => (
              <button
                className="photo-tile"
                key={photo.id}
                onClick={() => setSelected(photo.id)}
                aria-label={t(
                  photo.kind === "video" ? "photos.openVideo" : "photos.open",
                  {
                    name: photo.author.name,
                    date: formatDate(photo.createdAt, timezone, true, locale),
                  },
                )}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={t(
                    photo.kind === "video" ? "photos.videoAlt" : "photos.alt",
                    { name: photo.author.name },
                  )}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                />
                {photo.kind === "video" && (
                  <span className="video-marker" aria-hidden="true">
                    <Play size={20} fill="currentColor" />
                  </span>
                )}
                <span className="photo-author">{photo.author.name}</span>
              </button>
            ))}
          </div>
          {cursor && (
            <button
              className="button secondary load-more"
              onClick={loadMore}
              disabled={loading}
            >
              {t(loading ? "photos.loading" : "photos.loadMore")}
            </button>
          )}
        </section>
      )}
      {slideshow && (
        <MediaSlideshow
          initial={slideshow}
          categoryId={categoryId}
          categoryName={categoryName}
          onClose={() => setSlideshow(null)}
        />
      )}
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label={t("photos.lightbox")}
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === dialog.current) setSelected(null);
        }}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLVideoElement) return;
          if (event.key === "ArrowRight" && currentIndex < photos.length - 1) {
            event.preventDefault();
            setSelected(photos[currentIndex + 1].id);
          }
          if (event.key === "ArrowLeft" && currentIndex > 0) {
            event.preventDefault();
            setSelected(photos[currentIndex - 1].id);
          }
        }}
      >
        {current && (
          <div className="lightbox-content">
            <div className="lightbox-toolbar">
              <div>
                <strong>{current.author.name}</strong>
                <p className="fine-print">
                  {formatDate(current.createdAt, timezone, true, locale)}
                </p>
              </div>
              <button
                autoFocus
                className="icon-button"
                onClick={() => setSelected(null)}
                aria-label={t("photos.closePhoto")}
              >
                <X />
              </button>
            </div>
            {current.kind === "video" ? (
              <video
                key={current.id}
                ref={video}
                className="lightbox-image"
                src={current.url}
                poster={current.thumbnailUrl}
                width={current.width}
                height={current.height}
                controls
                playsInline
                preload="metadata"
                aria-label={t("photos.videoAlt", { name: current.author.name })}
              />
            ) : (
              <img
                className="lightbox-image"
                src={current.url}
                alt={t("photos.alt", { name: current.author.name })}
                width={current.width}
                height={current.height}
              />
            )}
            <div className="lightbox-footer">
              <div className="button-row">
                <button
                  className="icon-button"
                  disabled={currentIndex === 0}
                  onClick={() => setSelected(photos[currentIndex - 1].id)}
                  aria-label={t("photos.previous")}
                >
                  <ChevronLeft />
                </button>
                <span className="fine-print">
                  {numbers.format(currentIndex + 1)} /{" "}
                  {numbers.format(photos.length)}
                </span>
                <button
                  className="icon-button"
                  disabled={currentIndex === photos.length - 1}
                  onClick={() => setSelected(photos[currentIndex + 1].id)}
                  aria-label={t("photos.next")}
                >
                  <ChevronRight />
                </button>
              </div>
              <div className="button-row">
                <a
                  className="icon-button"
                  href={current.url}
                  download={`media-${current.id}.${
                    current.mimeType === "image/jpeg"
                      ? "jpg"
                      : current.mimeType.split("/")[1]
                  }`}
                  aria-label={t("photos.download")}
                >
                  <Download size={19} />
                </a>
                {(guest.id === current.author.id || guest.role === "admin") && (
                  <button
                    className="icon-button danger"
                    onClick={() => deletePhoto(current)}
                    disabled={deleting}
                    aria-label={t("photos.delete")}
                  >
                    <Trash2 size={19} />
                  </button>
                )}
              </div>
            </div>
            <ErrorNotice message={error} />
          </div>
        )}
      </dialog>
    </>
  );
}
