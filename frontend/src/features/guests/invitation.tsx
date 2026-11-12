"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Link2Off } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { previewSchema, sessionSchema } from "./contracts";
import { BrandMark } from "@/components/brand-mark";
import { Snow } from "@/components/snow";
import { ErrorNotice } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";

export function Invitation({
  age,
  title,
  description,
}: {
  age: number;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const token = useRef("");
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (!value) {
      // A returning guest can also open this page without an invitation token.
      fetch("/api/session", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (
            response.ok &&
            sessionSchema.safeParse(await response.json()).success
          )
            router.replace("/photos");
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => controller.abort();
    }
    token.current = value;
    api("/invitations/preview", previewSchema, {
      method: "POST",
      body: { token: value },
      signal: controller.signal,
    })
      .then((data) => setName(data.guestName))
      .catch(async (err) => {
        // Reopening an already-used invitation should still work for a guest
        // whose session on this device remains valid.
        try {
          const response = await fetch("/api/session", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (
            response.ok &&
            sessionSchema.safeParse(await response.json()).success
          ) {
            window.history.replaceState(null, "", "/invitation");
            router.replace("/photos");
            return;
          }
        } catch {
          /* Keep the original invitation error. */
        }
        if (!controller.signal.aborted) setError(errorMessage(err, t));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [router, t]);

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      await api("/invitations/accept", sessionSchema, {
        method: "POST",
        body: { token: token.current },
      });
      window.history.replaceState(null, "", "/invitation");
      token.current = "";
      router.replace("/photos");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <main className="invitation-page">
      <Snow count={70} />
      <div className="invitation-card">
        <div className="brand">
          <BrandMark />
          {title && <strong>{title}</strong>}
        </div>
        <div
          className={`invitation-ring${age > 99 ? " invitation-ring-long" : ""}`}
          aria-hidden="true"
        >
          <span>{age}</span>
        </div>
        <h1>
          {name ? t("invitation.hello", { name }) : t("invitation.welcome")}
        </h1>
        {description && <p className="invitation-intro">{description}</p>}
        {loading ? (
          <p className="loading-inline" role="status">
            <span className="spinner" />
            {t("invitation.checking")}
          </p>
        ) : name ? (
          <>
            <p className="muted">{t("invitation.noAccount")}</p>
            <div className="invitation-actions">
              <button
                className="invitation-enter"
                onClick={enter}
                disabled={busy}
              >
                <span>
                  {busy ? t("invitation.entering") : t("invitation.enter")}
                </span>
                <span className="invitation-enter-icon" aria-hidden="true">
                  {busy ? (
                    <span className="spinner" />
                  ) : (
                    <ArrowRight size={22} strokeWidth={2.25} />
                  )}
                </span>
              </button>
              <p className="fine-print">
                {t("invitation.session")}
                <br />
                {t("invitation.privateLink")}
              </p>
            </div>
          </>
        ) : (
          <div className="invitation-help">
            {error ? (
              <Link2Off size={25} aria-hidden="true" />
            ) : (
              <KeyRound size={25} aria-hidden="true" />
            )}
            <h2>
              {error ? t("invitation.unavailable") : t("invitation.open")}
            </h2>
            {!error && <p className="muted">{t("invitation.linkHelp")}</p>}
          </div>
        )}
        <ErrorNotice message={error} />
      </div>
      <p className="invitation-footer">{t("invitation.footer")}</p>
    </main>
  );
}
