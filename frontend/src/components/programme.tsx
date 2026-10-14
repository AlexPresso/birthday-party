"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Gift,
  LockKeyhole,
  MapPin,
  Clock3,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  eventsSchema,
  formatDate,
  type PartyEvent,
  type Party,
} from "@/lib/contracts";
import { PageHeading, EmptyState, ErrorNotice } from "./ui";

export function Programme({
  initial,
  party,
}: {
  initial: PartyEvent[];
  party: Party;
}) {
  const { locale, t } = useI18n();
  const [events, setEvents] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (items: PartyEvent[]) => {
      const instants = items
        .filter((event) => event.locked && event.unlockAt)
        .map((event) => Date.parse(event.unlockAt!));
      // Re-fetch at an unlock boundary; periodic refresh also discovers host edits.
      const delay = instants.length
        ? Math.min(
            60000,
            Math.max(5000, Math.min(...instants) - Date.now() + 500),
          )
        : 60000;
      timer = setTimeout(refresh, delay);
    };
    const refresh = async () => {
      if (document.hidden) {
        timer = setTimeout(refresh, 60000);
        return;
      }
      try {
        const data = await api("/programme", eventsSchema, {
          signal: controller.signal,
        });
        setEvents(data.items);
        setError(null);
        schedule(data.items);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(errorMessage(err, t));
          timer = setTimeout(refresh, 60000);
        }
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void refresh();
      }
    };
    schedule(initial);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initial, t]);

  async function refreshNow() {
    setBusy(true);
    try {
      const data = await api("/programme", eventsSchema);
      setEvents(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title={t("programme.title")}
        description={t("programme.description")}
      >
        <button
          className="icon-button"
          onClick={refreshNow}
          disabled={busy}
          aria-label={t("programme.refresh")}
        >
          <RefreshCw size={20} className={busy ? "spin" : ""} />
        </button>
      </PageHeading>
      {(party.date || party.location) && (
        <div className="party-details panel">
          {party.date && (
            <p>
              <CalendarDays size={19} />
              <span>
                {formatDate(party.date, party.timezone, true, locale)}
              </span>
            </p>
          )}
          {party.location && (
            <p>
              <MapPin size={19} />
              <span>{party.location}</span>
            </p>
          )}
        </div>
      )}
      <ErrorNotice message={error} />
      {events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={36} strokeWidth={1.4} />}
          title={t("programme.emptyTitle")}
        >
          <p>{t("programme.emptyDescription")}</p>
        </EmptyState>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li
              className={`timeline-item ${event.locked ? "is-locked" : ""}`}
              key={event.id}
            >
              <div className="timeline-marker" aria-hidden="true">
                {event.locked ? (
                  <Gift size={25} strokeWidth={1.6} />
                ) : (
                  <CalendarDays size={25} strokeWidth={1.6} />
                )}
              </div>
              <article className="event-card">
                <div className="section-row">
                  <span
                    className={`status-label ${event.locked ? "" : "available"}`}
                  >
                    {event.locked ? (
                      <>
                        <LockKeyhole size={12} /> {t("programme.locked")}
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} /> {t("programme.available")}
                      </>
                    )}
                  </span>
                </div>
                <h2>
                  {event.locked && !event.title
                    ? t("programme.surprise")
                    : event.title}
                </h2>
                {event.startsAt && (
                  <p className="event-time">
                    <Clock3 size={14} />
                    {formatDate(event.startsAt, party.timezone, true, locale)}
                  </p>
                )}
                {event.locked ? (
                  <p className="muted">
                    {event.unlockAt
                      ? t("programme.unlockAt", {
                          date: formatDate(
                            event.unlockAt,
                            party.timezone,
                            true,
                            locale,
                          ),
                        })
                      : t("programme.waiting")}
                  </p>
                ) : (
                  event.description && (
                    <p className="event-description">{event.description}</p>
                  )
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
