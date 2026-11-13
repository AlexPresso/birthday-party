"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAutosave } from "@/lib/autosave";
import { useRouteRefresh } from "@/lib/use-route-refresh";
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
  const refreshRoute = useRouteRefresh();
  const form = useRef<HTMLFormElement>(null);
  const savedRequest = useRef(party);
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
  const [savedDraft, setSavedDraft] = useState({
    title: party.title,
    location: party.location,
    timezone: party.timezone,
    dateDraft: null as string | null,
  });
  const dirty =
    title !== savedDraft.title ||
    location !== savedDraft.location ||
    timezone !== savedDraft.timezone ||
    dateDraft !== savedDraft.dateDraft;
  const autosave = useAutosave({ save });

  async function save() {
    const submitted = { title, location, timezone, dateDraft };
    setError(null);
    setSaved(false);
    try {
      const body = {
        title: title.trim(),
        location: location.trim(),
        timezone: timezone.trim(),
        date: dateDraft === null ? party.date : utcInput(dateDraft),
      };
      if (
        body.title === savedRequest.current.title &&
        body.location === savedRequest.current.location &&
        body.timezone === savedRequest.current.timezone &&
        body.date === savedRequest.current.date
      ) {
        setSavedDraft(submitted);
        setSaved(true);
        return true;
      }
      if (!form.current?.reportValidity()) return false;
      new Intl.DateTimeFormat(locale, { timeZone: timezone });
      const updated = await api("/admin/party", partySchema, {
        method: "PATCH",
        body,
      });
      savedRequest.current = body;
      onSave(updated);
      setSavedDraft(submitted);
      setSaved(true);
      refreshRoute();
      return true;
    } catch (err) {
      setError(
        err instanceof RangeError
          ? t("admin.invalidTimezone")
          : errorMessage(err, t),
      );
      return false;
    }
  }
  return (
    <form
      ref={form}
      className="admin-form"
      onBlur={autosave.onBlur}
      onChange={() => {
        setError(null);
        setSaved(false);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void autosave.flush();
      }}
    >
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
        <span className="success-notice" role="status">
          {autosave.saving
            ? t("admin.saving")
            : saved && !dirty
              ? t("admin.partySaved")
              : ""}
        </span>
      </div>
    </form>
  );
}
