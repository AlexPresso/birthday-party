"use client";

import { useRef } from "react";
import { useLatestState } from "@/lib/use-latest-state";
import type { PartyEvent } from "./contracts";
import {
  eventDraft,
  mergeSavedDraft,
  sameDraft,
  type EventDraft,
} from "./event-draft";

/**
 * Owns the event being edited and the version the server last stored for it.
 * Autosave compares the two to skip unchanged drafts and merges each response
 * without overwriting what the host typed during the request.
 */
export function useEventDraft() {
  const [draft, setDraft, current] = useLatestState<EventDraft | null>(null);
  const saved = useRef<EventDraft | null>(null);

  return {
    /** The draft to render. */
    draft,
    /** The latest draft, for handlers that continue after an await. */
    current,
    hasUnsavedChanges: () => !sameDraft(current(), saved.current),
    /** Starts editing; `savedDraft` differs when the draft is prefilled. */
    open(next: EventDraft, savedDraft: EventDraft = next) {
      setDraft(next);
      saved.current = savedDraft;
    },
    close() {
      setDraft(null);
      saved.current = null;
    },
    change(changes: Partial<EventDraft>) {
      const latest = current();
      if (latest) setDraft({ ...latest, ...changes });
    },
    /** Records a save of `submitted`; returns whether nothing is left to save. */
    acceptSaved(submitted: EventDraft, event: PartyEvent) {
      const stored = eventDraft(event);
      saved.current = stored;
      const latest = current();
      if (!latest) return false;
      const merged = mergeSavedDraft(latest, submitted, stored);
      setDraft(merged);
      return sameDraft(merged, stored);
    },
  };
}
