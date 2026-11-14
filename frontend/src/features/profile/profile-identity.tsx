"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { type Guest } from "@/features/guests/contracts";
import { useI18n } from "@/lib/i18n-context";
import { imageAccept } from "@/lib/media-types";
import { Avatar } from "@/components/avatar";
import { ErrorNotice } from "@/components/ui";
import { useProfilePhoto } from "./use-profile-photo";

/**
 * The top of Profile: the photo, which is the button of its own menu, and the
 * guest's name as the page heading. Choosing a file saves it at once.
 */
export function ProfileIdentity({
  guest,
  imageBytes,
}: {
  guest: Guest;
  imageBytes: number;
}) {
  const { t } = useI18n();
  const id = useId();
  // The saved photo shows before the refreshed route brings it back.
  const [photo, setPhoto] = useState({
    source: guest.avatarUrl,
    url: guest.avatarUrl,
  });
  if (photo.source !== guest.avatarUrl) {
    setPhoto({ source: guest.avatarUrl, url: guest.avatarUrl });
  }
  const { input, size, selection, pending, error, notice, choose, save } =
    useProfilePhoto({
      imageBytes,
      immediate: true,
      onSaved: (updated) =>
        setPhoto((current) => ({ ...current, url: updated.avatarUrl })),
    });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    // A press anywhere else closes the menu, even where it moves no focus.
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  /** Closes the menu and keeps the keyboard on the photo. */
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const targets: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    items[(target + items.length) % items.length]?.focus();
  }

  return (
    <header className="profile-identity" aria-busy={busy}>
      <div
        ref={root}
        className="profile-photo"
        data-busy={busy || undefined}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          close();
        }}
        onBlur={(event) => {
          // Tabbing away closes the menu. Without a next element the focus
          // left with a press, which the listener above already judged.
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            setOpen(false);
        }}
      >
        <button
          ref={trigger}
          type="button"
          id={`${id}-trigger`}
          className="profile-photo-trigger"
          aria-label={t("profile.photo")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          // Stays focusable during a request, so the keyboard keeps its place.
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" || busy || open) return;
            event.preventDefault();
            setOpen(true);
          }}
        >
          <Avatar name={guest.name} avatarUrl={photo.url} className="large" />
          <span className="profile-photo-camera" aria-hidden="true">
            <Camera size={18} />
          </span>
        </button>
        {open && (
          <div ref={menu} className="profile-photo-menu" onKeyDown={moveFocus}>
            <div
              id={`${id}-menu`}
              role="menu"
              aria-labelledby={`${id}-trigger`}
            >
              <button
                type="button"
                role="menuitem"
                aria-describedby={`${id}-formats`}
                onClick={() => {
                  close();
                  input.current?.click();
                }}
              >
                <ImagePlus size={17} aria-hidden="true" />
                {t("profile.choose")}
              </button>
              {photo.url && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    close();
                    void save(null);
                  }}
                >
                  <Trash2 size={17} aria-hidden="true" />
                  {t("profile.remove")}
                </button>
              )}
            </div>
            <p className="fine-print" id={`${id}-formats`}>
              {t("profile.formats", { size })}
            </p>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept={imageAccept}
          aria-label={t("profile.photo")}
          disabled={busy}
          hidden
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      <h1>{guest.name}</h1>
      <ErrorNotice message={error} />
      {selection && error && !busy && (
        <button
          type="button"
          className="text-button"
          onClick={() => void save(selection.file)}
        >
          {t("common.retry")}
        </button>
      )}
      {/* The photo shows the result; only screen readers are told. */}
      <p className="visually-hidden" role="status">
        {pending === "save"
          ? t("profile.saving")
          : pending === "remove"
            ? t("profile.removing")
            : notice}
      </p>
    </header>
  );
}
