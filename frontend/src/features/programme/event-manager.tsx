"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Plus,
  Trash2,
  Pencil,
  Vote as VoteIcon,
  MessageCircle,
  X,
} from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { formatDate, localInput, utcInput, browserZone } from "@/lib/dates";
import { eventSchema, eventsSchema, type PartyEvent } from "./contracts";
import { ErrorNotice } from "@/components/ui";
import type { Guest } from "../guests/contracts";
import { Avatar } from "@/components/avatar";
import { VoteEditor, type VoteDraft } from "./vote-editor";
import { VoteResults, VoteStatus } from "./vote-activity";
import { replaceEvent } from "./vote-model";
import { ActivityLink } from "./activity-link";
import { createInvalidationRefresh } from "@/lib/invalidation-refresh";
import { subscribeRealtime } from "@/lib/realtime-browser";
import { useAutosave } from "@/lib/autosave";

type EventDraft = {
  id: number | null;
  type: PartyEvent["type"];
  revision: number;
  title: string;
  description: string;
  teaser: string;
  startsAt: string;
  unlockAt: string;
  vote: VoteDraft | null;
};

const emptyDraft: EventDraft = {
  id: null,
  type: "event",
  revision: 0,
  title: "",
  description: "",
  teaser: "",
  startsAt: "",
  unlockAt: "",
  vote: null,
};

function eventDraft(event: PartyEvent): EventDraft {
  return {
    id: event.id,
    type: event.type,
    revision: event.revision,
    title: event.title,
    description: event.description,
    teaser: event.teaser,
    startsAt: localInput(event.startsAt),
    unlockAt: localInput(event.unlockAt),
    vote: event.vote
      ? {
          question: event.vote.question,
          candidateIds: event.vote.candidates.map((candidate) => candidate.id),
          allowSelfVote: event.vote.allowSelfVote,
        }
      : null,
  };
}

function mergeSavedDraft(
  current: EventDraft,
  submitted: EventDraft,
  saved: EventDraft,
): EventDraft {
  const merged = { ...current, id: saved.id, revision: saved.revision };
  for (const field of [
    "title",
    "description",
    "teaser",
    "startsAt",
    "unlockAt",
  ] as const) {
    if (current[field] === submitted[field]) merged[field] = saved[field];
  }
  if (current.vote && submitted.vote && saved.vote) {
    merged.vote = { ...current.vote };
    if (current.vote.question === submitted.vote.question)
      merged.vote.question = saved.vote.question;
    if (
      JSON.stringify(current.vote.candidateIds) ===
      JSON.stringify(submitted.vote.candidateIds)
    )
      merged.vote.candidateIds = saved.vote.candidateIds;
    if (current.vote.allowSelfVote === submitted.vote.allowSelfVote)
      merged.vote.allowSelfVote = saved.vote.allowSelfVote;
  }
  return merged;
}

const voteTransitions = {
  draft: {
    status: "open",
    label: "activities.open",
    confirmation: "activities.openConfirm",
  },
  open: {
    status: "closed",
    label: "activities.close",
    confirmation: "activities.closeConfirm",
  },
  closed: {
    status: "revealed",
    label: "activities.reveal",
    confirmation: "activities.revealConfirm",
  },
} as const;

