"use client";

import { ArrowRight, DoorOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { AdminWelcome } from "./contracts";
import { stepLabel } from "./editor-model";

export type WelcomeAction = "start" | "next" | "open";

/** The host's live controls: where guests are, the next unlock and the switch. */
export function WelcomeControlPanel({
  state,
  pending,
  disabled,
  onTransition,
  onRequiredChange,
}: {
  state: AdminWelcome;
  /** The command in progress, to label its own control. */
  pending: WelcomeAction | "required" | null;
  disabled: boolean;
  onTransition: (action: WelcomeAction) => void;
  onRequiredChange: (required: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const hasNext = state.currentStep < state.steps.length;
  const currentStep = state.steps[state.currentStep - 1];

  return (
    <>
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
                : currentStep && stepLabel(currentStep)}
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
              disabled={disabled}
              onClick={() => onTransition("start")}
            >
              {pending === "start"
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
                  disabled={disabled}
                  onClick={() => onTransition("next")}
                >
                  <ArrowRight size={17} aria-hidden="true" />
                  {pending === "next"
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
                disabled={disabled}
                onClick={() => onTransition("open")}
              >
                <DoorOpen size={17} aria-hidden="true" />
                {pending === "open"
                  ? t("adminWelcome.updating")
                  : t("adminWelcome.open")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="welcome-required" aria-busy={pending === "required"}>
        <label className="checkbox-field">
          <input
            type="checkbox"
            role="switch"
            checked={state.required}
            disabled={disabled}
            aria-describedby="welcome-required-hint"
            onChange={(event) => onRequiredChange(event.target.checked)}
          />
          {t("adminWelcome.required")}
        </label>
        <p id="welcome-required-hint" className="fine-print">
          {t("adminWelcome.requiredHint")}
        </p>
        {pending === "required" && (
          <p className="fine-print" role="status">
            {t("adminWelcome.requiredSaving")}
          </p>
        )}
      </div>
    </>
  );
}
