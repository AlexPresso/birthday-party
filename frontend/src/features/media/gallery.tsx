"use client";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import {
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Images,
  Download,
  Play,
  Presentation,
  Grid2X2,
  List,
  LockKeyhole,
  MoreHorizontal,
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
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar } from "@/components/avatar";
import { useCompletedUploads } from "./upload-provider";
import { MediaPicker } from "./media-picker";
import { MediaSlideshow } from "./media-slideshow";
import "./gallery.css";

// Mosaic rows are a tenth of a column wide: a square photo spans ten rows.
// Extreme panoramas and tall crops are clamped so every tile stays tappable.
function mosaicSpan(photo: Photo) {
  const ratio = photo.width > 0 ? photo.height / photo.width : 1;
  return Math.round(Math.min(1.45, Math.max(0.7, ratio)) * 10);
}

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
  const confirm = useConfirm();
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
  const { completed, forgetPhoto } = useCompletedUploads();
  const completedInCategory = completed.filter(
    (photo) => photo.categoryId === categoryId,
  );
  const photosById = new Map(
    [...storedPhotos, ...completedInCategory].map((photo) => [photo.id, photo]),
  );
  const photos = [...photosById.values()].sort((a, b) => b.id - a.id);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [slideshow, setSlideshow] = useState<PhotoPage | null>(null);
  const [view, setView] = useState<"feed" | "grid">("grid");
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const filters = [
    { id: null, name: t("photos.gallery"), isPublic: true },
    ...categories,
  ];

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
    const confirmed = await confirm({
      message: t("photos.deleteConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await remove(`/photos/${photo.id}`);
      setSelected(null);
      setPhotos((items) => items.filter((item) => item.id !== photo.id));
      forgetPhoto(photo.id);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setDeleting(false);
    }
  }

  // The slideshow continues from the loaded list of the current category.
  function startSlideshow() {
    setSlideshow({
      items: photos,
      nextCursor: cursor,
      limits: initial.limits,
    });
  }

  return (
    <div className="media-gallery">
      <PageHeading inHeader title={t("photos.title")}>
        <MediaPicker
          compact
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
      </PageHeading>
      <div
        className="media-category-strip"
        role="group"
        aria-label={t("categories.filter")}
        aria-busy={filterPending}
      >
        {filters.map((item) => {
          const active = item.id === categoryId;
          const label = item.isPublic
            ? item.name
            : t("categories.privateOption", { name: item.name });
          const cover = item.id === null ? null : item.coverThumbnailUrl;
          const thumbnail = active ? (photos[0]?.thumbnailUrl ?? cover) : cover;
          return (
            <button
              type="button"
              className="media-category-option"
              key={item.id ?? "main"}
              aria-label={label}
              aria-pressed={active}
              disabled={filterPending}
              onClick={() => {
                if (active) return;
                startFilter(() =>
                  router.push(
                    item.id === null
                      ? "/photos"
                      : `/photos?categoryId=${item.id}`,
                    { scroll: false },
                  ),
                );
              }}
            >
              <span
                className="media-category-portrait"
                aria-hidden="true"
                style={
                  thumbnail
                    ? { backgroundImage: `url(${thumbnail})` }
                    : undefined
                }
              >
                {!thumbnail &&
                  (item.id === null ? (
                    <Images size={26} strokeWidth={1.5} />
                  ) : (
                    item.name.charAt(0).toLocaleUpperCase(locale)
                  ))}
                {!item.isPublic && (
                  <span className="media-category-private">
                    <LockKeyhole size={13} />
                  </span>
                )}
              </span>
              <span className="media-category-name">{label}</span>
            </button>
          );
        })}
      </div>
      {filterPending && (
        <p className="fine-print" role="status">
          {t("photos.loading")}
        </p>
      )}
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
              <h2 className="visually-hidden">
                {category ? categoryName : t("photos.allHeading")}
              </h2>
              <span className="visually-hidden">
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
            <div className="media-view-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={t("slideshow.start")}
                title={t("slideshow.start")}
                disabled={filterPending}
                onClick={startSlideshow}
              >
                <Presentation size={22} aria-hidden="true" />
              </button>
              <div
                className="media-view-switch"
                role="group"
                aria-label={t("photos.view")}
              >
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("photos.gridView")}
                  title={t("photos.gridView")}
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <Grid2X2 size={22} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("photos.feedView")}
                  title={t("photos.feedView")}
                  aria-pressed={view === "feed"}
                  onClick={() => setView("feed")}
                >
                  <List size={22} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div className={`media-collection media-${view}`}>
            {photos.map((photo) => (
              <article
                className="media-post"
                key={photo.id}
                id={`media-${photo.id}`}
                style={{ "--span": mosaicSpan(photo) } as CSSProperties}
              >
                <header className="media-post-author">
                  <Avatar
                    name={photo.author.name}
                    avatarUrl={photo.author.avatarUrl}
                  />
                  <div>
                    <strong>{photo.author.name}</strong>
                    <time dateTime={photo.createdAt}>
                      {formatDate(photo.createdAt, timezone, true, locale)}
                    </time>
                  </div>
                  <details className="media-post-menu" name="media-actions">
                    <summary
                      className="icon-button"
                      aria-label={t("photos.options")}
                      title={t("photos.options")}
                    >
                      <MoreHorizontal size={22} aria-hidden="true" />
                    </summary>
                    <div className="media-post-menu-items">
                      <button
                        type="button"
                        onClick={() => setSelected(photo.id)}
                      >
                        <Images size={17} aria-hidden="true" />
                        {t("photos.details")}
                      </button>
                      <button
                        type="button"
                        disabled={filterPending}
                        onClick={startSlideshow}
                      >
                        <Presentation size={17} aria-hidden="true" />
                        {t("slideshow.start")}
                      </button>
                      <a href={`${photo.url}?download=1`} download>
                        <Download size={17} aria-hidden="true" />
                        {t("photos.download")}
                      </a>
                      {(guest.id === photo.author.id ||
                        guest.role === "admin") && (
                        <button
                          type="button"
                          className="danger"
                          disabled={deleting}
                          onClick={() => deletePhoto(photo)}
                        >
                          <Trash2 size={17} aria-hidden="true" />
                          {t("photos.delete")}
                        </button>
                      )}
                    </div>
                  </details>
                </header>
                <button
                  className="photo-tile"
                  type="button"
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
                </button>
                <footer className="media-post-actions">
                  <a
                    className="icon-button"
                    href={`${photo.url}?download=1`}
                    download
                    aria-label={t("photos.downloadFrom", {
                      name: photo.author.name,
                    })}
                    title={t("photos.download")}
                  >
                    <Download size={18} aria-hidden="true" />
                  </a>
                </footer>
              </article>
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
                  href={`${current.url}?download=1`}
                  download
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
    </div>
  );
}