export function EventManager({
  initial,
  timezone,
  guests,
}: {
  initial: PartyEvent[];
  timezone: string;
  guests: Guest[];
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const eventsRef = useRef(initial);
  const draftRef = useRef<EventDraft | null>(null);
  const savedDraftRef = useRef<EventDraft | null>(null);
  const revision = useRef(0);
  const refreshNow = useRef<() => void>(() => {});
  const editing = events.find((event) => event.id === draft?.id);
  const frozenVote =
    editing?.vote && editing.vote.status !== "draft" ? editing.vote : null;
  const activeIds = new Set(
    guests.filter((guest) => guest.active).map((guest) => guest.id),
  );
  const candidateIds =
    draft?.vote?.candidateIds.filter((id) => frozenVote || activeIds.has(id)) ??
    [];
  const autosave = useAutosave({ save });
  const flushAutosave = autosave.flush;

  function updateEvents(items: PartyEvent[]) {
    eventsRef.current = items;
    setEvents(items);
  }

  function updateDraft(value: EventDraft | null) {
    draftRef.current = value;
    setDraft(value);
  }

  function updateSavedDraft(value: EventDraft | null) {
    savedDraftRef.current = value;
  }

  useEffect(() => {
    if (selectionRevision > 0) void flushAutosave();
  }, [selectionRevision, flushAutosave]);
  useEffect(() => {
    const refresh = createInvalidationRefresh(
      async (signal) => {
        const started = revision.current;
        const data = await api("/admin/programme", eventsSchema, { signal });
        signal.throwIfAborted();
        if (started === revision.current) updateEvents(data.items);
        setRefreshError(null);
      },
      (err) => setRefreshError(errorMessage(err, t)),
    );
    refreshNow.current = () => void refresh.request();
    const unsubscribe = subscribeRealtime(
      "programme",
      () => void refresh.request(),
      (connected) => {
        if (!connected) setRefreshError(t("common.connectionFailed"));
      },
    );
    return () => {
      refreshNow.current = () => {};
      unsubscribe();
      refresh.dispose();
    };
  }, [initial, t]);
  async function edit(event?: PartyEvent, type: PartyEvent["type"] = "event") {
    if (!(await autosave.flush()) && !window.confirm(t("autosave.discard")))
      return;
    setZone(browserZone());
    setError(null);
    setNotice("");
    setPalette(false);
    setEditorKey((value) => value + 1);
    const latest =
      event && eventsRef.current.find((item) => item.id === event.id);
    const next = latest
      ? eventDraft(latest)
      : {
          ...emptyDraft,
          type,
          title: type === "questions" ? t("questions.name") : "",
          vote:
            type === "vote"
              ? { question: "", candidateIds: [], allowSelfVote: false }
              : null,
        };
    updateDraft(next);
    updateSavedDraft(
      !latest && type === "questions" ? { ...next, title: "" } : next,
    );
  }
  function change(
    key: "title" | "description" | "teaser" | "startsAt" | "unlockAt",
    value: string,
  ) {
    if (draftRef.current) updateDraft({ ...draftRef.current, [key]: value });
    setNotice("");
  }
  async function closeEditor() {
    if (!(await autosave.flush()) && !window.confirm(t("autosave.discard")))
      return;
    updateDraft(null);
    updateSavedDraft(null);
    setError(null);
  }
  async function save(): Promise<boolean> {
    const submitted = draftRef.current;
    if (
      !submitted ||
      JSON.stringify(submitted) === JSON.stringify(savedDraftRef.current)
    )
      return true;
    const editing = eventsRef.current.find(
      (event) => event.id === submitted.id,
    );
    const frozenVote =
      editing?.vote && editing.vote.status !== "draft" ? editing.vote : null;
    const candidateIds =
      submitted.vote?.candidateIds.filter((id) => activeIds.has(id)) ?? [];
    if (!submitted.title.trim()) {
      setError(t("errors.invalid_event"));
      return false;
    }
    if (
      submitted.vote &&
      (!submitted.vote.question.trim() ||
        (!frozenVote && (candidateIds.length < 2 || candidateIds.length > 200)))
    ) {
      setError(t("errors.invalid_activity"));
      return false;
    }
    if (
      editing &&
      editing.revision !== submitted.revision &&
      !window.confirm(t("activities.overwriteConfirm"))
    )
      return false;
    setError(null);
    setNotice("");
    try {
      const data = await api(
        `/admin/programme${submitted.id ? `/${submitted.id}` : ""}`,
        eventSchema,
        {
          method: submitted.id ? "PUT" : "POST",
          body: {
            type: submitted.type,
            ...(submitted.id
              ? { revision: editing?.revision ?? submitted.revision }
              : {}),
            title: submitted.title.trim(),
            description: submitted.description.trim(),
            teaser: submitted.teaser.trim(),
            startsAt: utcInput(submitted.startsAt),
            unlockAt: utcInput(submitted.unlockAt),
            vote: submitted.vote
              ? {
                  question: submitted.vote.question.trim(),
                  candidateIds: frozenVote
                    ? frozenVote.candidates.map((candidate) => candidate.id)
                    : candidateIds,
                  allowSelfVote: frozenVote
                    ? frozenVote.allowSelfVote
                    : submitted.vote.allowSelfVote,
                }
              : null,
          },
        },
      );
      revision.current++;
      const items = eventsRef.current;
      const updated = items.some((item) => item.id === data.id)
        ? replaceEvent(items, data)
        : [...items, data];
      updateEvents(
        updated.sort(
          (a, b) =>
            (a.startsAt || "9999").localeCompare(b.startsAt || "9999") ||
            a.id - b.id,
        ),
      );
      const saved = eventDraft(data);
      updateSavedDraft(saved);
      const current = draftRef.current;
      if (current) {
        const next = mergeSavedDraft(current, submitted, saved);
        updateDraft(next);
        setNotice(
          JSON.stringify(next) === JSON.stringify(saved)
            ? t("admin.programmeSaved")
            : "",
        );
      }
      return true;
    } catch (err) {
      setError(errorMessage(err, t));
      return false;
    } finally {
      refreshNow.current();
    }
  }
  async function transition(event: PartyEvent) {
    if (!(await autosave.flush())) return;
    event = eventsRef.current.find((item) => item.id === event.id) ?? event;
    if (!event.vote || event.vote.status === "revealed" || busy) return;
    const next = voteTransitions[event.vote.status];
    if (!window.confirm(t(next.confirmation))) return;
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
      updateEvents(replaceEvent(eventsRef.current, saved));
      if (draftRef.current?.id === saved.id) {
        const next = eventDraft(saved);
        updateDraft(next);
        updateSavedDraft(next);
      }
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
      refreshNow.current();
    }
  }
  async function deleteEvent(event: PartyEvent) {
    if (
      !window.confirm(
        event.vote
          ? t("activities.deleteConfirm", { question: event.title })
          : t("admin.deleteEventConfirmation", { name: event.title }),
      )
    )
      return;
    if (!(await autosave.flush()) && draftRef.current?.id !== event.id) return;
    setBusy(true);
    setError(null);
    try {
      await remove(`/admin/programme/${event.id}`);
      revision.current++;
      updateEvents(eventsRef.current.filter((item) => item.id !== event.id));
      if (draftRef.current?.id === event.id) {
        updateDraft(null);
        updateSavedDraft(null);
      }
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
      <ErrorNotice message={error} />
      {refreshError && (
        <div>
          <ErrorNotice message={refreshError} />
          <button
            type="button"
            className="text-button"
            onClick={() => refreshNow.current()}
          >
            {t("programme.refresh")}
          </button>
        </div>
      )}
      <p className="success-notice programme-save-status" role="status">
        {autosave.saving ? t("admin.saving") : notice}
      </p>
      {draft && (
        <form
          className="event-editor"
          onBlur={autosave.onBlur}
          onSubmit={(event) => {
            event.preventDefault();
            void autosave.flush();
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
              onClick={() => void closeEditor()}
              disabled={busy}
              aria-label={t("autosave.close")}
            >
              <X size={18} />
            </button>
          </div>
          {editing && editing.revision !== draft.revision && (
            <p className="fine-print" role="status">
              {t("activities.conflict")}
            </p>
          )}
          <fieldset className="event-editor-fields" disabled={busy}>
            <label htmlFor="event-title">{t("admin.eventTitle")}</label>
            <input
              id="event-title"
              value={draft.title}
              onChange={(event) => change("title", event.target.value)}
              maxLength={160}
              required
              autoFocus
            />
            {draft.vote && (
              <VoteEditor
                key={editorKey}
                draft={{ ...draft.vote, candidateIds }}
                frozen={Boolean(frozenVote)}
                guests={guests}
                busy={busy}
                onChange={(vote, commit) => {
                  if (draftRef.current)
                    updateDraft({ ...draftRef.current, vote });
                  setNotice("");
                  if (commit) setSelectionRevision((value) => value + 1);
                }}
              />
            )}
            <label htmlFor="event-description">{t("admin.eventDetails")}</label>
            <textarea
              id="event-description"
              rows={3}
              maxLength={4000}
              value={draft.description}
              onChange={(event) => change("description", event.target.value)}
            />
            <label htmlFor="event-teaser">{t("admin.teaser")}</label>
            <input
              id="event-teaser"
              value={draft.teaser}
              maxLength={160}
              onChange={(event) => change("teaser", event.target.value)}
              placeholder={t("admin.teaserPlaceholder")}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="event-start">{t("admin.eventStart")}</label>
                <input
                  id="event-start"
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(event) => change("startsAt", event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="event-unlock">{t("admin.eventUnlock")}</label>
                <input
                  id="event-unlock"
                  type="datetime-local"
                  value={draft.unlockAt}
                  onChange={(event) => change("unlockAt", event.target.value)}
                />
              </div>
            </div>
            <p className="fine-print">
              {t("admin.eventDateHint", { zone, timezone })}
            </p>
          </fieldset>
        </form>
      )}
      {events.length === 0 && !draft && (
        <p className="admin-empty">{t("admin.emptyProgramme")}</p>
      )}
      <ul className="admin-event-list programme-admin-events">
        {events.map((event) => (
          <li key={event.id}>
            <div className="programme-admin-event-heading">
              <div>
                <strong>{event.title}</strong>
                {event.vote && (
                  <div>
                    <VoteStatus status={event.vote.status} />
                  </div>
                )}
                <p className="fine-print">
                  {event.startsAt
                    ? formatDate(event.startsAt, timezone, true, locale)
                    : t("admin.timePending")}
                </p>
                <span className="fine-print">
                  {event.vote?.status === "draft"
                    ? t("activities.draftVisibility")
                    : event.unlockAt
                      ? t("admin.revealedAt", {
                          date: formatDate(
                            event.unlockAt,
                            timezone,
                            true,
                            locale,
                          ),
                        })
                      : t("admin.detailsVisible")}
                </span>
              </div>
              <div className="button-row">
                <button
                  className="icon-button"
                  aria-label={t("admin.editNamedEvent", { name: event.title })}
                  disabled={busy}
                  onClick={() => edit(event)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={t("admin.deleteNamedEvent", {
                    name: event.title,
                  })}
                  disabled={busy}
                  onClick={() => deleteEvent(event)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            {event.vote && (
              <div className="programme-vote-summary">
                {event.vote.question !== event.title && (
                  <p>{event.vote.question}</p>
                )}
                <div className="activity-candidate-preview">
                  {event.vote.candidates.slice(0, 8).map((candidate) => (
                    <Avatar
                      key={candidate.id}
                      name={candidate.name}
                      avatarUrl={candidate.avatarUrl}
                    />
                  ))}
                  {event.vote.candidates.length > 8 && (
                    <span>
                      +
                      {new Intl.NumberFormat(locale).format(
                        event.vote.candidates.length - 8,
                      )}
                    </span>
                  )}
                </div>
                {event.vote.participationCount !== null && (
                  <p className="fine-print">
                    {t("activities.participation", {
                      count: new Intl.NumberFormat(locale).format(
                        event.vote.participationCount,
                      ),
                    })}
                  </p>
                )}
                {event.vote.status === "revealed" ? (
                  <VoteResults vote={event.vote} />
                ) : (
                  <button
                    type="button"
                    className="button secondary activity-state-button"
                    disabled={busy}
                    onClick={() => transition(event)}
                  >
                    {t(voteTransitions[event.vote.status].label)}
                  </button>
                )}
              </div>
            )}
            {event.questions && (
              <ActivityLink event={event} beforeNavigate={autosave.flush} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
