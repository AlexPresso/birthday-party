"use client";
import { useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { remove, errorMessage, returnToInvitation } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "@/features/guests/contracts";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { ProfileIdentity } from "./profile-identity";
import { NotificationControl } from "@/features/notifications/notification-control";
import "./profile-panel.css";

export function ProfilePanel({
  guest,
  imageBytes,
}: {
  guest: Guest;
  imageBytes: number;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <section className="profile-panel">
      <ProfileIdentity guest={guest} imageBytes={imageBytes} />
      <div className="profile-rows">
        <NotificationControl compact />
        <button
          type="button"
          className="profile-row"
          disabled={busy}
          onClick={logout}
        >
          <LogOut size={26} strokeWidth={1.6} aria-hidden="true" />
          <span>{busy ? t("settings.signingOut") : t("settings.signOut")}</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
      <ErrorNotice message={error} />
    </section>
  );
}
