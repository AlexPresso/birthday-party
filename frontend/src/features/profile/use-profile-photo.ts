"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { profileSchema } from "./contracts";
import { type Guest } from "@/features/guests/contracts";
import { useI18n } from "@/lib/i18n-context";
import { isImageType } from "@/lib/media-types";

/**
 * Validates, saves and removes the guest's profile photo for a hidden file
 * input. Profile saves a chosen file at once (`immediate`); the welcome widget
 * previews it and waits for its Save button.
 */
export function useProfilePhoto({
  imageBytes,
  onSaved,
  refreshOnSave = true,
  immediate = false,
}: {
  imageBytes: number;
  onSaved: (guest: Guest) => void;
  refreshOnSave?: boolean;
  immediate?: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
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
    if (immediate) clearSelection();
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
    previewUrl.current = immediate ? null : URL.createObjectURL(file);
    setSelection({ file, url: previewUrl.current });
    if (immediate) void save(file);
  }

  /** Saves the file, or removes the saved photo when there is none. */
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

  /** Drops the selected file and what was said about it. */
  function cancel() {
    clearSelection();
    setError(null);
    setNotice(null);
  }

  return {
    input,
    /** The size limit in megabytes, formatted for the viewer's language. */
    size,
    selection,
    pending,
    error,
    /** The finished action, for a visually hidden status. */
    notice,
    choose,
    save,
    cancel,
    setError,
  };
}
