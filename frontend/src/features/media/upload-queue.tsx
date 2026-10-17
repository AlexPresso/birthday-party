"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Check, RotateCw, X } from "lucide-react";
import { responseError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useUploads } from "./upload-provider";
import { uploadProgress } from "./upload-progress";
import { ErrorNotice } from "@/components/ui";
import "./upload-queue.css";
export function UploadQueue({ widgetIndex }: { widgetIndex?: number } = {}) {
  const { locale, t } = useI18n();
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
  const completed = jobs.filter((job) => job.status === "ready").length;
  return (
    <>
      {total > 0 && (
        <section
          className="upload-queue panel"
          aria-label={t("photos.uploadQueue")}
        >
          <div className="section-row">
            <h2>{t(active ? "photos.uploading" : "photos.uploads")}</h2>
            {!active && (
              <button
                className="text-button"
                onClick={() => uploads.clearFinished(widgetIndex)}
              >
                {t("photos.close")}
              </button>
            )}
          </div>
          <div className="upload-progress-summary">
            <p
              className="upload-progress-count"
              role="status"
              aria-atomic="true"
            >
              {sentCount}
            </p>
            <progress
              aria-label={t("photos.uploadProgress")}
              aria-valuetext={sentCount}
              max={100}
              value={percent}
            />
          </div>
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
      {widgetIndex === undefined && <UploadQueueError />}
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
