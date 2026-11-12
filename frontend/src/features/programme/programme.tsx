"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
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
import { createInvalidationRefresh } from "@/lib/invalidation-refresh";
import { retryRealtime, subscribeRealtime } from "@/lib/realtime-browser";
import { eventsSchema, type PartyEvent } from "./contracts";
import { formatDate } from "@/lib/dates";
import { type Party } from "@/features/party/contracts";
import { PageHeading, EmptyState, ErrorNotice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { VoteActivity, VoteStatus } from "./vote-activity";
import { replaceEvent } from "./vote-model";
import { ActivityLink } from "./activity-link";
import "./programme.css";

function ProgrammeEvent({
  event,
  timezone,
  partyDate,
  guestId,
  isAdmin,
  featured,
  showAgendaHeading,
  onSave,
}: {
  event: PartyEvent;
  timezone: string;
  partyDate: string | null;
  guestId: number;
  isAdmin: boolean;
  featured: boolean;
  showAgendaHeading: boolean;
  onSave: (event: PartyEvent) => void;
}) {
  const { locale, t } = useI18n();
  const heading = useId();
  const questionHeading = useId();
  const [expanded, setExpanded] = useState(false);
  const vote = event.locked ? null : event.vote;
  const questionIsTitle = vote?.question === event.title;
  const previewCandidates =
    vote?.candidates.filter((candidate) => candidate.active) ?? [];
  const showVote = expanded || (vote !== null && vote.status !== "open");
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
  let voteAction = t("programme.vote");
  if (expanded) voteAction = t("programme.hideVote");
  else if (vote && !vote.canVote) voteAction = t("programme.viewVote");
  else if (vote?.myCandidateId != null) voteAction = t("programme.changeVote");

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
                {t("activities.openStatus")}
              </p>
              <h2 id={questionHeading} className="programme-vote-question">
                {vote.question}
              </h2>
            </>
          ) : (
            <>
              {vote && <VoteStatus status={vote.status} />}
              <h2
                id={heading}
                className={
                  vote && !questionIsTitle ? "programme-vote-title" : undefined
                }
              >
                {title}
              </h2>
              {vote && !questionIsTitle && (
                <h3 id={questionHeading} className="programme-vote-question">
                  {vote.question}
                </h3>
              )}
            </>
          )}
          {event.locked ? (
            <p className="programme-event-note">{unlockMessage}</p>
          ) : (
            !featured &&
            event.description && (
              <p className="programme-event-description">{event.description}</p>
            )
          )}
          {vote && (
            <>
              {vote.status === "open" && (
                <div className="programme-vote-preview" aria-hidden="true">
                  {previewCandidates.slice(0, 3).map((candidate) => (
                    <Avatar
                      key={candidate.id}
                      name={candidate.name}
                      avatarUrl={candidate.avatarUrl}
                    />
                  ))}
                  {!featured && previewCandidates.length > 3 && (
                    <span>
                      +
                      {new Intl.NumberFormat(locale).format(
                        previewCandidates.length - 3,
                      )}
                    </span>
                  )}
                </div>
              )}
              <details
                className="programme-ballot"
                open={showVote}
                onToggle={(event) => {
                  if (vote.status === "open")
                    setExpanded(event.currentTarget.open);
                }}
              >
                <summary
                  className="button primary"
                  hidden={vote.status !== "open"}
                >
                  {voteAction}
                </summary>
                {featured && (
                  <div className="programme-vote-details">
                    {!questionIsTitle && <h3>{event.title}</h3>}
                    {event.startsAt && (
                      <p className="programme-event-note">
                        {formatDate(event.startsAt, timezone, true, locale)}
                      </p>
                    )}
                    {event.description && (
                      <p className="programme-event-description">
                        {event.description}
                      </p>
                    )}
                  </div>
                )}
                {isAdmin && vote.participationCount !== null && (
                  <p className="programme-event-note programme-participation">
                    {t("activities.participation", {
                      count: new Intl.NumberFormat(locale).format(
                        vote.participationCount,
                      ),
                    })}
                  </p>
                )}
                <VoteActivity
                  event={event}
                  vote={vote}
                  guestId={guestId}
                  headingId={
                    featured || !questionIsTitle ? questionHeading : heading
                  }
                  onSave={onSave}
                />
              </details>
            </>
          )}
        </div>
        {!event.locked && event.questions && <ActivityLink event={event} />}
      </article>
    </li>
  );
}

export function Programme({
  initial,
  party,
  guestId,
  isAdmin,
}: {
  initial: PartyEvent[];
  party: Party;
  guestId: number;
  isAdmin: boolean;
}) {
  const { locale, t } = useI18n();
  const [events, setEvents] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const retry = useRef<() => void>(() => {});
  const savedRevision = useRef(0);
  const featured = events.find(
    (event) => !event.locked && event.vote?.status === "open",
  );
  // Stable keys keep each ballot's draft when realtime updates change its placement.
  const displayedEvents = featured
    ? [featured, ...events.filter((event) => event.id !== featured.id)]
    : events;

  function saveVote(saved: PartyEvent) {
    savedRevision.current++;
    setEvents((current) => replaceEvent(current, saved));
  }

  useEffect(() => {
    let disposed = false;
    const refresh = createInvalidationRefresh(
      async (signal) => {
        const revision = savedRevision.current;
        const data = await api("/programme", eventsSchema, {
          signal,
        });
        signal.throwIfAborted();
        if (revision === savedRevision.current) setEvents(data.items);
        setError(null);
      },
      (err) => setError(errorMessage(err, t)),
    );
    retry.current = () => {
      retryRealtime();
      setBusy(true);
      void refresh.request().finally(() => {
        if (!disposed) setBusy(false);
      });
    };
    const unsubscribe = subscribeRealtime(
      "programme",
      () => void refresh.request(),
      (connected) => setConnectionFailed(!connected),
    );
    return () => {
      disposed = true;
      retry.current = () => {};
      unsubscribe();
      refresh.dispose();
    };
  }, [initial, t]);

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
          onClick={() => retry.current()}
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
              guestId={guestId}
              isAdmin={isAdmin}
              featured={event.id === featured?.id}
              showAgendaHeading={index === (featured ? 1 : 0)}
              onSave={saveVote}
            />
          ))}
        </ol>
      )}
    </>
  );
}
