"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { remove, errorMessage, returnToInvitation } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "@/lib/contracts";
import { ErrorNotice } from "./ui";
import { Avatar } from "./avatar";
import { ProfilePhotoEditor } from "./profile-photo-editor";
import { NotificationControl } from "./notification-control";

export function SettingsPanel({
  guest,
  imageBytes,
}: {
  guest: Guest;
  imageBytes: number;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState({
    source: guest.avatarUrl,
    url: guest.avatarUrl,
  });
  if (photo.source !== guest.avatarUrl) {
    setPhoto({ source: guest.avatarUrl, url: guest.avatarUrl });
  }
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
    <section className="profile-card panel">
      <Avatar name={guest.name} avatarUrl={photo.url} className="large" />
      <div>
        <h2>{guest.name}</h2>
        <span className="status-label">
          {guest.role === "admin" ? t("settings.host") : t("settings.guest")}
        </span>
      </div>
      <p className="muted">{t("settings.attribution")}</p>
      <ProfilePhotoEditor
        avatarUrl={photo.url}
        imageBytes={imageBytes}
        onSaved={(updated) =>
          setPhoto((current) => ({ ...current, url: updated.avatarUrl }))
        }
      />
      <NotificationControl />
      <button className="button secondary" disabled={busy} onClick={logout}>
        <LogOut size={17} />
        {busy ? t("settings.signingOut") : t("settings.signOut")}
      </button>
      <ErrorNotice message={error} />
    </section>
  );
}
