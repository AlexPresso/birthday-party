"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import {
  adminWelcomeSchema,
  type AdminWelcome,
  type WelcomeStep,
} from "./contracts";
import { type MediaCategory } from "@/features/media/contracts";
import { useI18n } from "@/lib/i18n-context";
import { useLatestState } from "@/lib/use-latest-state";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import {
  WelcomeControlPanel,
  type WelcomeAction,
} from "./welcome-control-panel";
import { WelcomeStepEditor } from "./welcome-step-editor";
import { focusWidget } from "./welcome-widget-editor";
import "./welcome-admin.css";

import { cleanRules, isInvalidWidget, type StepDraft } from "./editor-model";

/**
 * Composes the host's live controls and the step editor. Both act on the same
 * saved revision: commands save the draft first, and one request runs at a time.
 */
export function WelcomeAdmin({
  initial,
  categories,
}: {
  initial: AdminWelcome;
  categories: MediaCategory[];
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  // Queued saves and commands read the revision after earlier requests finish.
  const [state, acceptState, currentState] = useLatestState(initial);
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
  const [selectedKey, setSelectedKey] = useState<number | null>(
    initial.steps.length ? 0 : null,
  );
  const [busy, setBusy] = useState<
    WelcomeAction | "reload" | "discard" | "required" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  // Local draft keys never leave the browser.
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
        case "rules":
          return { type: widget.type, rules: cleanRules(widget.rules) };
      }
    }),
  }));
  const dirty = JSON.stringify(steps) !== JSON.stringify(state.steps);
  const invalidIndex = draft.findIndex(
    ({ widgets }) => widgets.length === 0 || widgets.some(isInvalidWidget),
  );
  const mutationDisabled = !!busy || conflict;
  const { flush, saving, onBlur } = useAutosave({ save });
  const structure = JSON.stringify(
    draft.map((step) => ({
      key: step.key,
      widgets: step.widgets.map(({ key, type }) => ({ key, type })),
    })),
  );
  const previousStructure = useRef(structure);

  // Adding, removing and reordering never blur a field, so they save here.
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

  function changeDraft(update: (current: StepDraft[]) => StepDraft[]) {
    if (mutationDisabled) return;
    setDraft(update);
    setNotice("");
    setValidationError(null);
  }

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
      ["errors.welcome_conflict", "errors.invalid_welcome_transition"].includes(
        cause.code,
      )
    ) {
      setConflict(true);
    }
  }

  async function save() {
    if (JSON.stringify(steps) === JSON.stringify(currentState().steps))
      return true;
    if (conflict) return false;
    setError(null);
    setValidationError(null);
    setNotice("");
    if (invalidIndex !== -1) {
      const invalid = draft[invalidIndex];
      const invalidWidget = invalid.widgets.find(isInvalidWidget);
      setValidationError(
        t(
          !invalidWidget
            ? "widgets.emptyError"
            : invalidWidget.type === "rules"
              ? "widgets.invalidRules"
              : "widgets.invalidText",
        ),
      );
      setSelectedKey(invalid.key);
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
        body: { revision: currentState().revision, steps },
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

  async function transition(action: WelcomeAction) {
    if (command.current || conflict) return;
    if (
      action !== "next" &&
      !(await confirm({
        message: t(
          action === "start"
            ? "adminWelcome.startConfirmation"
            : "adminWelcome.openConfirmation",
        ),
      }))
    )
      return;
    if (command.current) return;
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
          body: { revision: currentState().revision, action },
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
        body: { revision: currentState().revision, required },
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
      !(await confirm({
        message: t("adminWelcome.discardConfirmation"),
        destructive: true,
      }))
    )
      return;
    if (command.current) return;
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
        <WelcomeControlPanel
          state={state}
          pending={busy === "reload" || busy === "discard" ? null : busy}
          disabled={mutationDisabled}
          onTransition={(action) => void transition(action)}
          onRequiredChange={(required) => void updateRequired(required)}
        />

        <p className="welcome-admin-notice" role="status">
          {saving
            ? t("adminWelcome.saving")
            : notice === t("adminWelcome.saved")
              ? ""
              : notice}
        </p>
        <SavedAnnouncement
          message={
            !saving && !dirty && notice === t("adminWelcome.saved")
              ? notice
              : ""
          }
        />

        <WelcomeStepEditor
          steps={draft}
          selectedKey={selectedKey}
          disabled={mutationDisabled}
          categories={categories}
          onSelect={setSelectedKey}
          onChange={changeDraft}
          createStepKey={() => nextKey.current++}
          createWidgetKey={() => nextWidgetKey.current++}
          onBlur={onBlur}
          onSubmit={() => void flush()}
        />
        <ErrorNotice message={error ?? validationError} />
        {(conflict || dirty) && (
          <div className="form-actions">
            {conflict && (
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || saving}
                onClick={() => void reload()}
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
                onClick={() => void reload(true)}
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
