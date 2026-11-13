"use client";

import { useId, useState } from "react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "../guests/contracts";
import type { VoteDraft } from "./event-draft";

export function VoteEditor({
  draft,
  frozen,
  guests,
  busy,
  onChange,
}: {
  draft: VoteDraft;
  frozen: boolean;
  guests: Guest[];
  busy: boolean;
  onChange: (draft: VoteDraft, commit?: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
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
          <fieldset className="activity-candidate-picker" disabled={busy}>
            <legend>{t("activities.candidates")}</legend>
            <label className="visually-hidden" htmlFor={`${id}-search`}>
              {t("activities.search")}
            </label>
            <input
              id={`${id}-search`}
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
                          .slice(0, 200)
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
                    disabled={!selected.has(guest.id) && selected.size >= 200}
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
                onChange(
                  { ...draft, allowSelfVote: event.target.checked },
                  true,
                )
              }
            />
            {t("activities.allowSelf")}
          </label>
        </>
      )}
    </div>
  );
}
