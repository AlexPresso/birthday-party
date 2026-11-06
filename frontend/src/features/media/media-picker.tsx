"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ImagePlus, Images, Plus } from "lucide-react";
import type { UploadLimits } from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import { useUploads, type UploadDestination } from "./upload-provider";
import { ErrorNotice } from "@/components/ui";
import "./media-picker.css";

export function MediaPicker({
  limits,
  destination,
  children,
  compact = false,
}: {
  limits: UploadLimits;
  destination: UploadDestination;
  children?: ReactNode;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const uploads = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const guidanceId = useId();
  const [error, setError] = useState<string | null>(null);
  const numbers = new Intl.NumberFormat(locale);
  return (
    <div className={`media-picker${compact ? " media-picker-compact" : ""}`}>
      <button
        className="button primary upload-button"
        type="button"
        onClick={() => input.current?.click()}
        aria-describedby={guidanceId}
      >
        {compact ? (
          <Plus size={18} aria-hidden="true" />
        ) : (
          <ImagePlus size={20} aria-hidden="true" />
        )}
        {compact ? (
          <>
            <span aria-hidden="true">{t("photos.addShort")}</span>
            <span className="visually-hidden">{t("photos.add")}</span>
          </>
        ) : (
          t("photos.add")
        )}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        aria-label={t("photos.add")}
        aria-describedby={guidanceId}
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files?.length) {
            setError(
              uploads.addFiles(
                Array.from(event.target.files),
                limits,
                destination,
              )
                ? t("photos.selectionLimit")
                : null,
            );
            event.target.value = "";
          }
        }}
      />
      <div
        id={guidanceId}
        className={compact ? "visually-hidden" : "media-picker-guidance"}
      >
        {children}
        <p className="photo-privacy">
          <Images size={15} aria-hidden="true" />
          {t("photos.privacy", {
            imageSize: numbers.format(limits.imageBytes / (1024 * 1024)),
            videoSize: numbers.format(limits.videoBytes / (1024 * 1024)),
          })}
        </p>
      </div>
      <ErrorNotice message={error} />
    </div>
  );
}
