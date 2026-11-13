"use client";

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { stepLabel, type StepDraft } from "./editor-model";
import { useWelcomeDrag } from "./use-welcome-drag";

export function WelcomeStepList({
  steps,
  selectedKey,
  disabled,
  onSelect,
  onMove,
}: {
  steps: StepDraft[];
  selectedKey: number | null;
  disabled: boolean;
  onSelect: (key: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { t, locale } = useI18n();
  const list = useRef<HTMLOListElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const { drag, bindings } = useWelcomeDrag({
    list,
    keys: steps.map((step) => step.key),
    rowKey: "stepKey",
    disabled,
    onStart: () => setAnnouncement(""),
    onMove,
    onCancel: () => setAnnouncement(t("adminWelcome.dragCancelled")),
  });
  const dragged = drag?.source.type === "existing" ? drag.source : null;
  // A drop on the row's own position moves nothing, so it shows no marker.
  const dropIndex = drag && drag.to !== dragged?.from ? drag.to : null;

  return (
    <>
      <ol
        className="welcome-step-list"
        ref={list}
        aria-label={t("adminWelcome.stepsTitle")}
      >
        {steps.map((step, index) => (
          <li
            key={step.key}
            data-step-key={step.key}
            data-selected={step.key === selectedKey || undefined}
            data-dragging={dragged?.key === step.key || undefined}
            data-drop={
              dragged && dropIndex === index
                ? dropIndex < dragged.from
                  ? "before"
                  : "after"
                : undefined
            }
          >
            <button
              type="button"
              className="welcome-drag-handle icon-button"
              disabled={disabled}
              aria-label={t("adminWelcome.drag", { number: number(index + 1) })}
              aria-describedby="welcome-reorder-hint"
              {...bindings({ type: "existing", key: step.key, from: index })}
            >
              <GripVertical size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="welcome-step-select"
              aria-label={t("adminWelcome.selectStep", {
                number: number(index + 1),
              })}
              aria-pressed={step.key === selectedKey}
              onClick={() => onSelect(step.key)}
            >
              <span className="welcome-list-number">{number(index + 1)}</span>
              <span className="welcome-list-copy">
                <strong>
                  {stepLabel(step).trim() ||
                    t("welcome.step", { number: number(index + 1) })}
                </strong>
                <span>
                  {t("widgets.count", { count: number(step.widgets.length) })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p id="welcome-reorder-hint" className="fine-print welcome-reorder-hint">
        {t("adminWelcome.reorderHint")}
      </p>
      <p className="welcome-announcement" role="status">
        {announcement}
      </p>
    </>
  );
}
