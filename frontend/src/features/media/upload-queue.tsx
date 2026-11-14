"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import { usePathname } from "next/navigation";
import { Upload, Check, RotateCw, X, ChevronUp } from "lucide-react";
import { responseError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useUploads, type Transfer } from "./upload-provider";
import type { UploadJob } from "./contracts";
import { uploadProgress } from "./upload-progress";
import { ErrorNotice } from "@/components/ui";
import "./upload-queue.css";

/**
 * One pill per visible queue: a progress ring, a short text and a chevron.
 * Pressing it opens the per-file details in a modal sheet.
 */
export function UploadQueue({ widgetIndex }: { widgetIndex?: number } = {}) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const sheetId = useId();
  const container = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  // The burst is for a batch this queue showed in progress, not a restored one.
  const [progressShown, setProgressShown] = useState(false);
  const [celebrated, setCelebrated] = useState("");
  const [bursting, setBursting] = useState(false);
  const numbers = new Intl.NumberFormat(locale);
  const plurals = new Intl.PluralRules(locale);
  const uploads = useUploads();
  const transfers =
    widgetIndex === undefined
      ? uploads.transfers
      : uploads.transfers.filter(
          (item) => item.welcomeWidgetIndex === widgetIndex,
        );
  const jobs =
    widgetIndex === undefined
      ? uploads.jobs
      : uploads.jobs.filter((job) => job.welcomeWidgetIndex === widgetIndex);
  const { pendingTransfers, sent, total, percent } = uploadProgress(
    transfers,
    jobs,
  );
  const sentCount = t(
    plurals.select(total) === "one"
      ? "photos.sentCountOne"
      : "photos.sentCountOther",
    { sent: numbers.format(sent), total: numbers.format(total) },
  );
  const transmitting = pendingTransfers.some((item) => item.status !== "error");
  const active =
    transmitting ||
    jobs.some((job) => job.status === "queued" || job.status === "processing");
  const failed =
    pendingTransfers.filter((item) => item.status === "error").length +
    jobs.filter((job) => job.status === "failed").length;
  const complete = total > 0 && !active && failed === 0;
  const state = failed
    ? "error"
    : complete
      ? "complete"
      : transmitting
        ? "sending"
        : "preparing";
  const title = failed
    ? t(
        plurals.select(failed) === "one"
          ? "photos.uploadFailedOne"
          : "photos.uploadFailedOther",
        { count: numbers.format(failed) },
      )
    : complete
      ? t(
          plurals.select(total) === "one"
            ? "photos.uploadCompleteOne"
            : "photos.uploadCompleteOther",
          { count: numbers.format(total) },
        )
      : t(transmitting ? "photos.uploadSending" : "photos.uploadPreparing");
  const preview =
    pendingTransfers
      .map((item) => uploads.previewUrl(item.clientUploadId))
      .find(Boolean) ??
    jobs
      .map(
        (job) =>
          uploads.previewUrl(job.clientUploadId) ?? job.photo?.thumbnailUrl,
      )
      .find(Boolean);
  const retryableTransfers = pendingTransfers.filter(
    (item) => item.status === "error" && item.retryable,
  );
  const retryableJobs = jobs.filter(uploads.canRetryJob);
  const completedBatch = complete
    ? jobs
        .map((job) => job.clientUploadId)
        .sort()
        .join(",")
    : "";
  if (total === 0) {
    if (open || focused || progressShown || bursting) {
      setOpen(false);
      setFocused(false);
      setProgressShown(false);
      setBursting(false);
    }
  } else if (!complete) {
    if (!progressShown || bursting) {
      setProgressShown(true);
      setBursting(false);
    }
  } else if (progressShown) {
    // A batch has one burst, even when a removed failure completes it again.
    setProgressShown(false);
    setBursting(
      completedBatch !== celebrated &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    setCelebrated(completedBatch);
  }
  const dismiss = useRef(uploads.dismiss);
  useLayoutEffect(() => {
    dismiss.current = uploads.dismiss;
  }, [uploads.dismiss]);

  useEffect(() => {
    if (!completedBatch || open || uploads.error) return;
    // A completed request may remove a focused retry button without a blur event.
    if (focused && container.current?.contains(document.activeElement)) return;
    let departure: Animation | undefined;
    const timer = window.setTimeout(() => {
      const finish = () => {
        for (const id of completedBatch.split(",")) dismiss.current(id);
      };
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
      }
      departure = container.current?.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(6px)" },
        ],
        { duration: 180, easing: "ease-out", fill: "forwards" },
      );
      if (departure) departure.onfinish = finish;
      else finish();
    }, 2000);
    return () => {
      window.clearTimeout(timer);
      departure?.cancel();
    };
  }, [completedBatch, open, focused, uploads.error]);

  const showError =
    widgetIndex === undefined && (total > 0 || pathname === "/photos");
  return (
    <div
      className={widgetIndex === undefined ? "upload-overlay" : "upload-inline"}
    >
      {total > 0 && (
        <section
          ref={container}
          className="upload-queue"
          data-state={state}
          aria-label={t("photos.uploadQueue")}
          onFocusCapture={(event) =>
            setFocused(event.target.matches(":focus-visible"))
          }
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setFocused(false);
          }}
        >
          <div className="upload-pill">
            <div className="upload-pill-main">
              <button
                ref={toggle}
                type="button"
                className="upload-pill-toggle"
                aria-label={t("photos.uploadDetails")}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? sheetId : undefined}
                onClick={() => setOpen(true)}
              />
              {complete ? (
                <span className="upload-ring" aria-hidden="true">
                  <span className="upload-ring-core">
                    <Check size={20} strokeWidth={2.6} />
                  </span>
                  {bursting && <Burst />}
                </span>
              ) : (
                <span
                  className="upload-ring"
                  role="progressbar"
                  aria-label={t("photos.uploadProgress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                  aria-valuetext={sentCount}
                >
                  <svg viewBox="0 0 34 34" aria-hidden="true" focusable="false">
                    <circle
                      className="upload-ring-track"
                      cx="17"
                      cy="17"
                      r="15.5"
                    />
                    {/* Preparation has no measure: a short arc turns instead. */}
                    {(state === "preparing" || percent > 0) && (
                      <circle
                        className="upload-ring-arc"
                        cx="17"
                        cy="17"
                        r="15.5"
                        pathLength={100}
                        strokeDasharray={state === "preparing" ? "24 76" : 100}
                        strokeDashoffset={
                          state === "preparing" ? 0 : 100 - percent
                        }
                      />
                    )}
                  </svg>
                  <span className="upload-ring-core" aria-hidden="true">
                    {failed ? (
                      <svg
                        className="upload-ring-alert"
                        viewBox="0 0 24 24"
                        width={18}
                        height={18}
                        focusable="false"
                      >
                        <path d="M12 6v7" />
                        <path d="M12 17.5h.01" />
                      </svg>
                    ) : preview ? (
                      <img src={preview} alt="" width={24} height={24} />
                    ) : (
                      <Upload size={14} />
                    )}
                  </span>
                </span>
              )}
              <span
                className={
                  state === "sending"
                    ? "upload-pill-text upload-pill-count"
                    : "upload-pill-text"
                }
              >
                {state === "sending"
                  ? `${numbers.format(sent)} / ${numbers.format(total)}`
                  : title}
              </span>
              <ChevronUp
                className="upload-pill-chevron"
                size={16}
                aria-hidden="true"
              />
            </div>
            {(retryableTransfers.length > 0 || retryableJobs.length > 0) && (
              <button
                type="button"
                className="text-button upload-retry"
                onClick={() => {
                  toggle.current?.focus();
                  retryableTransfers.forEach((item) =>
                    uploads.retryTransfer(item.clientUploadId),
                  );
                  retryableJobs.forEach((job) => uploads.retryJob(job));
                }}
              >
                {t("common.retry")}
              </button>
            )}
          </div>
          <span className="visually-hidden" role="status" aria-atomic="true">
            {title}
            {complete ? "" : `. ${sentCount}`}
          </span>
          {open && (
            <UploadSheet
              id={sheetId}
              centered={widgetIndex !== undefined}
              opener={toggle}
              pendingTransfers={pendingTransfers}
              jobs={jobs}
              hint={
                active
                  ? t(transmitting ? "photos.keepOpen" : "photos.safeToLeave")
                  : null
              }
              onClose={() => setOpen(false)}
            />
          )}
        </section>
      )}
      {showError && <UploadQueueError />}
    </div>
  );
}

