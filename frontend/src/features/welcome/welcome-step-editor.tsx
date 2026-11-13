"use client";

import { useRef, useState, type FocusEventHandler } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { type MediaCategory } from "@/features/media/contracts";
import { useI18n } from "@/lib/i18n-context";
import { moveItem } from "@/lib/reorder";
import type { StepDraft } from "./editor-model";
import { WelcomeStepList } from "./welcome-step-list";
import { WelcomeWidgetEditor } from "./welcome-widget-editor";

const maximumSteps = 12;

function focusStep(key: number) {
  document
    .querySelector<HTMLButtonElement>(
      `.welcome-step-list [data-step-key="${key}"] .welcome-step-select`,
    )
    ?.focus();
}

function focusAddWidget() {
  document.querySelector<HTMLButtonElement>(".welcome-widget-add")?.focus();
}

/**
 * Edits the ordered steps of the welcome draft. The owner holds the draft,
 * allocates its stable keys and saves it; this form changes it through
 * `onChange` and keeps keyboard focus on the step that was moved or removed.
 */
export function WelcomeStepEditor({
  steps,
  selectedKey,
  disabled,
  categories,
  onSelect,
  onChange,
  createStepKey,
  createWidgetKey,
  onBlur,
  onSubmit,
}: {
  steps: StepDraft[];
  selectedKey: number | null;
  disabled: boolean;
  categories: MediaCategory[];
  onSelect: (key: number | null) => void;
  onChange: (update: (current: StepDraft[]) => StepDraft[]) => void;
  createStepKey: () => number;
  createWidgetKey: () => number;
  onBlur: FocusEventHandler<HTMLElement>;
  onSubmit: () => void;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const addButton = useRef<HTMLButtonElement>(null);
  const [reorderNotice, setReorderNotice] = useState("");
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const selectedIndex = steps.findIndex((step) => step.key === selectedKey);
  const selected = steps[selectedIndex];

  function move(from: number, to: number) {
    if (disabled) return;
    onChange((current) => moveItem(current, from, to));
    setReorderNotice(
      t("adminWelcome.moved", { from: number(from + 1), to: number(to + 1) }),
    );
  }

  function moveSelected(to: number, button: HTMLButtonElement) {
    const key = selectedKey;
    move(selectedIndex, to);
    // At either end the pressed button becomes disabled and would lose focus.
    requestAnimationFrame(() => {
      if (button.disabled && key !== null) focusStep(key);
    });
  }

  async function removeStep(index: number) {
    if (disabled) return;
    const step = steps[index];
    if (
      step.widgets.length > 0 &&
      !(await confirm({
        message: t("adminWelcome.removeConfirmation", {
          number: number(index + 1),
        }),
        destructive: true,
      }))
    )
      return;
    onChange((current) => current.filter((item) => item.key !== step.key));
    if (selectedKey === step.key) {
      const next = steps[index + 1]?.key ?? steps[index - 1]?.key ?? null;
      onSelect(next);
      requestAnimationFrame(() => {
        if (next === null) addButton.current?.focus();
        else focusStep(next);
      });
    }
  }

  function addStep() {
    const key = createStepKey();
    onChange((current) => [...current, { key, widgets: [] }]);
    onSelect(key);
    requestAnimationFrame(focusAddWidget);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onBlur={onBlur}
      noValidate
      className="welcome-editor"
    >
      <div className="welcome-editor-heading">
        <div>
          <h3>{t("adminWelcome.stepsTitle")}</h3>
          <p className="fine-print">{t("adminWelcome.stepsHint")}</p>
        </div>
        <span className="status-label">
          {number(steps.length)} / {number(maximumSteps)}
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="muted welcome-empty">{t("adminWelcome.empty")}</p>
      ) : (
        <div className="welcome-editor-workspace">
          <div className="welcome-step-rail">
            <WelcomeStepList
              steps={steps}
              selectedKey={selectedKey}
              disabled={disabled}
              onSelect={onSelect}
              onMove={move}
            />
          </div>
          {selected && (
            <fieldset
              className="welcome-step-editor"
              key={selected.key}
              disabled={disabled}
            >
              <legend>
                {t("welcome.step", { number: number(selectedIndex + 1) })}
              </legend>
              <div className="welcome-step-actions">
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled || selectedIndex === 0}
                  onClick={(event) =>
                    moveSelected(selectedIndex - 1, event.currentTarget)
                  }
                  aria-label={t("adminWelcome.moveUp", {
                    number: number(selectedIndex + 1),
                  })}
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled || selectedIndex === steps.length - 1}
                  onClick={(event) =>
                    moveSelected(selectedIndex + 1, event.currentTarget)
                  }
                  aria-label={t("adminWelcome.moveDown", {
                    number: number(selectedIndex + 1),
                  })}
                >
                  <ArrowDown size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => void removeStep(selectedIndex)}
                  aria-label={t("adminWelcome.remove", {
                    number: number(selectedIndex + 1),
                  })}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
              <WelcomeWidgetEditor
                step={selected}
                disabled={disabled}
                categories={categories}
                createKey={createWidgetKey}
                onChange={(widgets) =>
                  onChange((current) =>
                    current.map((step) =>
                      step.key === selected.key ? { ...step, widgets } : step,
                    ),
                  )
                }
              />
            </fieldset>
          )}
        </div>
      )}
      <p className="welcome-announcement" role="status">
        {reorderNotice}
      </p>
      <div className="form-actions welcome-editor-actions">
        <button
          ref={addButton}
          type="button"
          className="button secondary"
          disabled={disabled || steps.length >= maximumSteps}
          onClick={addStep}
        >
          <Plus size={17} aria-hidden="true" />
          {t("adminWelcome.add")}
        </button>
      </div>
    </form>
  );
}
