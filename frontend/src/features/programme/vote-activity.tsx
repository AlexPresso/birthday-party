"use client";

import { useId, useState } from "react";
import { Check, Vote as VoteIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ErrorNotice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { eventSchema, type PartyEvent, type Vote } from "./contracts";
import { rankedResults } from "./vote-model";
import "./activities.css";

export function VoteStatus({ status }: { status: Vote["status"] }) {
  const { t } = useI18n();
  const key =
    status === "open"
      ? "activities.openStatus"
      : (`activities.${status}` as const);
  return (
    <span className={`activity-status activity-status-${status}`}>
      <VoteIcon size={14} aria-hidden="true" />
      {t(key)}
    </span>
  );
}

export function VoteResults({ vote }: { vote: Vote }) {
  const { t, locale } = useI18n();
  const results = rankedResults(vote);
  const maximum = results[0]?.votes ?? 0;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  if (maximum === 0)
    return <p className="muted">{t("activities.noResults")}</p>;
  return (
    <ol className="vote-results" aria-label={t("activities.revealed")}>
      {results.map(({ candidate, votes, rank }) => (
        <li key={candidate.id}>
          <span className="vote-rank">{number(rank)}</span>
          <Avatar name={candidate.name} avatarUrl={candidate.avatarUrl} />
          <div className="vote-result-detail">
            <div>
              <strong>{candidate.name}</strong>
              <span>{t("activities.votes", { count: number(votes) })}</span>
            </div>
            <span className="vote-result-track" aria-hidden="true">
              <span style={{ width: `${(votes / maximum) * 100}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function VoteActivity({
  event,
  vote,
  guestId,
  headingId,
  onSave,
}: {
  event: PartyEvent;
  vote: Vote;
  guestId: number;
  headingId: string;
  onSave: (event: PartyEvent) => void;
}) {
  const { t, locale } = useI18n();
  const searchId = useId();
  const [selection, setSelection] = useState<number | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = selection ?? vote.myCandidateId;
  const selected = vote.candidates.find(
    (candidate) => candidate.id === selectedId,
  );
  const saved = vote.candidates.find(
    (candidate) => candidate.id === vote.myCandidateId,
  );
  const canSelect = (candidate: Vote["candidates"][number]) =>
    candidate.active && (vote.allowSelfVote || candidate.id !== guestId);
  const candidates = vote.candidates.filter((candidate) =>
    candidate.name
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale)),
  );

  async function cast(submission: React.FormEvent) {
    submission.preventDefault();
    if (!selected || !canSelect(selected) || !vote.canVote || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/programme/${event.id}/vote`, eventSchema, {
        method: "PUT",
        body: { candidateId: selected.id },
      });
      onSave(result);
      setSelection(undefined);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="programme-vote" aria-labelledby={headingId}>
      {vote.status === "revealed" ? (
        <VoteResults vote={vote} />
      ) : (
        <>
          {vote.status === "open" && vote.canVote ? (
            <form onSubmit={cast}>
              <p className="vote-instruction">
                {t("activities.rules")}{" "}
                {!vote.allowSelfVote && t("activities.noSelf")}
              </p>
              <label className="visually-hidden" htmlFor={searchId}>
                {t("activities.search")}
              </label>
              <input
                id={searchId}
                className="vote-search"
                type="search"
                placeholder={t("activities.search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <fieldset className="vote-candidates" disabled={busy}>
                <legend className="visually-hidden">{vote.question}</legend>
                {candidates.map((candidate) => (
                  <label
                    className="vote-candidate"
                    key={candidate.id}
                    data-disabled={!canSelect(candidate) || undefined}
                  >
                    <input
                      type="radio"
                      name={`vote-${event.id}`}
                      value={candidate.id}
                      checked={selectedId === candidate.id}
                      onChange={() => setSelection(candidate.id)}
                      disabled={!canSelect(candidate)}
                      aria-label={candidate.name}
                    />
                    <span className="vote-candidate-content">
                      <Avatar
                        name={candidate.name}
                        avatarUrl={candidate.avatarUrl}
                      />
                      <span className="vote-candidate-name">
                        {candidate.name}
                      </span>
                      {candidate.id === guestId && (
                        <span className="vote-candidate-note">
                          {t("activities.you")}
                        </span>
                      )}
                      {!candidate.active && (
                        <span className="vote-candidate-note">
                          {t("activities.inactive")}
                        </span>
                      )}
                      <Check
                        className="vote-selection"
                        size={17}
                        aria-hidden="true"
                      />
                    </span>
                  </label>
                ))}
              </fieldset>
              {candidates.length === 0 && (
                <p className="muted">{t("activities.noMatch")}</p>
              )}
              <div className="vote-confirmation">
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !selected ||
                    !canSelect(selected) ||
                    selected.id === vote.myCandidateId
                  }
                >
                  {busy
                    ? t("activities.saving")
                    : selected
                      ? t("activities.voteFor", { name: selected.name })
                      : t("activities.confirm")}
                </button>
                <p
                  className={saved ? "success-notice" : "fine-print"}
                  role="status"
                >
                  {saved
                    ? t("activities.saved", { name: saved.name })
                    : t("activities.choose")}
                </p>
              </div>
            </form>
          ) : (
            <p className="muted">
              {t(
                vote.status === "closed"
                  ? "activities.waitResults"
                  : "activities.unavailable",
              )}
            </p>
          )}
          {vote.status === "closed" && saved && (
            <p className="fine-print">
              {t("activities.saved", { name: saved.name })}
            </p>
          )}
        </>
      )}
      <ErrorNotice message={error} />
    </section>
  );
}
