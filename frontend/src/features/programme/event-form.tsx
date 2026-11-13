"use client";

import type { FocusEventHandler } from "react";
import { X } from "lucide-react";
import { ErrorNotice } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "../guests/contracts";
import type { PartyEvent } from "./contracts";
import { frozenVote, type EventDraft } from "./event-draft";
import { VoteEditor } from "./vote-editor";

/** The editor of one event draft; its owner saves on blur and on submit. */
export function EventForm({
  draft,
  saved,
  guests,
  timezone,
  zone,
  busy,
  error,
  voteEditorKey,
  onChange,
  onBlur,
  onSubmit,
  onOverwrite,
  onClose,
}: {
  draft: EventDraft;
  /** The latest known version of the event being edited, if it exists yet. */
  saved: PartyEvent | undefined;
  guests: Guest[];
  timezone: string;
  /** The browser's timezone, in which the date inputs are expressed. */
  zone: string;
  busy: boolean;
  /**
   * Shown below the fields: above them, appearing on blur would push the form
   * down between a press and its click, so the first click on Close missed.
   */
  error: string | null;
  voteEditorKey: number;
  /** `commit` asks for an immediate save, for controls that never blur. */
  onChange: (changes: Partial<EventDraft>, commit?: boolean) => void;
  onBlur: FocusEventHandler<HTMLElement>;
  onSubmit: () => void;
  /** Replaces the newer saved version with this draft. */
  onOverwrite: (event: PartyEvent) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const frozen = frozenVote(saved);
  const activeIds = new Set(
    guests.filter((guest) => guest.active).map((guest) => guest.id),
  );
  const candidateIds =
    draft.vote?.candidateIds.filter((id) => frozen || activeIds.has(id)) ?? [];

  return (
    <form
      className="event-editor"
      onBlur={onBlur}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="section-row">
        <h3>
          {draft.id
            ? t("admin.editEvent")
            : draft.type === "vote"
              ? t("activities.voteType")
              : draft.type === "questions"
                ? t("questions.name")
                : t("admin.newEvent")}
        </h3>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label={t("autosave.close")}
        >
          <X size={18} />
        </button>
      </div>
      {saved && saved.revision !== draft.revision && (
        <>
          <p className="fine-print" role="status">
            {t("activities.conflict")}
          </p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onOverwrite(saved)}
          >
            {t("activities.overwrite")}
          </button>
        </>
      )}
      <fieldset className="event-editor-fields" disabled={busy}>
        <label htmlFor="event-title">{t("admin.eventTitle")}</label>
        <input
          id="event-title"
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          maxLength={160}
          required
          autoFocus
        />
        {draft.vote && (
          <VoteEditor
            key={voteEditorKey}
            draft={{ ...draft.vote, candidateIds }}
            frozen={Boolean(frozen)}
            guests={guests}
            busy={busy}
            onChange={(vote, commit) => onChange({ vote }, commit)}
          />
        )}
        <label htmlFor="event-description">{t("admin.eventDetails")}</label>
        <textarea
          id="event-description"
          rows={3}
          maxLength={4000}
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <label htmlFor="event-teaser">{t("admin.teaser")}</label>
        <input
          id="event-teaser"
          value={draft.teaser}
          maxLength={160}
          onChange={(event) => onChange({ teaser: event.target.value })}
          placeholder={t("admin.teaserPlaceholder")}
        />
        <div className="form-grid">
          <div>
            <label htmlFor="event-start">{t("admin.eventStart")}</label>
            <input
              id="event-start"
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => onChange({ startsAt: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="event-unlock">{t("admin.eventUnlock")}</label>
            <input
              id="event-unlock"
              type="datetime-local"
              value={draft.unlockAt}
              onChange={(event) => onChange({ unlockAt: event.target.value })}
            />
          </div>
        </div>
        <p className="fine-print">
          {t("admin.eventDateHint", { zone, timezone })}
        </p>
      </fieldset>
      <ErrorNotice message={error} />
    </form>
  );
}
