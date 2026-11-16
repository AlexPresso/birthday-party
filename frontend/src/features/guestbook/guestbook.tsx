"use client";
import { useRef, useState } from "react";
import {
  MoreHorizontal,
  Copy,
  Check,
  Trash2,
  UserRound,
  Mic,
  Square,
} from "lucide-react";
import { api, errorMessage, remove } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { entrySchema, entriesSchema, type EntryPage } from "./contracts";
import { formatDate } from "@/lib/dates";
import { useCopiedCue } from "@/lib/use-copied-cue";
import { type Guest } from "@/features/guests/contracts";
import { PageHeading, ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar } from "@/components/avatar";
import { VoiceNote, formatVoiceTime } from "./voice-note";
import {
  maxVoiceMs,
  useCanRecordVoice,
  useVoiceRecorder,
} from "./use-voice-recorder";
import "./guestbook.css";

export function Guestbook({
  initial,
  guest,
  timezone,
}: {
  initial: EntryPage;
  guest: Guest;
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const confirm = useConfirm();
  const numbers = new Intl.NumberFormat(locale);
  const [entries, setEntries] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The copy action of a message confirms by itself for a moment.
  const [copiedEntryId, markCopied] = useCopiedCue<number>();
  const text = useRef<HTMLTextAreaElement>(null);
  const recorder = useVoiceRecorder();
  const recording =
    recorder.state.status === "recorded" ? recorder.state.recording : null;
  const canRecord = useCanRecordVoice();

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (sending || recorder.state.status === "recording") return;
    if (!body.trim() && !recording) {
      setPublishError(t("guestbookDesign.emptyMessage"));
      text.current?.focus();
      return;
    }
    setSending(true);
    setPublishError(null);
    setNotice(null);
    try {
      let payload: unknown = { body: body.trim(), anonymous };
      if (recording) {
        // The message comes first: the server reads it before the recording.
        const form = new FormData();
        form.append("body", body.trim());
        form.append("audio", recording.blob, "voice-note");
        payload = form;
      }
      const entry = await api("/guestbook", entrySchema, {
        method: "POST",
        body: payload,
      });
      setEntries((items) => [entry, ...items]);
      setBody("");
      setAnonymous(false);
      recorder.clear();
      setNotice(t("guestbook.published"));
    } catch (err) {
      setPublishError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  }
  async function loadMore() {
    if (cursor === null) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api(
        `/guestbook?limit=24&before=${encodeURIComponent(cursor)}`,
        entriesSchema,
      );
      setEntries((items) => [
        ...items,
        ...page.items.filter(
          (entry) => !items.some((item) => item.id === entry.id),
        ),
      ]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }
  async function deleteEntry(id: number) {
    const confirmed = await confirm({
      message: t("guestbook.deleteConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    setRemoving(id);
    setError(null);
    try {
      await remove(`/guestbook/${id}`);
      setEntries((items) => items.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setRemoving(null);
    }
  }

  async function copyEntry(id: number, message: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(message);
      markCopied(id);
    } catch {
      setError(t("guestbookDesign.copyFailed"));
    }
  }

  return (
    <div className="guestbook-page">
      <PageHeading
        title={t("page.guestbook")}
        description={t("guestbookDesign.description")}
      />
      <div className="guestbook-layout">
        <section className="guestbook-compose">
          <h2 id="guestbook-compose-title" className="visually-hidden">
            {t("guestbook.composeTitle")}
          </h2>
          <form onSubmit={publish} aria-labelledby="guestbook-compose-title">
            <label className="visually-hidden" htmlFor="guestbook-message">
              {t("guestbook.message")}
            </label>
            <textarea
              id="guestbook-message"
              ref={text}
              rows={5}
              maxLength={2000}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setPublishError(null);
              }}
              placeholder={t("guestbookDesign.placeholder")}
              aria-describedby="guestbook-visibility"
              required={!recording}
              disabled={sending}
            />
            {body.length > 1800 && (
              <div className="compose-footer">
                <span className="fine-print">
                  {numbers.format(body.length)} / {numbers.format(2000)}
                </span>
              </div>
            )}
            {recorder.state.status === "recording" && (
              <div className="voice-recording" role="status">
                <span className="voice-recording-dot" aria-hidden="true" />
                <span className="visually-hidden">
                  {t("guestbookDesign.recording")}
                </span>
                <span className="voice-recording-time">
                  {formatVoiceTime(recorder.state.elapsedMs)}
                  <span className="muted">
                    {" "}
                    / {formatVoiceTime(maxVoiceMs)}
                  </span>
                </span>
                <span className="voice-recording-bars" aria-hidden="true">
                  {recorder.state.levels.map((level, index) => (
                    <span
                      key={index}
                      style={{
                        height: `${Math.min(100, 12 + level * 400)}%`,
                      }}
                    />
                  ))}
                </span>
              </div>
            )}
            {recording && (
              <div className="voice-draft">
                <VoiceNote
                  src={recording.url}
                  durationMs={recording.durationMs}
                  peaks={recording.peaks}
                />
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={recorder.clear}
                  disabled={sending}
                  aria-label={t("guestbookDesign.discardRecording")}
                  title={t("guestbookDesign.discardRecording")}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            {recording ? (
              // A voice gives its author away: voice notes are always signed.
              <p className="fine-print voice-signed">
                {t("guestbookDesign.voiceSigned")}
              </p>
            ) : (
              recorder.state.status !== "recording" && (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={anonymous}
                    onChange={(event) => setAnonymous(event.target.checked)}
                    disabled={sending}
                  />
                  <span>{t("guestbook.postAnonymously")}</span>
                </label>
              )
            )}
            <ErrorNotice
              message={
                recorder.error === "denied"
                  ? t("guestbookDesign.micDenied")
                  : recorder.error === "unavailable"
                    ? t("guestbookDesign.micUnavailable")
                    : null
              }
            />
            <ErrorNotice message={publishError} />
            {recorder.state.status === "recording" ? (
              <div className="compose-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={recorder.cancel}
                >
                  {t("guestbookDesign.cancelRecording")}
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={recorder.stop}
                >
                  <Square size={14} fill="currentColor" aria-hidden="true" />
                  {t("guestbookDesign.stopRecording")}
                </button>
              </div>
            ) : (
              <div className="compose-actions">
                <button
                  className="button primary"
                  disabled={sending}
                  aria-label={t(
                    sending ? "guestbook.publishing" : "guestbook.publish",
                  )}
                >
                  {t(
                    sending
                      ? "guestbook.publishing"
                      : "guestbookDesign.publish",
                  )}
                </button>
                {canRecord && !recording && (
                  <button
                    type="button"
                    className="compose-record"
                    onClick={() => void recorder.start()}
                    disabled={sending}
                    aria-label={t("guestbookDesign.record")}
                    title={t("guestbookDesign.record")}
                  >
                    <Mic size={20} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            <p className="visually-hidden" id="guestbook-visibility">
              {t("guestbook.visibility")}{" "}
              {anonymous && !recording
                ? t("guestbook.signedAnonymously")
                : t("guestbook.signed", { name: guest.name })}
            </p>
          </form>
          {/* The new message tops the list; only screen readers are told. */}
          <SavedAnnouncement message={notice ?? ""} />
        </section>
        <section aria-label={t("guestbook.entries")}>
          <ErrorNotice message={error} />
          {entries.length === 0 ? (
            <div className="guestbook-empty">
              <h2>{t("guestbook.emptyTitle")}</h2>
            </div>
          ) : (
            entries.map((entry) => (
              <article key={entry.id} className="guestbook-entry">
                <header>
                  {entry.author ? (
                    <Avatar
                      name={entry.author.name}
                      avatarUrl={entry.author.avatarUrl}
                    />
                  ) : (
                    <span
                      className="avatar anonymous-avatar"
                      aria-hidden="true"
                    >
                      <UserRound
                        size={36}
                        strokeWidth={1}
                        fill="currentColor"
                      />
                    </span>
                  )}
                  <div>
                    <strong>
                      {entry.author?.name ?? t("guestbook.anonymous")}
                    </strong>
                    <p className="fine-print">
                      {formatDate(entry.createdAt, timezone, true, locale)}
                    </p>
                  </div>
                  <details
                    className="entry-actions"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        event.currentTarget.open = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector("summary")?.focus();
                      }
                    }}
                  >
                    <summary
                      className="icon-button"
                      aria-label={t("guestbookDesign.actions")}
                    >
                      <MoreHorizontal size={22} aria-hidden="true" />
                    </summary>
                    <div className="entry-menu">
                      <button
                        type="button"
                        onClick={() => copyEntry(entry.id, entry.body)}
                        aria-live="polite"
                      >
                        {copiedEntryId === entry.id ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                        {t(
                          copiedEntryId === entry.id
                            ? "guestbookDesign.copied"
                            : "guestbookDesign.copy",
                        )}
                      </button>
                      {entry.canDelete && (
                        <button
                          className="entry-delete"
                          onClick={() => deleteEntry(entry.id)}
                          disabled={removing === entry.id}
                          aria-label={
                            entry.author
                              ? t("guestbook.delete", {
                                  name: entry.author.name,
                                })
                              : t("guestbook.deleteAnonymous")
                          }
                        >
                          <Trash2 size={16} />
                          {entry.author
                            ? t("guestbook.delete", { name: entry.author.name })
                            : t("guestbook.deleteAnonymous")}
                        </button>
                      )}
                    </div>
                  </details>
                </header>
                {entry.voice && (
                  <VoiceNote
                    src={entry.voice.url}
                    durationMs={entry.voice.durationMs}
                    peaks={entry.voice.peaks}
                  />
                )}
                {entry.body && <p className="entry-body">{entry.body}</p>}
              </article>
            ))
          )}
          {cursor && (
            <button
              className="button secondary load-more"
              onClick={loadMore}
              disabled={loading}
            >
              {t(loading ? "guestbook.loading" : "guestbook.loadMore")}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
