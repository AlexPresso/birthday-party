"use client";
import { useState } from "react";
import { LogOut, Moon, ShieldCheck, Heart } from "lucide-react";
import { remove, errorMessage, returnToInvitation } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "@/lib/contracts";
import { ErrorNotice } from "./ui";

export function SettingsPanel({ guest }: { guest: Guest }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="settings-grid">
      <section className="profile-card panel">
        <div className="avatar large">
          {guest.name.charAt(0).toLocaleUpperCase(locale)}
        </div>
        <div>
          <h2>{guest.name}</h2>
          <span className="status-label">
            {guest.role === "admin" ? t("settings.host") : t("settings.guest")}
          </span>
        </div>
        <p className="muted">{t("settings.attribution")}</p>
        <button className="button secondary" disabled={busy} onClick={logout}>
          <LogOut size={17} />
          {busy ? t("settings.signingOut") : t("settings.signOut")}
        </button>
        <ErrorNotice message={error} />
      </section>
      <section className="settings-details">
        <h2>{t("settings.details")}</h2>
        <div className="settings-row panel">
          <Moon size={21} />
          <div>
            <strong>{t("settings.theme")}</strong>
          </div>
          <span className="fine-print">{t("settings.dark")}</span>
        </div>
        <div className="settings-row panel">
          <ShieldCheck size={21} />
          <div>
            <strong>{t("settings.private")}</strong>
            <p className="fine-print">{t("settings.privacyHint")}</p>
          </div>
        </div>
        <div className="settings-row panel">
          <Heart size={21} />
          <div>
            <strong>{t("settings.accessHelp")}</strong>
            <p className="fine-print">{t("settings.accessHelpHint")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
