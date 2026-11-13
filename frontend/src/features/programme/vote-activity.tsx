"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pencil, Trash2, Trophy } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useConfirm } from "@/components/confirm-dialog";
import { ErrorNotice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n-context";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import {
  eventSchema,
  eventsSchema,
  type Vote,
  type VoteEvent,
  type VoteOption,
} from "./contracts";
import { useReorderedList } from "./use-reordered-list";
import {
  choiceLength,
  isReadableVote,
  leadingVotes,
  optionObstacle,
  pendingChoice,
  totalVotes,
} from "./vote-model";
import { VoteStatus } from "./vote-status";
import "./activity-page.css";
import "./vote.css";

type ReportError = (message: string) => void;

const obstacleLabels = {
  inactive: "activities.inactive",
  self: "activities.noSelf",
} as const;

/** The sentence above the options that says where the vote stands. */
function voteHint(vote: Vote, total: number): MessageKey | null {
  if (vote.status === "draft") return "activities.draftVisibility";
  if (vote.status === "closed")
    return total === 0 ? "activities.noResults" : null;
  return vote.canVote ? "activities.rules" : "activities.unavailable";
}

function VoteOptionItem({
  option,
  share,
  isMine,
  isLeading,
  note,
  radio,
  removal,
}: {
  option: VoteOption;
  /** The option's votes as a percentage of the leading option's. */
  share: number;
  isMine: boolean;
  isLeading: boolean;
  /** Why the viewer cannot choose this option. */
  note: string | null;
  /** The radio button of an open ballot; a read-only list has none. */
  radio: {
    name: string;
    checked: boolean;
    disabled: boolean;
    onSelect: () => void;
  } | null;
  /** The host's control that removes a choice a guest added. */
  removal: { disabled: boolean; onRemove: () => void } | null;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const votes = new Intl.NumberFormat(locale).format(option.votes);
  const details = (
    <>
      {option.guestId !== null && (
        <Avatar name={option.label} avatarUrl={option.avatarUrl} />
      )}
      <span className="vote-option-text">
        <strong id={`${id}-label`} className="vote-option-label">
          {option.label}
        </strong>
        <span id={`${id}-notes`} className="vote-option-notes">
          {isMine && (
            <span className="vote-option-mine">
              <Check size={15} aria-hidden="true" />
              {t("activities.myVote")}
            </span>
          )}
          {isLeading && (
            <span className="vote-option-leading">
              <Trophy size={15} aria-hidden="true" />
              {t("activities.leading")}
            </span>
          )}
          {note && <span>{note}</span>}
        </span>
        {/* Decoration: the count beside it carries the information. */}
        <span className="vote-option-bar" aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </span>
      </span>
      <span className="vote-option-count">
        <span aria-hidden="true">{votes}</span>
        <span id={`${id}-count`} className="visually-hidden">
          {t("activities.votes", { count: votes })}
        </span>
      </span>
    </>
  );
  return (
    <li className="vote-option">
      {radio ? (
        <label className="vote-option-choice">
          <input
            type="radio"
            name={radio.name}
            value={option.id}
            checked={radio.checked}
            disabled={radio.disabled}
            onChange={radio.onSelect}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-count ${id}-notes`}
          />
          <span className="vote-option-mark" aria-hidden="true">
            <Check size={14} strokeWidth={3} />
          </span>
          {details}
        </label>
      ) : (
        <div className="vote-option-choice">{details}</div>
      )}
      {removal && (
        <div className="vote-option-host">
          <button
            type="button"
            className="text-button"
            aria-label={t("activities.removeOption", { label: option.label })}
            disabled={removal.disabled}
            onClick={removal.onRemove}
          >
            <Trash2 size={17} aria-hidden="true" />
            {t("activities.remove")}
          </button>
        </div>
      )}
    </li>
  );
}

/** Lets a guest vote for a choice that is not listed yet. */
function WriteInForm({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (label: string, onError: ReportError) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const [label, setLabel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = label.trim();

  async function submit(submission: FormEvent) {
    submission.preventDefault();
    if (busy || !choice) return;
    setSending(true);
    setError(null);
    try {
      if (await onSend(choice, setError)) setLabel("");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="vote-write-in" onSubmit={submit}>
      <label htmlFor={inputId}>{t("activities.addChoice")}</label>
      {/* The field stays editable during a request, so a failure keeps the
          text and the keyboard. */}
      <input
        id={inputId}
        value={label}
        maxLength={choiceLength}
        autoComplete="off"
        onChange={(event) => {
          setLabel(event.target.value);
          // The refusal concerned the previous text.
          setError(null);
        }}
      />
      <button className="button secondary" disabled={busy || !choice}>
        {t(sending ? "activities.saving" : "activities.voteForChoice")}
      </button>
      <ErrorNotice message={error} />
    </form>
  );
}

export function VoteActivity({
  initial,
  guestId,
  isAdmin,
}: {
  initial: VoteEvent;
  guestId: number;
  isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const radioName = useId();
  const [event, setEvent] = useState(initial);
  // The option picked but not sent yet; null follows the recorded vote.
  const [selection, setSelection] = useState<number | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [casting, setCasting] = useState(false);
  const [ballotError, setBallotError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const { list, capture } = useReorderedList<HTMLOListElement>(event);
  const vote = event.vote;
  const path = `/programme/${event.id}/vote`;

  function show(next: VoteEvent) {
    capture();
    setEvent(next);
  }

  const { connectionFailed, refresh, retry } = useRealtimeResource({
    topic: "programme",
    hasInitialData: true,
    async read(signal) {
      const current = generation.current;
      const events = await api(
        isAdmin ? "/admin/programme" : "/programme",
        eventsSchema,
        { signal },
      );
      signal.throwIfAborted();
      const latest = events.items.find((item) => item.id === event.id);
      // Deleted, locked again or, for a guest, back to a draft.
      if (!isReadableVote(latest)) {
        window.location.replace("/programme");
        return;
      }
      // A change sent or answered during the request is newer.
      if (current === generation.current && !mutation.current) show(latest);
      setRefreshError(null);
    },
    onError: (err) => setRefreshError(errorMessage(err, t)),
  });

  useEffect(() => () => mutation.current?.abort(), []);

  /** Sends one change at a time and shows the vote it returns. */
  async function mutate(
    url: string,
    method: "PUT" | "POST" | "DELETE",
    body: object | undefined,
    onError: ReportError,
  ) {
    if (mutation.current) return false;
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    try {
      const saved = await api(url, eventSchema, {
        method,
        body,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      generation.current++;
      if (isReadableVote(saved)) show(saved);
      return true;
    } catch (err) {
      if (!controller.signal.aborted) onError(errorMessage(err, t));
      return false;
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        void refresh();
      }
    }
  }

  const total = totalVotes(vote);
  const leading = leadingVotes(vote);
  const voting = vote.status === "open" && vote.canVote;
  const canWriteIn = voting && vote.choices === "custom" && vote.allowWriteIns;
  const mine = vote.options.find((option) => option.id === vote.myOptionId);
  const { option: choice, lost } = pendingChoice(vote, selection, guestId);
  const checkedId = choice?.id ?? vote.myOptionId;
  const canCast = choice !== null && choice.id !== vote.myOptionId;
  const hint = voteHint(vote, total);
  const number = new Intl.NumberFormat(locale);
  const message =
    actionError ??
    refreshError ??
    (connectionFailed ? t("common.connectionFailed") : null);

  function select(option: VoteOption) {
    setSelection(option.id);
    setRecorded(false);
    setBallotError(null);
  }

  /** The viewer's vote changed: the ballot follows it again. */
  function voteRecorded() {
    setSelection(null);
    setRecorded(true);
  }

  async function cast(submission: FormEvent) {
    submission.preventDefault();
    if (!voting || !canCast || busy) return;
    setCasting(true);
    setBallotError(null);
    const sent = await mutate(
      path,
      "PUT",
      { optionId: choice.id },
      setBallotError,
    );
    setCasting(false);
    if (sent) voteRecorded();
  }

  async function writeIn(label: string, onError: ReportError) {
    setRecorded(false);
    const sent = await mutate(`${path}/options`, "POST", { label }, onError);
    if (sent) voteRecorded();
    return sent;
  }

  async function removeOption(option: VoteOption) {
    const confirmed = await confirm({
      message: t("activities.removeOptionConfirm", { label: option.label }),
      destructive: true,
    });
    if (!confirmed) return;
    setActionError(null);
    const removed = await mutate(
      `/admin${path}/options/${option.id}`,
      "DELETE",
      undefined,
      setActionError,
    );
    // The button left with its option; the list keeps the keyboard's place.
    if (removed) list.current?.focus({ preventScroll: true });
  }

  const options = (
    <ol ref={list} className="vote-options" tabIndex={-1}>
      {vote.options.map((option) => {
        const obstacle = optionObstacle(vote, option, guestId);
        return (
          <VoteOptionItem
            key={option.id}
            option={option}
            share={leading > 0 ? (option.votes / leading) * 100 : 0}
            isMine={option.id === vote.myOptionId}
            isLeading={
              vote.status === "closed" &&
              leading > 0 &&
              option.votes === leading
            }
            note={voting && obstacle ? t(obstacleLabels[obstacle]) : null}
            radio={
              voting
                ? {
                    name: radioName,
                    checked: option.id === checkedId,
                    disabled: obstacle !== null,
                    onSelect: () => select(option),
                  }
                : null
            }
            removal={
              isAdmin && option.writeIn
                ? { disabled: busy, onRemove: () => void removeOption(option) }
                : null
            }
          />
        );
      })}
    </ol>
  );

  return (
    <div className="vote-page">
      <Link className="activity-back" href="/programme">
        <ArrowLeft size={21} aria-hidden="true" />
        {t("nav.programme")}
      </Link>
      <header className="vote-heading">
        {event.title !== vote.question && (
          <p className="eyebrow">{event.title}</p>
        )}
        <h1>{vote.question}</h1>
        <p className="vote-summary">
          <VoteStatus status={vote.status} />
          <span>
            {t("activities.participation", { count: number.format(total) })}
          </span>
        </p>
        {event.description && (
          <p className="vote-description">{event.description}</p>
        )}
      </header>
      {message && (
        <div className="vote-feedback">
          <ErrorNotice message={message} />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setActionError(null);
              setRefreshError(null);
              void retry();
            }}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      <div className="vote-layout">
        <div className="vote-board">
          {hint && <p className="vote-hint">{t(hint)}</p>}
          {vote.options.length === 0 && vote.status !== "closed" && (
            <p className="vote-empty">
              {t("activities.noChoices")}
              {canWriteIn && ` ${t("activities.firstChoice")}`}
            </p>
          )}
          {vote.options.length === 0 ? null : voting ? (
            <form onSubmit={cast}>
              <fieldset className="vote-choices" disabled={busy}>
                <legend className="visually-hidden">{vote.question}</legend>
                {options}
              </fieldset>
              <div className="vote-confirm">
                <ErrorNotice message={ballotError} />
                <p
                  className={`vote-confirm-status ${lost ? "muted" : "success-notice"}`}
                  role="status"
                >
                  {lost
                    ? t("errors.invalid_vote_option")
                    : recorded && mine
                      ? t("activities.saved", { name: mine.label })
                      : ""}
                </p>
                <button className="button primary" disabled={busy || !canCast}>
                  {casting
                    ? t("activities.saving")
                    : t(mine ? "programme.changeVote" : "programme.vote")}
                </button>
              </div>
            </form>
          ) : (
            options
          )}
        </div>
        {(canWriteIn || isAdmin) && (
          <aside className="vote-sidebar">
            {canWriteIn && <WriteInForm busy={busy} onSend={writeIn} />}
            {isAdmin && (
              <Link
                className="button secondary"
                href="/parametres?section=programme"
              >
                <Pencil size={17} aria-hidden="true" />
                {t("programme.manage")}
              </Link>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
