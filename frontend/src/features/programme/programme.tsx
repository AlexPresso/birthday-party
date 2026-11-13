"use client";
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  CalendarDays,
  LockKeyhole,
  MapPin,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import { eventsSchema, type PartyEvent, type VoteOption } from "./contracts";
import { formatDate } from "@/lib/dates";
import { type Party } from "@/features/party/contracts";
import { PageHeading, EmptyState, ErrorNotice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { VoteStatus } from "./vote-status";
import { ActivityLink } from "./activity-link";
import "./programme.css";

const previewedOptions = 3;

/** The leading options of the featured vote: portraits for guests, labels otherwise. */
function VotePreview({ options }: { options: VoteOption[] }) {
  return (
    <div className="programme-vote-preview" aria-hidden="true">
      {options.map((option) =>
        option.guestId !== null ? (
          <Avatar
            key={option.id}
            name={option.label}
            avatarUrl={option.avatarUrl}
          />
        ) : (
          <span key={option.id} className="programme-vote-choice">
            {option.label}
          </span>
        ),
      )}
    </div>
  );
}

function ProgrammeEvent({
  event,
  timezone,
  partyDate,
  featured,
  showAgendaHeading,
}: {
  event: PartyEvent;
  timezone: string;
  partyDate: string | null;
  featured: boolean;
  showAgendaHeading: boolean;
}) {
  const { locale, t } = useI18n();
  const vote = event.locked ? null : event.vote;
  const questionIsTitle = vote?.question === event.title;
  const title =
    event.locked && !event.title ? t("programme.surprise") : event.title;
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const isPartyDay = (value: string) =>
    partyDate !== null &&
    day.format(new Date(value)) === day.format(new Date(partyDate));
  const showDate = event.startsAt && !isPartyDay(event.startsAt);
  let unlockMessage = t("programme.waiting");
  if (event.unlockAt) {
    unlockMessage = isPartyDay(event.unlockAt)
      ? t("programme.unlockTime", {
          time: new Intl.DateTimeFormat(locale, {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(event.unlockAt)),
        })
      : t("programme.unlockAt", {
          date: formatDate(event.unlockAt, timezone, true, locale),
        });
  }

  return (
    <li className={featured ? "programme-featured" : "programme-agenda-item"}>
      {showAgendaHeading && (
        <h2 className="programme-agenda-heading">{t("programme.agenda")}</h2>
      )}
      <article className="programme-event" aria-label={title}>
        {!featured && (
          <div className="programme-time">
            {event.startsAt ? (
              <time
                dateTime={event.startsAt}
                aria-label={formatDate(event.startsAt, timezone, true, locale)}
              >
                {showDate && (
                  <span>
                    {new Intl.DateTimeFormat(locale, {
                      timeZone: timezone,
                      day: "numeric",
                      month: "short",
                    }).format(new Date(event.startsAt))}
                  </span>
                )}
                <strong>
                  {new Intl.DateTimeFormat(locale, {
                    timeZone: timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(event.startsAt))}
                </strong>
              </time>
            ) : (
              <>
                <span aria-hidden="true">—</span>
                <span className="visually-hidden">{t("programme.noTime")}</span>
              </>
            )}
          </div>
        )}
        <div
          className={`programme-event-content${event.locked ? " programme-event-locked" : ""}`}
        >
          {event.locked && (
            <span className="programme-lock">
              <LockKeyhole size={21} aria-hidden="true" />
              <span className="visually-hidden">{t("programme.locked")}</span>
            </span>
          )}
          {featured && vote ? (
            <>
              <p className="programme-featured-status">
                <VoteStatus status={vote.status} />
              </p>
              <h2 className="programme-vote-question">{vote.question}</h2>
              {vote.options.length > 0 && (
                <VotePreview
                  options={vote.options.slice(0, previewedOptions)}
                />
              )}
              <ActivityLink event={event} variant="featured" />
            </>
          ) : (
            <>
              {vote && <VoteStatus status={vote.status} />}
              <h2
                className={
                  vote && !questionIsTitle ? "programme-vote-title" : undefined
                }
              >
                {title}
              </h2>
              {vote && !questionIsTitle && (
                <h3 className="programme-vote-question">{vote.question}</h3>
              )}
              {event.locked ? (
                <p className="programme-event-note">{unlockMessage}</p>
              ) : (
                event.description && (
                  <p className="programme-event-description">
                    {event.description}
                  </p>
                )
              )}
            </>
          )}
        </div>
        {!featured && <ActivityLink event={event} />}
      </article>
    </li>
  );
}

export function Programme({
  initial,
  party,
  isAdmin,
}: {
  initial: PartyEvent[];
  party: Party;
  isAdmin: boolean;
}) {
  const { locale, t } = useI18n();
  const [events, setEvents] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { connectionFailed, retry } = useRealtimeResource({
    topic: "programme",
    hasInitialData: true,
    restartKey: initial,
    async read(signal) {
      const data = await api("/programme", eventsSchema, { signal });
      signal.throwIfAborted();
      setEvents(data.items);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, t)),
  });
  // The first open vote leaves the agenda for the featured card.
  const featured = events.find(
    (event) => !event.locked && event.vote?.status === "open",
  );
  const displayedEvents = featured
    ? [featured, ...events.filter((event) => event.id !== featured.id)]
    : events;

  return (
    <>
      <PageHeading
        inHeader
        title={t("programme.title")}
        description={
          party.date
            ? formatDate(party.date, party.timezone, false, locale)
            : undefined
        }
      />
      {isAdmin && (
        <div className="programme-admin-actions">
          <Link
            className="button secondary"
            href="/parametres?section=programme"
          >
            <Pencil size={17} />
            {t("programme.manage")}
          </Link>
        </div>
      )}
      {party.location && (
        <div className="programme-party-details">
          <p>
            <MapPin size={19} aria-hidden="true" />
            <span>{party.location}</span>
          </p>
        </div>
      )}
      <ErrorNotice
        message={
          error ?? (connectionFailed ? t("common.connectionFailed") : null)
        }
      />
      {(error || connectionFailed || busy) && (
        <button
          className="button secondary programme-retry"
          onClick={() => {
            setBusy(true);
            void retry().finally(() => setBusy(false));
          }}
          disabled={busy}
        >
          <RefreshCw
            size={17}
            className={busy ? "spin" : ""}
            aria-hidden="true"
          />
          {t("programme.refresh")}
        </button>
      )}
      {events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={36} strokeWidth={1.4} />}
          title={t("programme.emptyTitle")}
        >
          <p>{t("programme.emptyDescription")}</p>
        </EmptyState>
      ) : (
        <ol
          className="programme-list"
          style={
            {
              "--agenda-rows": Math.max(1, displayedEvents.length - 1),
            } as CSSProperties
          }
        >
          {displayedEvents.map((event, index) => (
            <ProgrammeEvent
              key={event.id}
              event={event}
              timezone={party.timezone}
              partyDate={party.date}
              featured={event.id === featured?.id}
              showAgendaHeading={index === (featured ? 1 : 0)}
            />
          ))}
        </ol>
      )}
    </>
  );
}
