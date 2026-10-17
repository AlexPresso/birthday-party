"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { profileSchema, type Profile } from "@/features/profile/contracts";
import { useI18n } from "@/lib/i18n-context";
import { Avatar } from "@/components/avatar";
import { ProfilePhotoEditor } from "@/features/profile/profile-photo-editor";
import { ErrorNotice } from "@/components/ui";

export function WelcomeProfile() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    void api("/profile", profileSchema, { signal: controller.signal })
      .then((next) => {
        if (!disposed) setProfile(next);
      })
      .catch((cause) => {
        if (!disposed) {
          setError(
            controller.signal.aborted
              ? t("common.connectionFailed")
              : errorMessage(cause, t),
          );
        }
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      disposed = true;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [attempt, t]);

  return (
    <div className="welcome-profile">
      {profile ? (
        <>
          <div className="welcome-profile-identity">
            <Avatar
              name={profile.guest.name}
              avatarUrl={profile.guest.avatarUrl}
              className="large"
            />
            <strong>{profile.guest.name}</strong>
          </div>
          <ProfilePhotoEditor
            avatarUrl={profile.guest.avatarUrl}
            imageBytes={profile.limits.imageBytes}
            refreshOnSave={false}
            onSaved={(guest) =>
              setProfile((current) =>
                current ? { ...current, guest } : current,
              )
            }
          />
        </>
      ) : error ? (
        <>
          <ErrorNotice message={error} />
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError(null);
              setAttempt((current) => current + 1);
            }}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {t("welcome.retry")}
          </button>
        </>
      ) : (
        <p className="muted" role="status">
          {t("welcome.profileLoading")}
        </p>
      )}
    </div>
  );
}
