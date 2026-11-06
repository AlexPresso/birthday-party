"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  DoorOpen,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import {
  adminWelcomeSchema,
  type AdminWelcome,
  type WelcomeStep,
} from "./contracts";
import { type MediaCategory } from "@/features/media/contracts";
import { useI18n } from "@/lib/i18n-context";
import { moveItem } from "@/lib/reorder";
import { ErrorNotice } from "@/components/ui";
import { WelcomeStepList } from "./welcome-step-list";
import { WelcomeWidgetEditor, focusWidget } from "./welcome-widget-editor";
import "./welcome-admin.css";

import { isInvalidTextWidget, stepLabel, type StepDraft } from "./editor-model";

type Action = "start" | "next" | "open";

export function WelcomeAdmin({
  initial,
  categories,
}: {
  initial: AdminWelcome;
  categories: MediaCategory[];
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState(initial);
  const currentState = useRef(initial);
  const command = useRef(false);
  const [draft, setDraft] = useState<StepDraft[]>(() =>
    initial.steps.map((step, key) => ({
      key,
      widgets: step.widgets.map((widget, index) => ({
        ...widget,
        key: key * 12 + index,
      })),
    })),
  );
  const nextKey = useRef(initial.steps.length);
  const nextWidgetKey = useRef(initial.steps.length * 12);
  const addButton = useRef<HTMLButtonElement>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(
    initial.steps.length ? 0 : null,
  );
  const [reorderNotice, setReorderNotice] = useState("");
  const [busy, setBusy] = useState<
    Action | "reload" | "discard" | "required" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const steps: WelcomeStep[] = draft.map((step) => ({
    widgets: step.widgets.map((widget) => {
      switch (widget.type) {
        case "title":
        case "text":
          return { type: widget.type, text: widget.text.trim() };
        case "profile_photo":
        case "enable_notifications":
          return { type: widget.type };
        case "media_upload":
          return { type: widget.type, mediaUpload: widget.mediaUpload };
      }
    }),
  }));
  const dirty = JSON.stringify(steps) !== JSON.stringify(state.steps);
  const invalidIndex = draft.findIndex(
    ({ widgets }) => widgets.length === 0 || widgets.some(isInvalidTextWidget),
  );
  const mutationDisabled = !!busy || conflict;
  const selectedIndex = draft.findIndex((step) => step.key === selectedKey);
  const selected = draft[selectedIndex];
  const hasNext = state.currentStep < state.steps.length;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const { flush, saving, onBlur } = useAutosave({ save });
  const structure = JSON.stringify(
    draft.map((step) => ({
      key: step.key,
      widgets: step.widgets.map(({ key, type }) => ({ key, type })),
    })),
  );
  const previousStructure = useRef(structure);

  useEffect(() => {
    if (previousStructure.current === structure) return;
    previousStructure.current = structure;
    if (dirty && invalidIndex === -1 && !conflict) void flush();
  }, [structure, dirty, invalidIndex, conflict, flush]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function replaceDraft(updated: AdminWelcome) {
    setValidationError(null);
    const replacement = updated.steps.map((step, index) => ({
      key: draft[index]?.key ?? nextKey.current++,
      widgets: step.widgets.map((widget, widgetIndex) => ({
        ...widget,
        key: draft[index]?.widgets[widgetIndex]?.key ?? nextWidgetKey.current++,
      })),
    }));
    setDraft(replacement);
    if (!replacement.some((step) => step.key === selectedKey))
      setSelectedKey(replacement[0]?.key ?? null);
  }

  function acceptState(updated: AdminWelcome) {
    currentState.current = updated;
    setState(updated);
  }

  function fail(cause: unknown) {
    setError(errorMessage(cause, t));
    if (
      cause instanceof ApiError &&
      ["errors.welcome_conflict", "errors.invalid_welcome_transition"].includes(
        cause.code,
      )
    ) {
      setConflict(true);
    }
  }

  function move(from: number, to: number) {
    if (mutationDisabled) return;
    setDraft((current) => moveItem(current, from, to));
    setReorderNotice(
      t("adminWelcome.moved", { from: number(from + 1), to: number(to + 1) }),
    );
    setNotice("");
    setValidationError(null);
  }

  function moveSelected(to: number, button: HTMLButtonElement) {
    const key = selectedKey;
    move(selectedIndex, to);
    requestAnimationFrame(() => {
      if (button.disabled) {
        document
          .querySelector<HTMLButtonElement>(
            `.welcome-step-list [data-step-key="${key}"] .welcome-step-select`,
          )
          ?.focus();
      }
    });
  }

  function removeStep(index: number) {
    if (mutationDisabled) return;
    const step = draft[index];
    if (
      step.widgets.length > 0 &&
      !window.confirm(
        t("adminWelcome.removeConfirmation", { number: number(index + 1) }),
      )
    )
      return;
    setDraft((current) => current.filter((item) => item.key !== step.key));
    if (selectedKey === step.key) {
      const next = draft[index + 1]?.key ?? draft[index - 1]?.key ?? null;
      setSelectedKey(next);
      requestAnimationFrame(() => {
        if (next === null) addButton.current?.focus();
        else
          document
            .querySelector<HTMLButtonElement>(
              `.welcome-step-list [data-step-key="${next}"] .welcome-step-select`,
            )
            ?.focus();
      });
    }
    setNotice("");
    setValidationError(null);
  }

  async function save() {
    if (JSON.stringify(steps) === JSON.stringify(currentState.current.steps))
      return true;
    if (conflict) return false;
    setError(null);
    setValidationError(null);
    setNotice("");
    if (invalidIndex !== -1) {
      const invalid = draft[invalidIndex];
      setValidationError(
        t(
          invalid.widgets.length === 0
            ? "widgets.emptyError"
            : "widgets.invalidText",
        ),
      );
      setSelectedKey(invalid.key);
      const invalidWidget = invalid.widgets.find(isInvalidTextWidget);
      requestAnimationFrame(() => {
        if (invalidWidget) focusWidget(invalidWidget.key);
        else
          document
            .querySelector<HTMLButtonElement>(".welcome-widget-add")
            ?.focus();
      });
      return false;
    }
    try {
      const updated = await api("/admin/welcome", adminWelcomeSchema, {
        method: "PUT",
        body: { revision: currentState.current.revision, steps },
      });
      // New text and reordering may arrive while this snapshot is being saved.
      // Retain the keyed draft; the next flush saves any newer changes.
      acceptState(updated);
      setConflict(false);
      setNotice(t("adminWelcome.saved"));
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    }
  }

  async function transition(action: Action) {
    if (command.current || conflict) return;
    if (
      action !== "next" &&
      !window.confirm(
        t(
          action === "start"
            ? "adminWelcome.startConfirmation"
            : "adminWelcome.openConfirmation",
        ),
      )
    )
      return;
    command.current = true;
    setBusy(action);
    setError(null);
    setNotice("");
    try {
      if (!(await flush())) return;
      const updated = await api(
        "/admin/welcome/transition",
        adminWelcomeSchema,
        {
          method: "POST",
          body: { revision: currentState.current.revision, action },
        },
      );
      acceptState(updated);
    } catch (cause) {
      fail(cause);
    } finally {
      command.current = false;
      setBusy(null);
    }
  }

  async function updateRequired(required: boolean) {
    if (command.current || conflict) return;
    command.current = true;
    setBusy("required");
    setError(null);
    setNotice("");
    try {
      if (!(await flush())) return;
      const updated = await api("/admin/welcome/required", adminWelcomeSchema, {
        method: "PATCH",
        body: { revision: currentState.current.revision, required },
      });
      acceptState(updated);
    } catch (cause) {
      fail(cause);
    } finally {
      command.current = false;
      setBusy(null);
    }
  }

  async function reload(discardChanges = false) {
    if (command.current || saving) return;
    if (
      discardChanges &&
      !window.confirm(t("adminWelcome.discardConfirmation"))
    )
      return;
    command.current = true;
    setBusy(discardChanges ? "discard" : "reload");
    setError(null);
    setNotice("");
    try {
      const updated = await api("/admin/welcome", adminWelcomeSchema);
      acceptState(updated);
      if (!dirty || discardChanges) replaceDraft(updated);
      setConflict(false);
      setNotice(
        t(
          discardChanges
            ? "adminWelcome.discarded"
            : dirty
              ? "adminWelcome.draftKept"
              : "adminWelcome.reloaded",
        ),
      );
    } catch (cause) {
      fail(cause);
    } finally {
      command.current = false;
      setBusy(null);
    }
  }

  return (
    <section
      className="welcome-admin"
      aria-label={t("adminWelcome.title")}
      aria-busy={!!busy || saving}
      data-dirty={dirty || undefined}
    >
      <div className="admin-form">
        <p className="muted welcome-admin-intro">{t("adminWelcome.intro")}</p>
        <div className="welcome-control">
          <div aria-live="polite" aria-atomic="true">
            <h3>
              {state.open
                ? t("adminWelcome.accessOpen")
                : state.currentStep === 0
                  ? t("adminWelcome.waiting")
                  : t("adminWelcome.currentStep", {
                      number: number(state.currentStep),
                      total: number(state.steps.length),
                    })}
            </h3>
            <p className="muted">
              {state.open
                ? t("adminWelcome.accessOpenDescription")
                : state.currentStep === 0
                  ? t("adminWelcome.waitingDescription")
                  : state.steps[state.currentStep - 1] &&
                    stepLabel(state.steps[state.currentStep - 1])}
            </p>
            {!state.open && !hasNext && state.currentStep > 0 && (
              <p className="fine-print">{t("adminWelcome.allShown")}</p>
            )}
          </div>
          <div className="welcome-control-actions">
            {state.open ? (
              <button
                type="button"
                className="button primary"
                disabled={!!busy || conflict}
                onClick={() => transition("start")}
              >
                {busy === "start"
                  ? t("adminWelcome.updating")
                  : t(
                      state.currentStep > 0
                        ? "adminWelcome.restart"
                        : "adminWelcome.start",
                    )}
              </button>
            ) : (
              <>
                {hasNext && (
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!busy || conflict}
                    onClick={() => transition("next")}
                  >
                    <ArrowRight size={17} aria-hidden="true" />
                    {busy === "next"
                      ? t("adminWelcome.updating")
                      : t(
                          state.currentStep === 0
                            ? "adminWelcome.first"
                            : "adminWelcome.next",
                        )}
                  </button>
                )}
                <button
                  type="button"
                  className={`button ${hasNext ? "secondary" : "primary"}`}
                  disabled={!!busy || conflict}
                  onClick={() => transition("open")}
                >
                  <DoorOpen size={17} aria-hidden="true" />
                  {busy === "open"
                    ? t("adminWelcome.updating")
                    : t("adminWelcome.open")}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="welcome-required" aria-busy={busy === "required"}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              role="switch"
              checked={state.required}
              disabled={!!busy || conflict}
              aria-describedby="welcome-required-hint"
              onChange={(event) => void updateRequired(event.target.checked)}
            />
            {t("adminWelcome.required")}
          </label>
          <p id="welcome-required-hint" className="fine-print">
            {t("adminWelcome.requiredHint")}
          </p>
          {busy === "required" && (
            <p className="fine-print" role="status">
              {t("adminWelcome.requiredSaving")}
            </p>
          )}
        </div>

        <p className="welcome-admin-notice" role="status">
          {saving
            ? t("adminWelcome.saving")
            : dirty && notice === t("adminWelcome.saved")
              ? ""
              : notice}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void flush();
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
              {number(draft.length)} / {number(12)}
            </span>
          </div>
          {draft.length === 0 ? (
            <p className="muted welcome-empty">{t("adminWelcome.empty")}</p>
          ) : (
            <div className="welcome-editor-workspace">
              <div className="welcome-step-rail">
                <WelcomeStepList
                  steps={draft}
                  selectedKey={selectedKey}
                  disabled={mutationDisabled}
                  onSelect={setSelectedKey}
                  onMove={move}
                />
              </div>
              {selected && (
                <>
                  <fieldset
                    className="welcome-step-editor"
                    key={selected.key}
                    disabled={mutationDisabled}
                  >
                    <legend>
                      {t("welcome.step", { number: number(selectedIndex + 1) })}
                    </legend>
                    <div className="welcome-step-actions">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={mutationDisabled || selectedIndex === 0}
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
                        disabled={
                          mutationDisabled || selectedIndex === draft.length - 1
                        }
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
                        onClick={() => removeStep(selectedIndex)}
                        aria-label={t("adminWelcome.remove", {
                          number: number(selectedIndex + 1),
                        })}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </button>
                    </div>
                    <WelcomeWidgetEditor
                      step={selected}
                      disabled={mutationDisabled}
                      categories={categories}
                      createKey={() => nextWidgetKey.current++}
                      onChange={(widgets) => {
                        if (mutationDisabled) return;
                        setDraft((current) =>
                          current.map((step) =>
                            step.key === selected.key
                              ? { ...step, widgets }
                              : step,
                          ),
                        );
                        setNotice("");
                        setValidationError(null);
                      }}
                    />
                  </fieldset>
                </>
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
              disabled={mutationDisabled || draft.length >= 12}
              onClick={() => {
                const key = nextKey.current++;
                setDraft((current) => [...current, { key, widgets: [] }]);
                setSelectedKey(key);
                setNotice("");
                setValidationError(null);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(".welcome-widget-add")
                    ?.focus(),
                );
              }}
            >
              <Plus size={17} aria-hidden="true" />
              {t("adminWelcome.add")}
            </button>
          </div>
        </form>
        <ErrorNotice message={error ?? validationError} />
        {(conflict || dirty) && (
          <div className="form-actions">
            {conflict && (
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || saving}
                onClick={() => reload()}
              >
                <RefreshCw size={17} aria-hidden="true" />
                {busy === "reload"
                  ? t("adminWelcome.reloading")
                  : t("adminWelcome.reload")}
              </button>
            )}
            {dirty && (
              <button
                type="button"
                className="text-button"
                disabled={!!busy || saving}
                onClick={() => reload(true)}
              >
                <X size={17} aria-hidden="true" />
                {busy === "discard"
                  ? t("adminWelcome.reloading")
                  : t("adminWelcome.discard")}
              </button>
            )}
            {dirty &&
              !conflict &&
              (error || notice === t("adminWelcome.draftKept")) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy || saving}
                  onClick={() => void flush()}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                  {t("common.retry")}
                </button>
              )}
          </div>
        )}
      </div>
    </section>
  );
}
