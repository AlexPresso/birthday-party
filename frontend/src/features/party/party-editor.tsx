"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { localInput, utcInput } from "@/lib/dates";
import { partySchema, type Party } from "./contracts";
import { ErrorNotice } from "@/components/ui";

const noSubscription = () => () => {};

export function PartyEditor({
  party,
  onSave,
}: {
  party: Party;
  onSave: (party: Party) => void;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(party.title);
  const [location, setLocation] = useState(party.location);
  const [timezone, setTimezone] = useState(party.timezone);
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  // The browser timezone is only available after hydration. Keep the original
  // instant on save until the host edits the date, including its seconds.
  const savedLocalDate = useSyncExternalStore(
    noSubscription,
    () => localInput(party.date),
    () => "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      new Intl.DateTimeFormat(locale, { timeZone: timezone });
      const updated = await api("/admin/party", partySchema, {
        method: "PATCH",
        body: {
          title: title.trim(),
          location: location.trim(),
          timezone: timezone.trim(),
          date: dateDraft === null ? party.date : utcInput(dateDraft),
        },
      });
      onSave(updated);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof RangeError
          ? t("admin.invalidTimezone")
          : errorMessage(err, t),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-form" onSubmit={save}>
      <div className="form-grid">
        <div>
          <label htmlFor="party-title">{t("admin.partyTitle")}</label>
          <input
            id="party-title"
            value={title}
            maxLength={120}
            placeholder={t("birthday.fallback")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="party-location">{t("admin.location")}</label>
          <input
            id="party-location"
            value={location}
            maxLength={240}
            placeholder={t("admin.unspecified")}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="party-date">{t("admin.partyDate")}</label>
          <input
            id="party-date"
            type="datetime-local"
            value={dateDraft ?? savedLocalDate}
            onChange={(event) => setDateDraft(event.target.value)}
          />
          <p className="fine-print">{t("admin.dateHint")}</p>
        </div>
        <div>
          <label htmlFor="party-timezone">{t("admin.partyTimezone")}</label>
          <input
            id="party-timezone"
            value={timezone}
            required
            list="timezones"
            onChange={(event) => setTimezone(event.target.value)}
          />
          <datalist id="timezones">
            <option value="Europe/Zurich" />
            <option value="Europe/Paris" />
            <option value="Europe/Brussels" />
            <option value="America/Montreal" />
            <option value="UTC" />
          </datalist>
          <p className="fine-print">{t("admin.timezoneHint")}</p>
        </div>
      </div>
      <ErrorNotice message={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          <Save size={17} />
          {busy ? t("admin.saving") : t("admin.saveParty")}
        </button>
        <span className="success-notice" role="status">
          {saved ? t("admin.partySaved") : ""}
        </span>
      </div>
    </form>
  );
}
