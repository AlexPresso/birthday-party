"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Plus,
  Vote as VoteIcon,
  MessageCircle,
} from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { browserZone } from "@/lib/dates";
import { eventSchema, eventsSchema, type PartyEvent } from "./contracts";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import type { Guest } from "../guests/contracts";
import { replaceEvent, voteTransitions } from "./vote-model";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import { useLatestState } from "@/lib/use-latest-state";
import { useAutosave } from "@/lib/autosave";
import {
  draftProblem,
  eventDraft,
  eventRequestBody,
  frozenVote,
  newEventDraft,
  withSavedEvent,
  type EventDraft,
} from "./event-draft";
import { useEventDraft } from "./use-event-draft";
import { EventForm } from "./event-form";
import { EventList } from "./event-list";

export function EventManager({
  initial,
  timezone,
  guests,
}: {
  initial: PartyEvent[];
  timezone: string;
  guests: Guest[];
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const [events, setEvents, latestEvents] = useLatestState(initial);
  const editor = useEventDraft();
  const { draft } = editor;
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  // Counts local writes so a read that started before one is not applied.
  const revision = useRef(0);
  // The server revision the host explicitly chose to replace with the draft.
  const overwriteRevision = useRef<number | null>(null);
  const { connectionFailed, refresh, retry } = useRealtimeResource({
    topic: "programme",
    hasInitialData: true,
    // Server props change when another settings editor refreshes the route.
    restartKey: initial,
    async read(signal) {
      const started = revision.current;
      const data = await api("/admin/programme", eventsSchema, { signal });
      signal.throwIfAborted();
      if (started === revision.current) setEvents(data.items);
      setRefreshError(null);
    },
    onError: (err) => setRefreshError(errorMessage(err, t)),
  });
  const refreshMessage =
    refreshError ?? (connectionFailed ? t("common.connectionFailed") : null);
  const activeIds = new Set(
    guests.filter((guest) => guest.active).map((guest) => guest.id),
  );
  const autosave = useAutosave({ save });
  const flushAutosave = autosave.flush;

  useEffect(() => {
    if (selectionRevision > 0) void flushAutosave();
  }, [selectionRevision, flushAutosave]);

  // A failed save keeps the draft unless the host agrees to lose it.
  async function leaveDraft() {
    return (
      (await autosave.flush()) ||
      (await confirm({ message: t("autosave.discard"), destructive: true }))
    );
  }

  async function edit(event?: PartyEvent, type: PartyEvent["type"] = "event") {
    if (!(await leaveDraft())) return;
    setZone(browserZone());
    setError(null);
    setNotice("");
    setPalette(false);
    setEditorKey((value) => value + 1);
    const latest = event && latestEvents().find((item) => item.id === event.id);
    if (latest) editor.open(eventDraft(latest));
    else if (type === "questions")
      // The suggested name is an unsaved change, so the first save creates it.
      editor.open(
        newEventDraft(type, t("questions.name")),
        newEventDraft(type),
      );
    else editor.open(newEventDraft(type));
  }

  function change(changes: Partial<EventDraft>, commit = false) {
    editor.change(changes);
    setNotice("");
    if (commit) setSelectionRevision((value) => value + 1);
  }

  async function closeEditor() {
    if (!(await leaveDraft())) return;
    editor.close();
    setError(null);
  }

  async function save(): Promise<boolean> {
    const submitted = editor.current();
    if (!submitted) return true;
    const saved = latestEvents().find((event) => event.id === submitted.id);
    const overwriting =
      saved !== undefined && overwriteRevision.current === saved.revision;
    if (!overwriting && !editor.hasUnsavedChanges()) return true;
    const candidateIds =
      submitted.vote?.candidateIds.filter((id) => activeIds.has(id)) ?? [];
    const problem = draftProblem(submitted, frozenVote(saved), candidateIds);
    if (problem) {
      setError(t(`errors.${problem}`));
      return false;
    }
    // Autosave never replaces a newer version on its own: it can run from a
    // blur or a background tab. The conflict notice offers the explicit action.
    if (saved && saved.revision !== submitted.revision && !overwriting)
      return false;
    setError(null);
    setNotice("");
    try {
      const data = await api(
        `/admin/programme${submitted.id ? `/${submitted.id}` : ""}`,
        eventSchema,
        {
          method: submitted.id ? "PUT" : "POST",
          body: eventRequestBody(submitted, saved, candidateIds),
        },
      );
      revision.current++;
      overwriteRevision.current = null;
      setEvents(withSavedEvent(latestEvents(), data));
      if (editor.acceptSaved(submitted, data))
        setNotice(t("admin.programmeSaved"));
      return true;
    } catch (err) {
      setError(errorMessage(err, t));
      return false;
    } finally {
      void refresh();
    }
  }

  async function transition(event: PartyEvent) {
    if (!(await autosave.flush())) return;
    event = latestEvents().find((item) => item.id === event.id) ?? event;
    if (!event.vote || event.vote.status === "revealed" || busy) return;
    const next = voteTransitions[event.vote.status];
    if (!(await confirm({ message: t(next.confirmation) }))) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const saved = await api(
        `/admin/programme/${event.id}/vote/state`,
        eventSchema,
        {
          method: "POST",
          body: { status: next.status, revision: event.revision },
        },
      );
      revision.current++;
      setEvents(replaceEvent(latestEvents(), saved));
      if (editor.current()?.id === saved.id) editor.open(eventDraft(saved));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function deleteEvent(event: PartyEvent) {
    const confirmed = await confirm({
      message: event.vote
        ? t("activities.deleteConfirm", { question: event.title })
        : t("admin.deleteEventConfirmation", { name: event.title }),
      destructive: true,
    });
    if (!confirmed) return;
    if (!(await autosave.flush()) && editor.current()?.id !== event.id) return;
    setBusy(true);
    setError(null);
    try {
      await remove(`/admin/programme/${event.id}`);
      revision.current++;
      setEvents(latestEvents().filter((item) => item.id !== event.id));
      if (editor.current()?.id === event.id) editor.close();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form">
      <div className="section-row">
        <p className="muted">{t("admin.surpriseHint")}</p>
        <button
          className="button secondary"
          disabled={busy || autosave.saving}
          aria-expanded={palette}
          onClick={() => setPalette(!palette)}
        >
          <Plus size={17} />
          {t("admin.addEvent")}
        </button>
      </div>
      {palette && (
        <div className="event-palette">
          <button type="button" onClick={() => edit(undefined, "questions")}>
            <MessageCircle size={22} aria-hidden="true" />
            <span>
              <strong>{t("questions.name")}</strong>
              <span>{t("questions.description")}</span>
            </span>
          </button>
          <button type="button" onClick={() => edit()}>
            <CalendarDays size={22} aria-hidden="true" />
            <span>
              <strong>{t("activities.eventType")}</strong>
              <span>{t("activities.eventDescription")}</span>
            </span>
          </button>
          <button type="button" onClick={() => edit(undefined, "vote")}>
            <VoteIcon size={22} aria-hidden="true" />
            <span>
              <strong>{t("activities.voteType")}</strong>
              <span>{t("activities.voteDescription")}</span>
            </span>
          </button>
        </div>
      )}
      {/* With the editor open, the form shows the error below its fields. */}
      <ErrorNotice message={draft ? null : error} />
      {refreshMessage && (
        <div>
          <ErrorNotice message={refreshMessage} />
          <button
            type="button"
            className="text-button"
            onClick={() => void retry()}
          >
            {t("programme.refresh")}
          </button>
        </div>
      )}
      <p className="success-notice programme-save-status" role="status">
        {autosave.saving ? t("admin.saving") : notice}
      </p>
      {draft && (
        <EventForm
          draft={draft}
          saved={events.find((event) => event.id === draft.id)}
          guests={guests}
          timezone={timezone}
          zone={zone}
          busy={busy}
          error={error}
          voteEditorKey={editorKey}
          onChange={change}
          onBlur={autosave.onBlur}
          onSubmit={() => void autosave.flush()}
          onOverwrite={(event) => {
            overwriteRevision.current = event.revision;
            void autosave.flush();
          }}
          onClose={() => void closeEditor()}
        />
      )}
      {events.length === 0 && !draft && (
        <p className="admin-empty">{t("admin.emptyProgramme")}</p>
      )}
      <EventList
        events={events}
        timezone={timezone}
        busy={busy}
        onEdit={(event) => void edit(event)}
        onDelete={(event) => void deleteEvent(event)}
        onTransition={(event) => void transition(event)}
        beforeNavigate={autosave.flush}
      />
    </div>
  );
}
