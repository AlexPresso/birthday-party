"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { profileSchema, type Guest } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n-context";
import { ErrorNotice } from "./ui";
import "./profile-photo-editor.css";

export function ProfilePhotoEditor({
  avatarUrl,
  imageBytes,
  onSaved,
  refreshOnSave = true,
}: {
  avatarUrl: string | null;
  imageBytes: number;
  onSaved: (guest: Guest) => void;
  refreshOnSave?: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const size = new Intl.NumberFormat(locale).format(imageBytes / 1024 / 1024);

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
    if (!file) return;
    setNotice(null);
    setError(null);
    // Reset the native input so selecting the same file can retry validation.
    if (input.current) input.current.value = "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
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
    previewUrl.current = URL.createObjectURL(file);
    setSelection({ file, url: previewUrl.current });
  }

  async function save(remove = false) {
    if (pending || (!remove && !selection)) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(remove ? "remove" : "save");
    setError(null);
    setNotice(null);
    const body = new FormData();
    if (selection) body.append("file", selection.file);
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
      setPending(null);
      request.current = null;
    }
  }

  return (
    <div
      className="profile-photo-editor"
      role="group"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`}>{t("profile.photo")}</h3>
      <p className="fine-print" id={`${id}-hint`}>
        {t("profile.formats", { size })}
      </p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={t("profile.photo")}
        aria-describedby={`${id}-hint`}
        disabled={pending !== null}
        hidden
        onChange={(event) => choose(event.target.files?.[0])}
      />
      {selection && (
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
          className="button secondary"
          disabled={pending !== null}
          onClick={() => input.current?.click()}
        >
          <Camera size={17} aria-hidden="true" />
          {t(avatarUrl || selection ? "profile.change" : "profile.choose")}
        </button>
        {selection ? (
          <>
            <button
              type="button"
              className="button primary"
              disabled={pending !== null}
              onClick={() => save()}
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
        ) : avatarUrl ? (
          <button
            type="button"
            className="text-button"
            disabled={pending !== null}
            onClick={() => save(true)}
          >
            <Trash2 size={16} aria-hidden="true" />
            {t(pending === "remove" ? "profile.removing" : "profile.remove")}
          </button>
        ) : null}
      </div>
      <ErrorNotice message={error} />
      <p className="success-notice" role="status">
        {notice}
      </p>
    </div>
  );
}
