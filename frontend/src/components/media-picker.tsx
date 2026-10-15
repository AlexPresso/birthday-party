"use client";

import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Images } from "lucide-react";
import type { UploadLimits } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n-context";
import { useUploads, type UploadDestination } from "./upload-provider";
import { ErrorNotice } from "./ui";
import "./media-picker.css";

export function MediaPicker({
  limits,
  destination,
  children,
}: {
  limits: UploadLimits;
  destination: UploadDestination;
  children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const uploads = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const numbers = new Intl.NumberFormat(locale);
  return (
    <div className="media-picker">
      <button
        className="button primary upload-button"
        type="button"
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={20} aria-hidden="true" />
        {t("photos.add")}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        aria-label={t("photos.add")}
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files) {
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
      {children}
      <p className="photo-privacy">
        <Images size={15} aria-hidden="true" />
        {t("photos.privacy", {
          imageSize: numbers.format(limits.imageBytes / (1024 * 1024)),
          videoSize: numbers.format(limits.videoBytes / (1024 * 1024)),
        })}
      </p>
      <ErrorNotice message={error} />
    </div>
  );
}
