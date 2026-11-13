"use client";

import { NotificationControl } from "@/features/notifications/notification-control";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cake,
  DoorOpen,
  LogOut,
  RefreshCw,
} from "lucide-react";
import {
  api,
  ApiError,
  remove,
  returnToInvitation,
  errorMessage,
} from "@/lib/api";
import { welcomeSchema, type Welcome, type WelcomeStep } from "./contracts";
import { type Guest } from "@/features/guests/contracts";
import { useI18n } from "@/lib/i18n-context";
import { useWelcome } from "./use-welcome";
import { BrandMark } from "@/components/brand-mark";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { WelcomeProfile } from "./welcome-profile";
import { WelcomeMedia } from "./welcome-media";
import { WelcomeRules } from "./welcome-rules";
import { UploadProvider } from "@/features/media/upload-provider";
import { UploadQueueError } from "@/features/media/upload-queue";
import "./waiting-room.css";

export function WaitingRoom({
  guest,
  initial,
  title,
}: {
  guest: Guest;
  initial: Welcome;
  title: string;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { welcome, failed, refresh, accept } = useWelcome(initial);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<"previous" | "next" | "finish" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const progressRequest = useRef<AbortController | null>(null);
  const state = welcome ?? initial;
  // Go refuses Next and "Enter the app" until every rule of the step is ticked.
  const rulesPending =
    !state.rulesAccepted &&
    !!state.step?.widgets.some((widget) => widget.type === "rules");

  useEffect(() => {
    if (state.open) window.location.replace("/photos");
  }, [state.open]);

  useEffect(
    () => () => {
      progressRequest.current?.abort();
      progressRequest.current = null;
    },
    [],
  );

  async function navigate(action: "previous" | "next" | "finish") {
    if (busy || progressRequest.current) return;
    const controller = new AbortController();
    progressRequest.current = controller;
    setMoving(action);
    setError(null);
    try {
      const next = await api("/welcome/progress", welcomeSchema, {
        method: "POST",
        body: { revision: state.progressRevision, action },
        signal: controller.signal,
      });
      if (controller.signal.aborted || progressRequest.current !== controller)
        return;
      accept(next);
      if (!next.open)
        requestAnimationFrame(() => {
          document
            .getElementById(next.step ? "welcome-position" : "welcome-heading")
            ?.focus();
        });
    } catch (cause) {
      if (progressRequest.current !== controller || controller.signal.aborted)
        return;
      setError(errorMessage(cause, t));
      if (cause instanceof ApiError && cause.code === "errors.welcome_conflict")
        refresh();
    } finally {
      if (progressRequest.current === controller) {
        progressRequest.current = null;
        setMoving(null);
      }
    }
  }

  async function logout() {
    const confirmed = await confirm({
      message: t("settings.logoutConfirmation"),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await remove("/logout", "POST");
      returnToInvitation();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <main className="welcome-page">
      <header className="welcome-header">
        <div className="brand">
          <BrandMark />
          {title && <strong>{title}</strong>}
        </div>
        <button
          className="text-button"
          onClick={logout}
          disabled={busy || moving !== null}
        >
          <LogOut size={17} aria-hidden="true" />
          {busy ? t("welcome.signingOut") : t("welcome.signOut")}
        </button>
      </header>
      <section className="welcome-content" aria-labelledby="welcome-heading">
        <div className="welcome-stage panel">
          {state.step ? (
            <>
              <p
                id="welcome-position"
                className="welcome-step-number"
                role="status"
                aria-atomic="true"
                tabIndex={-1}
              >
                {t("welcome.step", { number: state.step.position })}
              </p>
              {!state.step.widgets.some(
                (widget) => widget.type === "title",
              ) && (
                <h1
                  id="welcome-heading"
                  className="visually-hidden"
                  tabIndex={-1}
                >
                  {t("welcome.step", { number: state.step.position })}
                </h1>
              )}
              {!state.open && (
                <WelcomeWidgets
                  key={state.progressRevision}
                  step={state.step}
                  revision={state.progressRevision}
                  rulesAccepted={state.rulesAccepted}
                  onWelcome={accept}
                  onRefresh={refresh}
                />
              )}
            </>
          ) : (
            <div
              className="welcome-intro"
              aria-live="polite"
              aria-atomic="true"
            >
              <Cake
                className="welcome-cake"
                size={36}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <h1 id="welcome-heading" tabIndex={-1}>
                {t("welcome.heading", { name: guest.name })}
              </h1>
              {!state.canNext && !state.canFinish && (
                <p className="welcome-body muted">
                  {t("welcome.waitingDescription")}
                </p>
              )}
            </div>
          )}
          {!state.open && (state.step || state.canNext || state.canFinish) && (
            <div className="welcome-navigation" aria-busy={moving !== null}>
              {state.step && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || moving !== null || !state.canPrevious}
                  onClick={() => void navigate("previous")}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
                  {t("welcome.previous")}
                </button>
              )}
              {state.canNext && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || moving !== null}
                  onClick={() => void navigate("next")}
                >
                  {t("welcome.next")}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              )}
              {state.canFinish && (
                <button
                  type="button"
                  className={`button ${state.canNext ? "secondary" : "primary"} welcome-finish`}
                  disabled={busy || moving !== null}
                  onClick={() => void navigate("finish")}
                >
                  <DoorOpen size={17} aria-hidden="true" />
                  {t("welcome.finish")}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="welcome-follow-up muted" role="status">
          {state.open
            ? t("welcome.opening")
            : moving
              ? t("welcome.moving")
              : rulesPending
                ? t("welcome.rulesPending")
                : state.canNext
                  ? t("welcome.nextDescription")
                  : !state.canFinish && state.step
                    ? t("welcome.nextLocked")
                    : null}
        </p>
        {failed && (
          <div className="welcome-connection">
            <ErrorNotice message={t("welcome.connectionLost")} />
            <button className="button secondary" onClick={refresh}>
              <RefreshCw size={17} aria-hidden="true" />
              {t("welcome.retry")}
            </button>
          </div>
        )}
        <ErrorNotice message={error} />
      </section>
    </main>
  );
}

function WelcomeWidgets({
  step,
  revision,
  rulesAccepted,
  onWelcome,
  onRefresh,
}: {
  step: WelcomeStep;
  revision: number;
  rulesAccepted: boolean;
  onWelcome: (welcome: Welcome) => void;
  onRefresh: () => void;
}) {
  const firstTitle = step.widgets.findIndex(
    (widget) => widget.type === "title",
  );
  const content = (
    <div className="welcome-widgets">
      {step.widgets.map((widget, index) => {
        switch (widget.type) {
          case "title":
            return index === firstTitle ? (
              <h1
                key={index}
                id="welcome-heading"
                className="welcome-widget-title"
                tabIndex={-1}
              >
                {widget.text}
              </h1>
            ) : (
              <h2 key={index} className="welcome-widget-title">
                {widget.text}
              </h2>
            );
          case "text":
            return (
              <p key={index} className="welcome-body">
                {widget.text}
              </p>
            );
          case "profile_photo":
            return <WelcomeProfile key={index} />;
          case "enable_notifications":
            return <NotificationControl key={index} />;
          case "media_upload":
            return (
              <WelcomeMedia
                key={index}
                revision={revision}
                widgetIndex={index}
              />
            );
          case "rules":
            return (
              <WelcomeRules
                key={index}
                rules={widget.rules}
                accepted={rulesAccepted}
                revision={revision}
                onChange={onWelcome}
                onConflict={onRefresh}
              />
            );
        }
      })}
    </div>
  );
  // One provider bounds transfers and shares queue updates across this step.
  return step.widgets.some((widget) => widget.type === "media_upload") ? (
    <UploadProvider welcomeRevision={revision}>
      {content}
      <UploadQueueError />
    </UploadProvider>
  ) : (
    content
  );
}
