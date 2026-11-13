"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronRight, Image as ImageIcon, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { profileSchema } from "./contracts";
import { type Guest } from "@/features/guests/contracts";
import { useI18n } from "@/lib/i18n-context";
import { imageAccept, isImageType } from "@/lib/media-types";
import { ErrorNotice } from "@/components/ui";
import "./profile-photo-editor.css";

export function ProfilePhotoEditor({
  avatarUrl,
  imageBytes,
  onSaved,
  refreshOnSave = true,
  variant = "widget",
  afterEditor,
}: {
  avatarUrl: string | null;
  imageBytes: number;
  onSaved: (guest: Guest) => void;
  refreshOnSave?: boolean;
  variant?: "widget" | "profile";
  afterEditor?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState<{
    file: File;
    url: string | null;
  } | null>(null);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const size = new Intl.NumberFormat(locale).format(imageBytes / 1024 / 1024);
  const profileLayout = variant === "profile";
  const showHint = !profileLayout || error !== null;

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      request.current?.abort();
    },
    [],
  );

  function clearSelection() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setSelection(null);
    if (input.current) input.current.value = "";
  }

  function choose(file: File | undefined) {
    if (!file || request.current) return;
    if (profileLayout) clearSelection();
    setNotice(null);
    setError(null);
    // Reset the native input so selecting the same file can retry validation.
    if (input.current) input.current.value = "";
    if (!isImageType(file.type)) {
      setError(t("errors.unsupported_profile_photo_type"));
      return;
    }
    if (!file.size) {
      setError(t("errors.upload_empty"));
      return;
    }
    if (file.size > imageBytes) {
      setError(t("errors.upload_size", { size }));
      return;
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = profileLayout ? null : URL.createObjectURL(file);
    setSelection({ file, url: previewUrl.current });
    if (profileLayout) void save(file);
  }

  async function save(file: File | null) {
    if (request.current) return;
    const remove = file === null;
    if (remove) clearSelection();
    const controller = new AbortController();
    request.current = controller;
    setPending(remove ? "remove" : "save");
    setError(null);
    setNotice(null);
    const body = new FormData();
    if (file) body.append("file", file);
    try {
      const result = await api("/profile/avatar", profileSchema, {
        method: remove ? "DELETE" : "PUT",
        body: remove ? undefined : body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      onSaved(result.guest);
      clearSelection();
      setNotice(t(remove ? "profile.removed" : "profile.saved"));
      if (refreshOnSave) router.refresh();
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err, t));
    } finally {
      if (!controller.signal.aborted) setPending(null);
      request.current = null;
    }
  }

  return (
    <>
      <div
        className={`profile-photo-editor${profileLayout ? " profile-photo-editor-profile" : ""}`}
        role="group"
        aria-labelledby={`${id}-title`}
        aria-busy={pending !== null}
      >
        <h3
          id={`${id}-title`}
          className={profileLayout ? "visually-hidden" : undefined}
        >
          <Camera size={19} aria-hidden="true" />
          {t("profile.photo")}
        </h3>
        <p
          className={showHint ? "fine-print" : "visually-hidden"}
          id={`${id}-hint`}
        >
          {t("profile.formats", { size })}
        </p>
        <input
          ref={input}
          type="file"
          accept={imageAccept}
          aria-label={t("profile.photo")}
          aria-describedby={`${id}-hint`}
          disabled={pending !== null}
          hidden
          onChange={(event) => choose(event.target.files?.[0])}
        />
        {selection?.url && !profileLayout && (
          <div className="profile-photo-preview">
            <img
              src={selection.url}
              alt={t("profile.preview")}
              width={112}
              height={112}
              onError={() => setError(t("errors.unreadable_photo"))}
            />
            <p className="fine-print">{t("profile.cropHint")}</p>
          </div>
        )}
        <div className="profile-photo-actions">
          <button
            type="button"
            className="button secondary profile-photo-select"
            disabled={pending !== null}
            aria-describedby={`${id}-hint`}
            onClick={() => input.current?.click()}
          >
            <Camera size={17} aria-hidden="true" />
            {t(
              profileLayout && pending === "save"
                ? "profile.saving"
                : avatarUrl || selection
                  ? "profile.change"
                  : "profile.choose",
            )}
          </button>
          {profileLayout && selection && error && pending === null && (
            <button
              type="button"
              className="text-button"
              onClick={() => save(selection.file)}
            >
              {t("common.retry")}
            </button>
          )}
          {selection && !profileLayout ? (
            <>
              <button
                type="button"
                className="button primary"
                disabled={pending !== null}
                onClick={() => save(selection.file)}
              >
                {t(pending === "save" ? "profile.saving" : "profile.save")}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={pending !== null}
                onClick={() => {
                  clearSelection();
                  setError(null);
                  setNotice(null);
                }}
              >
                {t("profile.cancel")}
              </button>
            </>
          ) : avatarUrl && !profileLayout ? (
            <button
              type="button"
              className="text-button"
              disabled={pending !== null}
              onClick={() => save(null)}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t(pending === "remove" ? "profile.removing" : "profile.remove")}
            </button>
          ) : null}
        </div>
        <ErrorNotice message={error} />
        <p
          className={
            profileLayout && pending === "save"
              ? "visually-hidden"
              : "success-notice"
          }
          role="status"
        >
          {profileLayout && pending === "save" ? t("profile.saving") : notice}
        </p>
      </div>
      {afterEditor}
      {profileLayout && (
        <div className="profile-photo-row">
          <ImageIcon size={25} strokeWidth={1.6} aria-hidden="true" />
          <span>{t("profile.myPhoto")}</span>
          {avatarUrl ? (
            <button
              type="button"
              className="text-button profile-photo-remove"
              disabled={pending !== null}
              onClick={() => save(null)}
              aria-label={t(
                pending === "remove" ? "profile.removing" : "profile.remove",
              )}
            >
              {t(
                pending === "remove"
                  ? "profile.removing"
                  : "profile.removeAction",
              )}
              <ChevronRight size={19} strokeWidth={1.6} aria-hidden="true" />
            </button>
          ) : (
            <span className="profile-photo-empty">{t("profile.empty")}</span>
          )}
        </div>
      )}
    </>
  );
}