// Where each particle ends, in pixels from the ring's center: up and outward.
const burstParticles = [
  { x: -28, y: -5, size: 4, tone: "" },
  { x: -32, y: -17, size: 3, tone: "warm" },
  { x: -18, y: -20, size: 5, tone: "" },
  { x: -16, y: -34, size: 3, tone: "accent" },
  { x: -4, y: -30, size: 4, tone: "warm" },
  { x: 7, y: -39, size: 3, tone: "" },
  { x: 13, y: -26, size: 5, tone: "accent" },
  { x: 25, y: -27, size: 3, tone: "" },
  { x: 25, y: -16, size: 4, tone: "warm" },
  { x: 33, y: -11, size: 3, tone: "" },
];

/** A short burst of the snowfall's particles when a batch completes. */
function Burst() {
  return (
    <span className="upload-burst" aria-hidden="true">
      {burstParticles.map(({ x, y, size, tone }, index) => (
        <span
          key={index}
          className={tone ? `upload-burst-${tone}` : undefined}
          style={
            {
              width: `${size}px`,
              height: `${size}px`,
              animationDelay: `${(index % 4) * 40}ms`,
              "--burst-x": `${x}px`,
              "--burst-y": `${y}px`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/**
 * The per-file details: a modal sheet rising from the bottom on phones, a
 * compact dialog from 960px. It follows the question composer's sheet, plus a
 * drag on the header to pull it down.
 */
function UploadSheet({
  id,
  centered,
  opener,
  pendingTransfers,
  jobs,
  hint,
  onClose,
}: {
  id: string;
  centered: boolean;
  opener: RefObject<HTMLButtonElement | null>;
  pendingTransfers: Transfer[];
  jobs: UploadJob[];
  hint: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; start: number; offset: number }>(null);
  const leaving = useRef<number>(undefined);

  useEffect(() => {
    const modal = dialog.current!;
    const launcher = opener.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    closeButton.current?.focus();
    return () => {
      window.clearTimeout(leaving.current);
      modal.close();
      document.body.style.overflow = overflow;
      launcher?.focus({ preventScroll: true });
    };
  }, [opener]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button"))
      return;
    // The desktop dialog floats above the dock and is not pulled down.
    if (window.matchMedia("(min-width: 960px)").matches) return;
    drag.current = {
      pointer: event.pointerId,
      start: event.clientY,
      offset: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    dialog.current!.style.transition = "none";
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    current.offset = Math.max(0, event.clientY - current.start);
    dialog.current!.style.transform = `translateY(${current.offset}px)`;
  }
  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    drag.current = null;
    const modal = dialog.current!;
    modal.style.transition = "";
    if (cancelled || current.offset < Math.min(96, modal.offsetHeight / 3)) {
      modal.style.transform = "";
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    modal.style.transform = "translateY(100%)";
    leaving.current = window.setTimeout(onClose, 180);
  }

  return (
    <dialog
      ref={dialog}
      id={id}
      className="upload-sheet"
      data-centered={centered || undefined}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div
        className="upload-sheet-header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        <span className="upload-sheet-handle" aria-hidden="true" />
        <h2 id={titleId}>{t("photos.uploadDetails")}</h2>
        <button
          ref={closeButton}
          type="button"
          className="icon-button"
          aria-label={t("photos.uploadHideDetails")}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="upload-sheet-list">
        <UploadItems
          pendingTransfers={pendingTransfers}
          jobs={jobs}
          onAction={() => closeButton.current?.focus()}
        />
      </div>
      {hint && <p className="fine-print">{hint}</p>}
    </dialog>
  );
}

function UploadItems({
  pendingTransfers,
  jobs,
  onAction,
}: {
  pendingTransfers: Transfer[];
  jobs: UploadJob[];
  onAction: () => void;
}) {
  const { t } = useI18n();
  const uploads = useUploads();
  return (
    <>
      {pendingTransfers.map((item) => (
        <div className="upload-item" key={item.clientUploadId}>
          <div className={`upload-status ${item.status}`}>
            <Upload size={20} aria-hidden="true" />
          </div>
          <div className="upload-details">
            <span className="file-name">{item.file.name}</span>
            <span
              className={`fine-print ${item.status === "error" ? "error-text" : ""}`}
            >
              {item.status === "uploading"
                ? t(
                    item.progress === 100
                      ? "photos.receiving"
                      : "photos.uploading",
                  )
                : item.error || t("photos.queued")}
            </span>
          </div>
          {item.status === "error" && item.retryable && (
            <button
              className="icon-button"
              aria-label={t("photos.retry", { name: item.file.name })}
              onClick={() => {
                onAction();
                uploads.retryTransfer(item.clientUploadId);
              }}
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
              onClick={() => {
                onAction();
                uploads.dismiss(item.clientUploadId);
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      ))}
      {jobs.map((job) => (
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
                ? t(job.photo ? "photos.added" : "categories.privateReady")
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
              onClick={() => {
                onAction();
                uploads.retryJob(job);
              }}
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
              onClick={() => {
                onAction();
                uploads.dismiss(job.clientUploadId);
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      ))}
    </>
  );
}

export function UploadQueueError() {
  const { error, refresh } = useUploads();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!error) return null;
  return (
    <div
      className="upload-error"
      role="group"
      aria-label={t("photos.uploadQueue")}
    >
      <ErrorNotice message={error} />
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refresh().finally(() => {
            if (mounted.current) setBusy(false);
          });
        }}
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
