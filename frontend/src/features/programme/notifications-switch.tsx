"use client";
import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useI18n } from "@/lib/i18n-context";
import { useLatestState } from "@/lib/use-latest-state";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { programmeNotificationsSchema } from "./contracts";

/**
 * The host's switch for the programme's push notifications. It saves at once,
 * one request at a time. After a failure it stays where the host put it, with
 * the error and a retry; leaving the settings page retries too.
 */
export function ProgrammeNotificationsSwitch({
  initial,
}: {
  initial: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  // A queued save reads both values once the request before it has finished.
  const [saved, setSaved, currentSaved] = useLatestState(initial);
  const [enabled, setEnabled, currentEnabled] = useLatestState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const { flush, saving } = useAutosave({ save });

  async function save() {
    const next = currentEnabled();
    if (next === currentSaved()) return true;
    setError(null);
    setNotice("");
    try {
      const updated = await api(
        "/admin/programme/notifications",
        programmeNotificationsSchema,
        { method: "PUT", body: { enabled: next } },
      );
      setSaved(updated.enabled);
      setNotice(t("admin.programmeSaved"));
      return true;
    } catch (cause) {
      setError(errorMessage(cause, t));
      return false;
    }
  }

  function toggle(next: boolean) {
    setEnabled(next);
    // Back on the saved value, there is nothing left to retry.
    setError(null);
    setNotice("");
    void flush();
  }

  function retry() {
    // The button leaves with the error; the switch keeps the keyboard focus.
    input.current?.focus();
    void flush();
  }

  return (
    <div
      className="programme-notifications"
      aria-busy={saving}
      data-dirty={enabled !== saved || undefined}
    >
      <label className="checkbox-field">
        <input
          ref={input}
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        {t("admin.programmeNotifications")}
      </label>
      <SavedAnnouncement message={saving ? "" : notice} />
      <ErrorNotice message={error} />
      {error && (
        <button
          type="button"
          className="button secondary"
          disabled={saving}
          onClick={retry}
        >
          <RefreshCw size={17} aria-hidden="true" />
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
