"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { formatDate } from "@/lib/dates";
import { useI18n } from "@/lib/i18n-context";
import { ActivityLink } from "./activity-link";
import type { PartyEvent } from "./contracts";
import { VoteResults, VoteStatus } from "./vote-activity";
import { voteTransitions } from "./vote-model";

const previewedCandidates = 8;

/** The host's list of saved events with their edit, delete and vote actions. */
export function EventList({
  events,
  timezone,
  busy,
  onEdit,
  onDelete,
  onTransition,
  beforeNavigate,
}: {
  events: PartyEvent[];
  timezone: string;
  busy: boolean;
  onEdit: (event: PartyEvent) => void;
  onDelete: (event: PartyEvent) => void;
  /** Moves a vote to its next state: open, closed, then revealed. */
  onTransition: (event: PartyEvent) => void;
  /** Saves the open draft before leaving for an activity page. */
  beforeNavigate: () => Promise<boolean>;
}) {
  const { locale, t } = useI18n();
  const numbers = new Intl.NumberFormat(locale);
  return (
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
                onClick={() => onEdit(event)}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-button danger"
                aria-label={t("admin.deleteNamedEvent", {
                  name: event.title,
                })}
                disabled={busy}
                onClick={() => onDelete(event)}
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
                {event.vote.candidates
                  .slice(0, previewedCandidates)
                  .map((candidate) => (
                    <Avatar
                      key={candidate.id}
                      name={candidate.name}
                      avatarUrl={candidate.avatarUrl}
                    />
                  ))}
                {event.vote.candidates.length > previewedCandidates && (
                  <span>
                    +
                    {numbers.format(
                      event.vote.candidates.length - previewedCandidates,
                    )}
                  </span>
                )}
              </div>
              {event.vote.participationCount !== null && (
                <p className="fine-print">
                  {t("activities.participation", {
                    count: numbers.format(event.vote.participationCount),
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
                  onClick={() => onTransition(event)}
                >
                  {t(voteTransitions[event.vote.status].label)}
                </button>
              )}
            </div>
          )}
          <ActivityLink event={event} beforeNavigate={beforeNavigate} />
        </li>
      ))}
    </ul>
  );
}
