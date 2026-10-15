"use client";

import { useEffect, useState } from "react";
import { Cake, LogOut, RefreshCw } from "lucide-react";
import { remove, returnToInvitation, errorMessage } from "@/lib/api";
import type { Guest, Welcome } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n-context";
import { useWelcome } from "@/lib/use-welcome";
import { ErrorNotice } from "./ui";
import { WelcomeProfile } from "./welcome-profile";
import { WelcomeMedia } from "./welcome-media";
import "./waiting-room.css";

export function WaitingRoom({
  guest,
  initial,
  age,
  title,
}: {
  guest: Guest;
  initial: Welcome;
  age: number;
  title: string;
}) {
  const { t } = useI18n();
  const { welcome, failed, refresh } = useWelcome(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = welcome ?? initial;

  useEffect(() => {
    if (state.open) window.location.replace("/photos");
  }, [state.open]);

  async function logout() {
    if (!window.confirm(t("settings.logoutConfirmation"))) return;
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
          <span className="brand-mark" aria-hidden="true">
            {age}
          </span>
          {title && <strong>{title}</strong>}
        </div>
        <button className="text-button" onClick={logout} disabled={busy}>
          <LogOut size={17} aria-hidden="true" />
          {busy ? t("welcome.signingOut") : t("welcome.signOut")}
        </button>
      </header>
      <section className="welcome-content" aria-labelledby="welcome-heading">
        <div className="welcome-stage panel">
          <div aria-live="polite" aria-atomic="true">
            {state.step ? (
              <p className="welcome-step-number">
                {t("welcome.step", { number: state.step.position })}
              </p>
            ) : (
              <Cake
                className="welcome-cake"
                size={36}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            )}
            <h1 id="welcome-heading">
              {state.step?.title ?? t("welcome.heading", { name: guest.name })}
            </h1>
            {state.step ? (
              state.step.body && (
                <p className="welcome-body">{state.step.body}</p>
              )
            ) : (
              <p className="welcome-body muted">
                {t("welcome.waitingDescription")}
              </p>
            )}
          </div>
          {!state.open && state.step?.action === "profile_photo" && (
            <WelcomeProfile key={state.revision} />
          )}
          {!state.open && state.step?.action === "media_upload" && (
            <WelcomeMedia key={state.revision} revision={state.revision} />
          )}
        </div>
        <p className="welcome-follow-up muted" role="status">
          {state.open
            ? t("welcome.opening")
            : state.step
              ? t("welcome.nextDescription")
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
