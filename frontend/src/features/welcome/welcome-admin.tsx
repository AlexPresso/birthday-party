"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  DoorOpen,
  ListOrdered,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
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
    Action | "save" | "reload" | "discard" | "required" | null
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
          return { type: widget.type, text: widget.text };
        case "profile_photo":
        case "enable_notifications":
          return { type: widget.type };
        case "media_upload":
          return { type: widget.type, mediaUpload: widget.mediaUpload };
      }
    }),
  }));
  const dirty = JSON.stringify(steps) !== JSON.stringify(state.steps);
  const editable = state.currentStep === 0;
  const mutationDisabled = !!busy || !editable;
  const selectedIndex = draft.findIndex((step) => step.key === selectedKey);
  const selected = draft[selectedIndex];
  const hasNext = state.currentStep < state.steps.length;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

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

  function fail(cause: unknown) {
    setError(errorMessage(cause, t));
    if (
      cause instanceof ApiError &&
      [
        "errors.welcome_conflict",
        "errors.welcome_steps_locked",
        "errors.invalid_welcome_transition",
      ].includes(cause.code)
    ) {
      setConflict(true);
    }
  }

  function move(from: number, to: number) {
    if (mutationDisabled || conflict) return;
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !editable || !dirty || conflict) return;
    setError(null);
    setValidationError(null);
    setNotice("");
    const invalidIndex = draft.findIndex(
      ({ widgets }) =>
        widgets.length === 0 || widgets.some(isInvalidTextWidget),
    );
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
      return;
    }
    setBusy("save");
    try {
      const updated = await api("/admin/welcome", adminWelcomeSchema, {
        method: "PUT",
        body: { revision: state.revision, steps },
      });
      setState(updated);
      replaceDraft(updated);
      setConflict(false);
      setNotice(t("adminWelcome.saved"));
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  }

  async function transition(action: Action) {
    if (
      busy ||
      conflict ||
      (dirty && (action === "next" || (action === "start" && editable)))
    )
      return;
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
    setBusy(action);
    setError(null);
    setNotice("");
    try {
      const updated = await api(
        "/admin/welcome/transition",
        adminWelcomeSchema,
        {
          method: "POST",
          body: { revision: state.revision, action },
        },
      );
      setState(updated);
      if (!dirty) replaceDraft(updated);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  }

  async function updateRequired(required: boolean) {
    if (busy || conflict) return;
    setBusy("required");
    setError(null);
    setNotice("");
    try {
      const updated = await api("/admin/welcome/required", adminWelcomeSchema, {
        method: "PATCH",
        body: { revision: state.revision, required },
      });
      setState(updated);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  }

  async function reload(discardChanges = false) {
    if (busy) return;
    if (
      discardChanges &&
      !window.confirm(t("adminWelcome.discardConfirmation"))
    )
      return;
    setBusy(discardChanges ? "discard" : "reload");
    setError(null);
    setNotice("");
    try {
      const updated = await api("/admin/welcome", adminWelcomeSchema);
      setState(updated);
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
      setBusy(null);
    }
  }

  return (
    <details className="admin-accordion panel welcome-admin" open>
      <summary>
        <ListOrdered size={21} aria-hidden="true" />
        <span>{t("adminWelcome.title")}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
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
                disabled={!!busy || (dirty && editable) || conflict}
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
                    disabled={!!busy || dirty || conflict}
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
          {dirty && (
            <p className="fine-print welcome-unsaved">
              {t(
                editable ? "adminWelcome.unsaved" : "adminWelcome.draftLocked",
              )}
            </p>
          )}
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

        <ErrorNotice message={error ?? validationError} />
        {(conflict || dirty) && (
          <div className="form-actions">
            {conflict && (
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
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
                disabled={!!busy}
                onClick={() => reload(true)}
              >
                <X size={17} aria-hidden="true" />
                {busy === "discard"
                  ? t("adminWelcome.reloading")
                  : t("adminWelcome.discard")}
              </button>
            )}
          </div>
        )}
        <p className="success-notice welcome-admin-notice" role="status">
          {notice}
        </p>

        <form onSubmit={save} noValidate className="welcome-editor">
          <div className="welcome-editor-heading">
            <div>
              <h3>{t("adminWelcome.stepsTitle")}</h3>
              <p className="fine-print">
                {t(editable ? "adminWelcome.stepsHint" : "adminWelcome.locked")}
              </p>
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
                  disabled={mutationDisabled || conflict}
                  onSelect={setSelectedKey}
                  onMove={move}
                />
              </div>
              {selected && (
                <>
                  <fieldset
                    className="welcome-step-editor"
                    key={selected.key}
                    disabled={mutationDisabled || conflict}
                  >
                    <legend>
                      {t("welcome.step", { number: number(selectedIndex + 1) })}
                    </legend>
                    <div className="welcome-step-actions">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={
                          mutationDisabled || conflict || selectedIndex === 0
                        }
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
                          mutationDisabled ||
                          conflict ||
                          selectedIndex === draft.length - 1
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
                      disabled={mutationDisabled || conflict}
                      categories={categories}
                      createKey={() => nextWidgetKey.current++}
                      onChange={(widgets) => {
                        if (mutationDisabled || conflict) return;
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
              disabled={mutationDisabled || conflict || draft.length >= 12}
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
            <button
              className="button primary"
              disabled={mutationDisabled || !dirty || conflict}
            >
              <Save size={17} aria-hidden="true" />
              {t(busy === "save" ? "adminWelcome.saving" : "adminWelcome.save")}
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
