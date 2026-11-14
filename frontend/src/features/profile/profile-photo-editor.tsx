"use client";

import { useId } from "react";
import { Camera, Trash2 } from "lucide-react";
import { type Guest } from "@/features/guests/contracts";
import { useI18n } from "@/lib/i18n-context";
import { imageAccept } from "@/lib/media-types";
import { ErrorNotice } from "@/components/ui";
import { useProfilePhoto } from "./use-profile-photo";
import "./profile-photo-editor.css";

/** The welcome widget's editor: choose a photo, preview it, then save it. */
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
  const { t } = useI18n();
  const id = useId();
  const {
    input,
    size,
    selection,
    pending,
    error,
    notice,
    choose,
    save,
    cancel,
    setError,
  } = useProfilePhoto({ imageBytes, onSaved, refreshOnSave });

  return (
    <div
      className="profile-photo-editor"
      role="group"
      aria-labelledby={`${id}-title`}
      aria-busy={pending !== null}
    >
      <h3 id={`${id}-title`}>
        <Camera size={19} aria-hidden="true" />
        {t("profile.photo")}
      </h3>
      <p className="fine-print" id={`${id}-hint`}>
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
      {selection?.url && (
        <div className="profile-photo-preview">
          <img
            src={selection.url}
            alt={t("profile.preview")}
            width={112}
            height={112}
            onError={() => setError(t("errors.unreadable_photo"))}
          />
        </div>
      )}
      <div className="profile-photo-actions">
        <button
          type="button"
          className="button secondary"
          disabled={pending !== null}
          aria-describedby={`${id}-hint`}
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
              onClick={() => save(selection.file)}
            >
              {t(pending === "save" ? "profile.saving" : "profile.save")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending !== null}
              onClick={cancel}
            >
              {t("profile.cancel")}
            </button>
          </>
        ) : avatarUrl ? (
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
      {/* The avatar shows the result; only screen readers are told. */}
      <p className="visually-hidden" role="status">
        {notice}
      </p>
    </div>
  );
}
