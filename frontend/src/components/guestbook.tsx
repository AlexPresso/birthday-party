"use client";
import { useRef, useState } from "react";
import { BookOpen, PenLine, Send, Trash2, Heart } from "lucide-react";
import { api, errorMessage, remove } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  entrySchema,
  entriesSchema,
  formatDate,
  type EntryPage,
  type Guest,
} from "@/lib/contracts";
import { PageHeading, ErrorNotice } from "./ui";

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
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const entry = await api("/guestbook", entrySchema, {
        method: "POST",
        body: { body: body.trim() },
      });
      setEntries((items) => [entry, ...items]);
      setBody("");
      setNotice(t("guestbook.published"));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  }
  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const page = await api(
        `/guestbook?limit=24&before=${encodeURIComponent(cursor!)}`,
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

  return (
    <>
      <PageHeading
        title={t("guestbook.title")}
        description={t(
          new Intl.PluralRules(locale).select(age) === "one"
            ? "guestbook.descriptionOne"
            : "guestbook.descriptionOther",
          { age: numbers.format(age) },
        )}
      />
      <div className="guestbook-layout">
        <section className="guestbook-compose panel">
          <div className="compose-title">
            <div className="small-emblem">
              <BookOpen size={26} strokeWidth={1.5} />
            </div>
            <div>
              <h2>{t("guestbook.composeTitle")}</h2>
              <p className="muted">{t("guestbook.composeDescription")}</p>
            </div>
          </div>
          <form onSubmit={publish}>
            <label htmlFor="guestbook-message">{t("guestbook.message")}</label>
            <textarea
              id="guestbook-message"
              ref={text}
              rows={5}
              maxLength={2000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("guestbook.placeholder")}
              required
              disabled={sending}
            />
            <div className="compose-footer">
              <span className="fine-print">
                {numbers.format(body.length)} / {numbers.format(2000)}
              </span>
              <span className="fine-print">
                {t("guestbook.signed", { name: guest.name })}
              </span>
            </div>
            <button
              className="button primary wide"
              disabled={sending || !body.trim()}
            >
              <Send size={18} />
              {t(sending ? "guestbook.publishing" : "guestbook.publish")}
            </button>
            <p className="fine-print">{t("guestbook.visibility")}</p>
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
              <article key={entry.id} className="guestbook-entry panel">
                <header>
                  <span className="avatar">
                    {entry.author.name.charAt(0).toLocaleUpperCase(locale)}
                  </span>
                  <div>
                    <strong>{entry.author.name}</strong>
                    <p className="fine-print">
                      {formatDate(entry.createdAt, timezone, true, locale)}
                    </p>
                  </div>
                  {(guest.id === entry.author.id || guest.role === "admin") && (
                    <button
                      className="icon-button danger"
                      onClick={() => deleteEntry(entry.id)}
                      disabled={removing === entry.id}
                      aria-label={t("guestbook.delete", {
                        name: entry.author.name,
                      })}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
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
    </>
  );
}
