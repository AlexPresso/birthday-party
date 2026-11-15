"use client";
import { useI18n } from "@/lib/i18n-context";
import type { Storage } from "./contracts";
import "./storage-usage.css";

/** Formats a disk size in gigabytes, or megabytes below one. */
export function formatStorage(bytes: number, locale: string) {
  const gigabytes = bytes / 2 ** 30;
  const [value, unit] =
    gigabytes >= 1 ? [gigabytes, "gigabyte"] : [bytes / 2 ** 20, "megabyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export function StorageUsage({ storage }: { storage: Storage }) {
  const { t, locale } = useI18n();
  const usedBytes = storage.totalBytes - storage.availableBytes;
  const percent = Math.round((usedBytes / storage.totalBytes) * 100);
  const used = t("storage.used", {
    used: formatStorage(usedBytes, locale),
    total: formatStorage(storage.totalBytes, locale),
  });
  return (
    <div
      className="storage-usage panel"
      data-warning={storage.warning || undefined}
    >
      <div
        className="storage-bar"
        role="meter"
        aria-label={t("storage.meter")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={used}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="storage-figures">
        <span>{used}</span>
        <span>
          {t("storage.available", {
            available: formatStorage(storage.availableBytes, locale),
          })}
        </span>
      </p>
      {storage.warning ? (
        <p className="storage-warning">{t("storage.warning")}</p>
      ) : null}
    </div>
  );
}
