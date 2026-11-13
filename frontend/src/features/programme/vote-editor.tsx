"use client";

import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "../guests/contracts";
import type { VoteDraft } from "./event-draft";
import { choiceLength, optionLimit } from "./vote-model";

/** `commit` asks for an immediate save, for controls that never blur. */
type ChangeVote = (draft: VoteDraft, commit?: boolean) => void;

const sources = [
  { value: "guests", label: "activities.sourceGuests" },
  { value: "custom", label: "activities.sourceCustom" },
] as const;

function CandidatePicker({
  draft,
  guests,
  busy,
  onChange,
}: {
  draft: VoteDraft;
  guests: Guest[];
  busy: boolean;
  onChange: ChangeVote;
}) {
  const { t, locale } = useI18n();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const eligible = guests.filter((guest) => guest.active);
  const visible = eligible.filter((guest) =>
    guest.name
      .toLocaleLowerCase(locale)
      .includes(search.trim().toLocaleLowerCase(locale)),
  );
  const selected = new Set(draft.candidateIds);
  function toggle(id: number) {
    onChange(
      {
        ...draft,
        candidateIds: selected.has(id)
          ? [...selected].filter((candidateId) => candidateId !== id)
          : [...selected, id],
      },
      true,
    );
  }
  return (
    <>
      <fieldset className="activity-candidate-picker" disabled={busy}>
        <legend>{t("activities.candidates")}</legend>
        <label className="visually-hidden" htmlFor={searchId}>
          {t("activities.search")}
        </label>
        <input
          id={searchId}
          type="search"
          placeholder={t("activities.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="section-row activity-selection-actions">
          <span className="fine-print">
            {t("activities.selected", {
              count: new Intl.NumberFormat(locale).format(selected.size),
            })}
          </span>
          <div className="button-row">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange(
                  {
                    ...draft,
                    candidateIds: eligible
                      .slice(0, optionLimit)
                      .map((guest) => guest.id),
                  },
                  true,
                )
              }
            >
              {t("activities.selectAll")}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => onChange({ ...draft, candidateIds: [] }, true)}
            >
              {t("activities.clear")}
            </button>
          </div>
        </div>
        <div className="activity-candidate-list">
          {visible.map((guest) => (
            <label key={guest.id} className="activity-candidate-option">
              <input
                type="checkbox"
                checked={selected.has(guest.id)}
                disabled={
                  !selected.has(guest.id) && selected.size >= optionLimit
                }
                onChange={() => toggle(guest.id)}
                aria-label={guest.name}
              />
              <Avatar name={guest.name} avatarUrl={guest.avatarUrl} />
              <span>{guest.name}</span>
            </label>
          ))}
        </div>
        {visible.length === 0 && (
          <p className="fine-print">{t("activities.noMatch")}</p>
        )}
      </fieldset>
      <label className="activity-checkbox">
        <input
          type="checkbox"
          checked={draft.allowSelfVote}
          disabled={busy}
          onChange={(event) =>
            onChange({ ...draft, allowSelfVote: event.target.checked }, true)
          }
        />
        {t("activities.allowSelf")}
      </label>
    </>
  );
}

function ChoiceList({
  draft,
  busy,
  onChange,
}: {
  draft: VoteDraft;
  busy: boolean;
  onChange: ChangeVote;
}) {
  const { t } = useI18n();
  const addButton = useRef<HTMLButtonElement>(null);
  // Only a row the host just added takes the focus, never the saved ones.
  const [focusLastRow, setFocusLastRow] = useState(false);
  const { labels } = draft;
  const full = labels.length >= optionLimit;

  function add() {
    setFocusLastRow(true);
    onChange({ ...draft, labels: [...labels, ""] });
  }

  function edit(row: number, label: string) {
    onChange({
      ...draft,
      labels: labels.map((current, index) => (index === row ? label : current)),
    });
  }

  function removeRow(row: number) {
    onChange(
      { ...draft, labels: labels.filter((_, index) => index !== row) },
      true,
    );
    // The row's button is gone; the next action is usually another choice.
    addButton.current?.focus();
  }

  return (
    <>
      <fieldset className="vote-choice-editor" disabled={busy}>
        <legend>{t("activities.choices")}</legend>
        <ol className="vote-choice-list">
          {labels.map((label, row) => (
            // Rows are never reordered, so their position identifies them.
            <li key={row}>
              <input
                value={label}
                maxLength={choiceLength}
                autoFocus={focusLastRow && row === labels.length - 1}
                aria-label={t("activities.choice", { number: row + 1 })}
                onChange={(event) => edit(row, event.target.value)}
              />
              <button
                type="button"
                className="icon-button danger"
                aria-label={t("activities.removeChoice", { number: row + 1 })}
                onClick={() => removeRow(row)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <button
          ref={addButton}
          type="button"
          className="text-button"
          disabled={full}
          onClick={add}
        >
          <Plus size={17} aria-hidden="true" />
          {t("activities.addChoice")}
        </button>
        {full && <p className="fine-print">{t("errors.vote_option_limit")}</p>}
      </fieldset>
      <label className="activity-checkbox">
        <input
          type="checkbox"
          checked={draft.allowWriteIns}
          disabled={busy}
          onChange={(event) =>
            onChange({ ...draft, allowWriteIns: event.target.checked }, true)
          }
        />
        {t("activities.allowWriteIns")}
      </label>
    </>
  );
}

export function VoteEditor({
  draft,
  frozen,
  guests,
  busy,
  onChange,
}: {
  draft: VoteDraft;
  /** The vote has opened: only its question can still change. */
  frozen: boolean;
  guests: Guest[];
  busy: boolean;
  onChange: ChangeVote;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="vote-editor">
      <label htmlFor={`${id}-question`}>{t("activities.question")}</label>
      <input
        id={`${id}-question`}
        required
        maxLength={240}
        value={draft.question}
        onChange={(event) =>
          onChange({ ...draft, question: event.target.value })
        }
        disabled={busy}
      />
      {frozen ? (
        <p className="fine-print">{t("activities.frozen")}</p>
      ) : (
        <>
          <fieldset className="vote-source" disabled={busy}>
            <legend>{t("activities.source")}</legend>
            {sources.map(({ value, label }) => (
              <label key={value} className="activity-checkbox">
                <input
                  type="radio"
                  name={`${id}-source`}
                  checked={draft.choices === value}
                  onChange={() => onChange({ ...draft, choices: value }, true)}
                />
                {t(label)}
              </label>
            ))}
          </fieldset>
          {draft.choices === "guests" ? (
            <CandidatePicker
              draft={draft}
              guests={guests}
              busy={busy}
              onChange={onChange}
            />
          ) : (
            <ChoiceList draft={draft} busy={busy} onChange={onChange} />
          )}
        </>
      )}
    </div>
  );
}
