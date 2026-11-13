"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, Check, Ticket } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { useRealtimeResource } from "@/lib/use-realtime-resource";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import {
  eventsSchema,
  questionRoundSchema,
  type PartyEvent,
  type QuestionRound,
} from "./contracts";
import { QuestionComposer } from "./question-composer";
import "./activity-page.css";
import "./questions.css";

type ActivityHeading = Pick<PartyEvent, "id" | "title" | "description">;
const filters = ["pending", "answered", "joker"] as const;
type QuestionFilter = (typeof filters)[number];
const filterLabels = {
  pending: "questions.pendingTab",
  answered: "questions.answeredTab",
  joker: "questions.jokersTab",
} as const;
const emptyLabels = {
  pending: "questions.emptyPending",
  answered: "questions.emptyAnswered",
  joker: "questions.emptyJokers",
} as const;
const statusLabels = {
  draft: "questions.draftStatus",
  open: "questions.openStatus",
  closed: "questions.closedStatus",
} as const;

export function QuestionActivity({
  event,
  initial,
  isAdmin,
}: {
  event: ActivityHeading;
  initial: QuestionRound;
  isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const tabId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [heading, setHeading] = useState(event);
  const [round, setRound] = useState(initial);
  const [filter, setFilter] = useState<QuestionFilter>("pending");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const path = `/programme/${event.id}/questions`;
  const adminPath = `/admin/programme/${event.id}/questions`;
  const number = new Intl.NumberFormat(locale);

  const { connectionFailed, refresh, retry } = useRealtimeResource({
    topic: "programme",
    hasInitialData: true,
    async read(signal) {
      const current = generation.current;
      const [result, events] = await Promise.all([
        api(path, questionRoundSchema, { signal }),
        api(isAdmin ? "/admin/programme" : "/programme", eventsSchema, {
          signal,
        }),
      ]);
      signal.throwIfAborted();
      const latest = events.items.find((item) => item.id === event.id);
      if (!latest || latest.locked) {
        window.location.replace("/programme");
        return;
      }
      // A mutation started or finished during the request is newer.
      if (current === generation.current && !mutation.current) {
        setRound(result);
        setHeading({
          id: latest.id,
          title: latest.title,
          description: latest.description,
        });
      }
    },
    onError(err) {
      if (err instanceof ApiError && err.status === 404) {
        window.location.replace("/programme");
        return;
      }
      setError(errorMessage(err, t));
    },
  });

  useEffect(() => () => mutation.current?.abort(), []);

  async function mutate(url: string, method: "POST" | "PUT", input: object) {
    if (mutation.current) return false;
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await api(url, questionRoundSchema, {
        method,
        body: input,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      generation.current++;
      setRound(result);
      return true;
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err, t));
      return false;
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        void refresh();
      }
    }
  }

  async function transition() {
    if (
      round.status === "open" &&
      !(await confirm({ message: t("questions.closeConfirm") }))
    )
      return;
    await mutate(`${adminPath}/state`, "POST", {
      status: round.status === "draft" ? "open" : "closed",
      revision: round.revision,
    });
  }

  async function resolve(questionId: number, status: "answered" | "joker") {
    if (
      status === "joker" &&
      !(await confirm({ message: t("questions.jokerConfirm") }))
    )
      return;
    if (
      await mutate(`${adminPath}/resolve`, "PUT", {
        questionId,
        status,
        revision: round.revision,
      })
    ) {
      panel.current?.focus({ preventScroll: true });
    }
  }

  const questions = round.items.filter(
    (question) => question.status === filter,
  );
  const message =
    error ?? (connectionFailed ? t("common.connectionFailed") : null);

  return (
    <div className="question-page">
      <Link className="activity-back" href="/programme">
        <ArrowLeft size={21} aria-hidden="true" />
        {t("nav.programme")}
      </Link>
      <header className="question-heading">
        <div className="question-intro">
          <h1>{heading.title}</h1>
          <span className="question-round-status" data-status={round.status}>
            {t(statusLabels[round.status])}
          </span>
          <p className="question-rules">
            {t("questions.rules")}
            <br />
            {t("questions.jokerRule")}
          </p>
          {heading.description && (
            <p className="question-description">{heading.description}</p>
          )}
        </div>
        <div className="question-jokers" role="status">
          <span className="question-tickets" aria-hidden="true">
            {[0, 1].map((index) => (
              <Ticket
                key={index}
                size={26}
                className={index < round.jokersUsed ? "spent" : undefined}
              />
            ))}
          </span>
          <span>
            {t("questions.jokers", {
              count: number.format(2 - round.jokersUsed),
            })}
          </span>
        </div>
      </header>
      {message && (
        <div className="question-feedback">
          <ErrorNotice message={message} />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setError(null);
              void retry();
            }}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      <p className="question-notice success-notice" role="status">
        {notice}
      </p>
      <div className="question-layout">
        <section className="question-board" aria-label={t("questions.view")}>
          <div
            className="question-tabs"
            role="tablist"
            aria-label={t("questions.filter")}
          >
            {filters.map((value, index) => (
              <button
                key={value}
                type="button"
                id={`${tabId}-${value}`}
                role="tab"
                aria-selected={filter === value}
                aria-controls={`${tabId}-panel`}
                tabIndex={filter === value ? 0 : -1}
                onClick={() => setFilter(value)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % filters.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + filters.length - 1) % filters.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = filters.length - 1;
                  else return;
                  event.preventDefault();
                  setFilter(filters[next]);
                  document.getElementById(`${tabId}-${filters[next]}`)?.focus();
                }}
              >
                {t(filterLabels[value])}
              </button>
            ))}
          </div>
          <div
            ref={panel}
            id={`${tabId}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-${filter}`}
            tabIndex={0}
          >
            {filter === "pending" && questions.length > 0 && (
              <p className="question-sort">{t("questions.topVoted")}</p>
            )}
            {questions.length === 0 && (
              <p className="question-empty">
                {t(
                  round.questionCount === 0 && filter === "pending"
                    ? "questions.empty"
                    : emptyLabels[filter],
                )}
              </p>
            )}
            <ol className="question-list">
              {questions.map((question, index) => (
                <li
                  key={question.id}
                  className={`question-item${filter === "pending" && index === 0 ? " question-leading" : ""}`}
                >
                  <button
                    type="button"
                    className="question-upvote"
                    aria-label={t(
                      question.upvoted
                        ? "questions.unvote"
                        : "questions.upvote",
                    )}
                    aria-describedby={`${tabId}-question-${question.id}`}
                    aria-pressed={question.upvoted}
                    disabled={
                      busy ||
                      round.status !== "open" ||
                      question.status !== "pending"
                    }
                    onClick={() =>
                      void mutate(`${path}/upvote`, "PUT", {
                        questionId: question.id,
                        upvoted: !question.upvoted,
                      })
                    }
                  >
                    <ArrowUp size={21} aria-hidden="true" />
                    <span>{number.format(question.votes)}</span>
                  </button>
                  <div className="question-content">
                    <p id={`${tabId}-question-${question.id}`}>
                      {question.body}
                    </p>
                    {question.status !== "pending" && (
                      <span className="question-status">
                        {question.status === "answered" ? (
                          <Check size={16} aria-hidden="true" />
                        ) : (
                          <Ticket size={16} aria-hidden="true" />
                        )}
                        {t(
                          question.status === "answered"
                            ? "questions.answered"
                            : "questions.joker",
                        )}
                      </span>
                    )}
                    {isAdmin && question.status === "pending" && (
                      <div className="question-host-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => void resolve(question.id, "answered")}
                        >
                          <Check size={17} aria-hidden="true" />
                          {t("questions.markAnswered")}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy || round.jokersUsed >= 2}
                          onClick={() => void resolve(question.id, "joker")}
                        >
                          <Ticket size={19} aria-hidden="true" />
                          {t("questions.useJoker")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <QuestionComposer
          status={round.status}
          full={round.questionCount >= 200}
          busy={busy}
          error={message}
          onSend={async (body) => {
            const sent = await mutate(path, "POST", { body });
            if (sent) {
              setFilter("pending");
              setNotice(t("questions.sent"));
            }
            return sent;
          }}
        >
          {(isAdmin || round.status !== "open") && (
            <div className="question-management">
              <h2>{t(statusLabels[round.status])}</h2>
              {round.status !== "open" && (
                <p className="muted">
                  {t(
                    round.status === "draft"
                      ? "questions.draft"
                      : "questions.closed",
                  )}
                </p>
              )}
              {isAdmin && round.status !== "closed" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void transition()}
                >
                  {t(
                    round.status === "draft"
                      ? "questions.open"
                      : "questions.close",
                  )}
                </button>
              )}
            </div>
          )}
        </QuestionComposer>
      </div>
    </div>
  );
}
