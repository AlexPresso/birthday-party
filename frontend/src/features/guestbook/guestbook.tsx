"use client";
import { useRef, useState } from "react";
import {
  PenLine,
  MoreHorizontal,
  Copy,
  Check,
  Trash2,
  Heart,
  UserRound,
} from "lucide-react";
import { api, errorMessage, remove } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { entrySchema, entriesSchema, type EntryPage } from "./contracts";
import { formatDate } from "@/lib/dates";
import { type Guest } from "@/features/guests/contracts";
import { PageHeading, ErrorNotice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import "./guestbook.css";

export function Guestbook({
  initial,
  guest,
  timezone,
  age,
}: {
  initial: EntryPage;
  guest: Guest;
  timezone: string;
  age: number;
}) {
  const { locale, t } = useI18n();
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
  const [copiedEntryId, setCopiedEntryId] = useState<number | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!body.trim()) {
      setPublishError(t("guestbookDesign.emptyMessage"));
      text.current?.focus();
      return;
    }
    setSending(true);
    setPublishError(null);
    setNotice(null);
    try {
      const entry = await api("/guestbook", entrySchema, {
        method: "POST",
        body: { body: body.trim(), anonymous },
      });
      setEntries((items) => [entry, ...items]);
      setBody("");
      setAnonymous(false);
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
    if (!window.confirm(t("guestbook.deleteConfirm"))) return;
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
      setCopiedEntryId(id);
    } catch {
      setError(t("guestbookDesign.copyFailed"));
    }
  }

  return (
    <div className="guestbook-page">
      <PageHeading
        title={t("page.guestbook")}
        description={t(
          new Intl.PluralRules(locale).select(age) === "one"
            ? "guestbook.descriptionOne"
            : "guestbookDesign.description",
          { age: numbers.format(age) },
        )}
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
              required
              disabled={sending}
            />
            {body.length > 1800 && (
              <div className="compose-footer">
                <span className="fine-print">
                  {numbers.format(body.length)} / {numbers.format(2000)}
                </span>
              </div>
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
                disabled={sending}
              />
              <span>{t("guestbook.postAnonymously")}</span>
            </label>
            <ErrorNotice message={publishError} />
            <button
              className="button primary wide"
              disabled={sending}
              aria-label={t(
                sending ? "guestbook.publishing" : "guestbook.publish",
              )}
            >
              {t(sending ? "guestbook.publishing" : "guestbookDesign.publish")}
            </button>
            <p className="visually-hidden" id="guestbook-visibility">
              {t("guestbook.visibility")}{" "}
              {anonymous
                ? t("guestbook.signedAnonymously")
                : t("guestbook.signed", { name: guest.name })}
            </p>
          </form>
          <p className="success-notice" role="status">
            {notice}
          </p>
        </section>
        <section
          className="guestbook-entries"
          aria-label={t("guestbook.entries")}
        >
          <ErrorNotice message={error} />
          {entries.length === 0 ? (
            <div className="guestbook-empty">
              <Heart size={30} strokeWidth={1.3} aria-hidden="true" />
              <h2>{t("guestbook.emptyTitle")}</h2>
              <p className="muted">{t("guestbook.emptyDescription")}</p>
              <button
                className="text-button"
                onClick={() => text.current?.focus()}
              >
                <PenLine size={16} />
                {t("guestbook.write")}
              </button>
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
                <p className="entry-body">{entry.body}</p>
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
