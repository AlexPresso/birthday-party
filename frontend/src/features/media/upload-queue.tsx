"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Check, RotateCw, X } from "lucide-react";
import { responseError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useUploads } from "./upload-provider";
import { ErrorNotice } from "@/components/ui";
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
  const transmitting = transfers.some((item) => item.status !== "error");
  const active =
    transmitting ||
    jobs.some((job) => job.status === "queued" || job.status === "processing");
  const completed = jobs.filter((job) => job.status === "ready").length;
  return (
    <>
      {(transfers.length > 0 || jobs.length > 0) && (
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
          {transfers.map((item) => (
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
