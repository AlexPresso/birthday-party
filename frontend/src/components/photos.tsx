"use client";
import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Upload,
  Check,
  RotateCw,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Images,
  Download,
  Play,
} from "lucide-react";
import { api, errorMessage, remove, responseError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  photosSchema,
  formatDate,
  type Guest,
  type Photo,
  type PhotoPage,
} from "@/lib/contracts";
import { PageHeading, EmptyState, ErrorNotice } from "./ui";
import { useUploads } from "./upload-provider";

export function PhotoGallery({
  initial,
  guest,
  timezone,
}: {
  initial: PhotoPage;
  guest: Guest;
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const numbers = new Intl.NumberFormat(locale);
  const plurals = new Intl.PluralRules(locale);
  const limits = initial.limits;
  const imageSize = numbers.format(limits.imageBytes / (1024 * 1024));
  const videoSize = numbers.format(limits.videoBytes / (1024 * 1024));
  const [storedPhotos, setPhotos] = useState(initial.items);
  const uploads = useUploads();
  const photos = [
    ...new Map(
      [...storedPhotos, ...uploads.completed].map((photo) => [photo.id, photo]),
    ).values(),
  ].sort((a, b) => b.id - a.id);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
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

  function choose(files: FileList | null) {
    if (!files) return;
    setError(
      uploads.addFiles(Array.from(files), limits)
        ? t("photos.selectionLimit")
        : null,
    );
    if (input.current) input.current.value = "";
  }

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const data = await api(
        `/photos?limit=24&before=${encodeURIComponent(cursor!)}`,
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
  const transmitting = uploads.transfers.some(
    (item) => item.status !== "error",
  );
  const active =
    transmitting ||
    uploads.jobs.some(
      (job) => job.status === "queued" || job.status === "processing",
    );
  const completed = uploads.jobs.filter((job) => job.status === "ready").length;
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
      >
        <button
          className="button primary upload-button"
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={20} />
          {t("photos.add")}
        </button>
      </PageHeading>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        aria-label={t("photos.add")}
        onChange={(event) => choose(event.target.files)}
        tabIndex={-1}
      />
      <p className="photo-privacy">
        <Images size={15} aria-hidden="true" />{" "}
        {t("photos.privacy", { imageSize, videoSize })}
      </p>
      {(uploads.transfers.length > 0 || uploads.jobs.length > 0) && (
        <section
          className="upload-queue panel"
          aria-label={t("photos.uploadQueue")}
        >
          <div className="section-row">
            <h2>{t(active ? "photos.uploading" : "photos.uploads")}</h2>
            {!active && (
              <button className="text-button" onClick={uploads.clearFinished}>
                {t("photos.close")}
              </button>
            )}
          </div>
          {uploads.transfers.map((item) => (
            <div className="upload-item" key={item.clientUploadId}>
              <div className={`upload-status ${item.status}`}>
                <Upload size={20} aria-hidden="true" />
              </div>
              <div className="upload-details">
                <span className="file-name">{item.file.name}</span>
                {item.status === "uploading" ? (
                  <>
                    <progress
                      aria-label={t("photos.fileProgress", {
                        name: item.file.name,
                      })}
                      max={100}
                      value={item.progress}
                    />
                    <span className="fine-print">
                      {item.progress === 100
                        ? t("photos.receiving")
                        : new Intl.NumberFormat(locale, {
                            style: "percent",
                          }).format(item.progress / 100)}
                    </span>
                  </>
                ) : (
                  <span
                    className={`fine-print ${item.status === "error" ? "error-text" : ""}`}
                  >
                    {item.error || t("photos.queued")}
                  </span>
                )}
              </div>
              {item.status === "error" && item.retryable && (
                <button
                  className="icon-button"
                  aria-label={t("photos.retry", { name: item.file.name })}
                  onClick={() => uploads.retryTransfer(item.clientUploadId)}
                >
                  <RotateCw size={18} />
                </button>
              )}
              {item.status !== "uploading" && (
                <button
                  className="icon-button"
                  aria-label={t("photos.removeFromQueue", {
                    name: item.file.name,
                  })}
                  onClick={() => uploads.dismiss(item.clientUploadId)}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          {uploads.jobs.map((job) => (
            <div className="upload-item" key={job.id}>
              <div
                className={`upload-status ${job.status === "ready" ? "done" : job.status === "failed" ? "error" : ""}`}
              >
                {job.status === "ready" ? (
                  <Check size={20} aria-hidden="true" />
                ) : (
                  <Upload size={20} aria-hidden="true" />
                )}
              </div>
              <div className="upload-details">
                <span className="file-name">{job.filename}</span>
                <span
                  className={`fine-print ${job.status === "failed" ? "error-text" : ""}`}
                >
                  {job.status === "ready"
                    ? t("photos.added")
                    : job.status === "failed"
                      ? responseError({ code: job.errorCode }, t)
                      : job.status === "queued"
                        ? t("photos.serverQueued")
                        : t(
                            job.kind === "video"
                              ? "photos.processingVideo"
                              : "photos.processing",
                          )}
                </span>
                {job.status === "failed" && !uploads.canRetryJob(job) && (
                  <span className="fine-print">{t("photos.reselect")}</span>
                )}
              </div>
              {uploads.canRetryJob(job) && (
                <button
                  className="icon-button"
                  aria-label={t("photos.retry", { name: job.filename })}
                  onClick={() => uploads.retryJob(job)}
                >
                  <RotateCw size={18} />
                </button>
              )}
              {(job.status === "ready" || job.status === "failed") && (
                <button
                  className="icon-button"
                  aria-label={t("photos.removeFromQueue", {
                    name: job.filename,
                  })}
                  onClick={() => uploads.dismiss(job.clientUploadId)}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          <span className="visually-hidden" role="status">
            {t(
              plurals.select(completed) === "one"
                ? "photos.addedCountOne"
                : "photos.addedCountOther",
              { count: numbers.format(completed) },
            )}
          </span>
          {active && (
            <p className="fine-print">
              {t(transmitting ? "photos.keepOpen" : "photos.safeToLeave")}
            </p>
          )}
        </section>
      )}
      <ErrorNotice message={uploads.error} />
      <ErrorNotice message={selected === null ? error : null} />
      {photos.length === 0 ? (
        <EmptyState
          icon={<Images size={36} strokeWidth={1.4} />}
          title={t("photos.emptyTitle")}
        >
          <p>{t("photos.emptyDescription")}</p>
          <button
            className="button secondary"
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={18} />
            {t("photos.choose")}
          </button>
        </EmptyState>
      ) : (
        <section aria-label={t("photos.all")}>
          <div className="section-row gallery-heading">
            <h2>{t("photos.allHeading")}</h2>
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
