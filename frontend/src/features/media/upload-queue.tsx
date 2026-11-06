"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Upload,
  Check,
  RotateCw,
  X,
  ChevronRight,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import { responseError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useUploads, type Transfer } from "./upload-provider";
import type { UploadJob } from "./contracts";
import { uploadProgress } from "./upload-progress";
import { ErrorNotice } from "@/components/ui";
import "./upload-queue.css";
export function UploadQueue({ widgetIndex }: { widgetIndex?: number } = {}) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const detailsId = useId();
  const container = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeDetails = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
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
  if (total === 0 && (expanded || focused)) {
    setExpanded(false);
    setFocused(false);
  }
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
  const dismiss = useRef(uploads.dismiss);
  useLayoutEffect(() => {
    dismiss.current = uploads.dismiss;
  }, [uploads.dismiss]);

  useEffect(() => {
    if (!completedBatch || expanded || uploads.error) return;
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
  }, [completedBatch, expanded, focused, uploads.error]);

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
          <div
            className="upload-queue-details"
            id={detailsId}
            hidden={!expanded}
          >
            <div className="section-row">
              <h2>{t("photos.uploadDetails")}</h2>
              <button
                ref={closeDetails}
                type="button"
                className="icon-button"
                aria-label={t("photos.uploadHideDetails")}
                onClick={() => {
                  setExpanded(false);
                  toggle.current?.focus();
                }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <UploadItems
              pendingTransfers={pendingTransfers}
              jobs={jobs}
              onAction={() => closeDetails.current?.focus()}
            />
            {active && (
              <p className="fine-print">
                {t(transmitting ? "photos.keepOpen" : "photos.safeToLeave")}
              </p>
            )}
          </div>
          <div className="upload-banner">
            <div className="upload-banner-main">
              <button
                ref={toggle}
                type="button"
                className="upload-banner-toggle"
                aria-label={t("photos.uploadDetails")}
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => {
                  setExpanded(!expanded);
                  if (!expanded)
                    requestAnimationFrame(() => closeDetails.current?.focus());
                }}
              />
              <span
                className={`upload-preview ${complete ? "done" : failed ? "error" : ""}`}
                aria-hidden="true"
              >
                {complete ? (
                  <Check size={24} />
                ) : failed ? (
                  <AlertCircle size={24} />
                ) : preview ? (
                  <img src={preview} alt="" width={40} height={40} />
                ) : (
                  <ImageIcon size={24} />
                )}
              </span>
              <span className="upload-banner-content">
                <strong>{title}</strong>
                {!complete && (
                  <>
                    <span className="upload-progress-count">{sentCount}</span>
                    <progress
                      aria-label={t("photos.uploadProgress")}
                      aria-valuetext={sentCount}
                      max={100}
                      value={percent}
                    />
                  </>
                )}
              </span>
              <ChevronRight
                className="upload-banner-chevron"
                size={19}
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
        </section>
      )}
      {showError && <UploadQueueError />}
    </div>
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
