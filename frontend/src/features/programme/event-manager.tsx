"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Pencil, X } from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { formatDate, localInput, utcInput, browserZone } from "@/lib/dates";
import { eventSchema, type PartyEvent } from "./contracts";
import { ErrorNotice } from "@/components/ui";

type EventDraft = {
  id: number | null;
  title: string;
  description: string;
  teaser: string;
  startsAt: string;
  unlockAt: string;
};

const emptyDraft: EventDraft = {
  id: null,
  title: "",
  description: "",
  teaser: "",
  startsAt: "",
  unlockAt: "",
};

export function EventManager({
  initial,
  timezone,
}: {
  initial: PartyEvent[];
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("");
  function edit(event?: PartyEvent) {
    setZone(browserZone());
    setError(null);
    setNotice("");
    setDraft(
      event
        ? {
            id: event.id,
            title: event.title,
            description: event.description,
            teaser: event.teaser,
            startsAt: localInput(event.startsAt),
            unlockAt: localInput(event.unlockAt),
          }
        : { ...emptyDraft },
    );
  }
  function change(key: keyof Omit<EventDraft, "id">, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const data = await api(
        `/admin/programme${draft.id ? `/${draft.id}` : ""}`,
        eventSchema,
        {
          method: draft.id ? "PUT" : "POST",
          body: {
            title: draft.title.trim(),
            description: draft.description.trim(),
            teaser: draft.teaser.trim(),
            startsAt: utcInput(draft.startsAt),
            unlockAt: utcInput(draft.unlockAt),
          },
        },
      );
      setEvents((items) =>
        [...items.filter((item) => item.id !== data.id), data].sort((a, b) =>
          (a.startsAt || "9999").localeCompare(b.startsAt || "9999"),
        ),
      );
      setDraft(null);
      setNotice(t("admin.programmeSaved"));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }
  async function deleteEvent(event: PartyEvent) {
    if (
      !window.confirm(t("admin.deleteEventConfirmation", { name: event.title }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await remove(`/admin/programme/${event.id}`);
      setEvents((items) => items.filter((item) => item.id !== event.id));
      if (draft?.id === event.id) setDraft(null);
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
          disabled={busy}
          onClick={() => edit()}
        >
          <Plus size={17} />
          {t("admin.addEvent")}
        </button>
      </div>
      <ErrorNotice message={error} />
      <p className="success-notice" role="status">
        {notice}
      </p>
      {draft && (
        <form className="event-editor" onSubmit={save}>
          <div className="section-row">
            <h3>{draft.id ? t("admin.editEvent") : t("admin.newEvent")}</h3>
            <button
              type="button"
              className="icon-button"
              onClick={() => setDraft(null)}
              aria-label={t("admin.cancelEdit")}
            >
              <X size={18} />
            </button>
          </div>
          <label htmlFor="event-title">{t("admin.eventTitle")}</label>
          <input
            id="event-title"
            value={draft.title}
            onChange={(event) => change("title", event.target.value)}
            maxLength={160}
            required
          />
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
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy || !draft.title.trim()}
            >
              <Save size={17} />
              {busy ? t("admin.saving") : t("admin.saveEvent")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("admin.cancel")}
            </button>
          </div>
        </form>
      )}
      {events.length === 0 && !draft && (
        <p className="admin-empty">{t("admin.emptyProgramme")}</p>
      )}
      <ul className="admin-event-list">
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <strong>{event.title}</strong>
              <p className="fine-print">
                {event.startsAt
                  ? formatDate(event.startsAt, timezone, true, locale)
                  : t("admin.timePending")}
              </p>
              <span className="fine-print">
                {event.unlockAt
                  ? t("admin.revealedAt", {
                      date: formatDate(event.unlockAt, timezone, true, locale),
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
                aria-label={t("admin.deleteNamedEvent", { name: event.title })}
                disabled={busy}
                onClick={() => deleteEvent(event)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
