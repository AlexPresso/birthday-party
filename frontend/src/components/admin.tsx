"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  CalendarDays,
  PartyPopper,
  Plus,
  Copy,
  Check,
  Link2,
  Trash2,
  ChevronDown,
  Save,
  Pencil,
  X,
} from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import {
  partySchema,
  invitationSchema,
  newGuestSchema,
  eventSchema,
  formatDate,
  type Party,
  type Guest,
  type PartyEvent,
} from "@/lib/contracts";
import { ErrorNotice } from "./ui";

// Date inputs are explicitly in the organizer's browser timezone. Submitted
// instants always use UTC; guests see them in the party's configured timezone.
function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function utcInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const noSubscription = () => () => {};

export function AdminPanel({
  guest,
  party: initialParty,
  guests: initialGuests,
  events: initialEvents,
}: {
  guest: Guest;
  party: Party;
  guests: Guest[];
  events: PartyEvent[];
}) {
  const { t } = useI18n();
  const [party, setParty] = useState(initialParty);
  return (
    <section className="admin-section">
      <div className="section-row">
        <div>
          <h2>{t("admin.title")}</h2>
        </div>
        <span className="status-label">{t("admin.privateAccess")}</span>
      </div>
      <p className="muted admin-intro">{t("admin.intro")}</p>
      <details className="admin-accordion panel" open>
        <summary>
          <PartyPopper size={21} />
          <span>{t("admin.party")}</span>
          <ChevronDown size={18} />
        </summary>
        <PartyEditor party={party} onSave={setParty} />
      </details>
      <details className="admin-accordion panel">
        <summary>
          <Users size={21} />
          <span>{t("admin.guests")}</span>
          <ChevronDown size={18} />
        </summary>
        <GuestManager
          initial={initialGuests}
          currentGuest={guest}
          timezone={party.timezone}
        />
      </details>
      <details className="admin-accordion panel">
        <summary>
          <CalendarDays size={21} />
          <span>{t("admin.programme")}</span>
          <ChevronDown size={18} />
        </summary>
        <EventManager initial={initialEvents} timezone={party.timezone} />
      </details>
    </section>
  );
}

function PartyEditor({
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
  const [date, setDate] = useState<string | null>(null);
  // The browser timezone is only available after hydration. Keep the original
  // instant on save until the host edits the date, including its seconds.
  const savedDate = useSyncExternalStore(
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
          date: date === null ? party.date : utcInput(date),
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
            value={date ?? savedDate}
            onChange={(event) => setDate(event.target.value)}
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

function GuestManager({
  initial,
  currentGuest,
  timezone,
}: {
  initial: Guest[];
  currentGuest: Guest;
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const [guests, setGuests] = useState(initial);
  const activeGuestCount = guests.filter((guest) => guest.active).length;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<{
    invitationUrl: string;
    expiresAt: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setCopied(false);
    try {
      const data = await api("/admin/guests", newGuestSchema, {
        method: "POST",
        body: { name: name.trim() },
      });
      setGuests((items) => [...items, data.guest]);
      setInvitation({ ...data, name: data.guest.name });
      setName("");
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  async function invite(guest: Guest) {
    setBusy(`invite-${guest.id}`);
    setError(null);
    setCopied(false);
    try {
      const data = await api(
        `/admin/guests/${guest.id}/invitation`,
        invitationSchema,
        { method: "POST", body: {} },
      );
      setInvitation({ ...data, name: guest.name });
      setGuests((items) =>
        items.map((item) =>
          item.id === guest.id ? { ...item, active: true } : item,
        ),
      );
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  async function revoke(guest: Guest) {
    if (!window.confirm(t("admin.revokeConfirmation", { name: guest.name })))
      return;
    setBusy(`revoke-${guest.id}`);
    setError(null);
    try {
      await remove(`/admin/guests/${guest.id}`);
      setGuests((items) =>
        items.map((item) =>
          item.id === guest.id ? { ...item, active: false } : item,
        ),
      );
      setInvitation(null);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  async function copy() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.invitationUrl);
      setCopied(true);
    } catch {
      setError(t("admin.copyUnavailable"));
    }
  }
  return (
    <div className="admin-form">
      <form className="invite-form" onSubmit={create}>
        <div>
          <label htmlFor="guest-name">{t("admin.guestName")}</label>
          <input
            id="guest-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            autoComplete="off"
            placeholder={t("admin.guestNamePlaceholder")}
          />
        </div>
        <button className="button primary" disabled={!!busy || !name.trim()}>
          <Plus size={18} />
          {busy === "create"
            ? t("admin.creating")
            : t("admin.createInvitation")}
        </button>
      </form>
      <p className="fine-print">{t("admin.invitationHint")}</p>
      <ErrorNotice message={error} />
      {invitation && (
        <div className="invitation-result">
          <div className="section-row">
            <h3>{t("admin.invitationFor", { name: invitation.name })}</h3>
            <button
              className="icon-button"
              aria-label={t("admin.hideInvitation")}
              onClick={() => setInvitation(null)}
            >
              <X size={17} />
            </button>
          </div>
          <label htmlFor="invitation-link">{t("admin.personalLink")}</label>
          <input
            id="invitation-link"
            readOnly
            value={invitation.invitationUrl}
            onFocus={(event) => event.target.select()}
          />
          <div className="form-actions">
            <button className="button secondary" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t("admin.linkCopied") : t("admin.copyLink")}
            </button>
            <span className="fine-print">
              {t("admin.expiresAt", {
                date: formatDate(invitation.expiresAt, timezone, true, locale),
              })}
            </span>
          </div>
          <p className="fine-print">{t("admin.singleUse")}</p>
        </div>
      )}
      <div className="section-row guest-list-heading">
        <h3>{t("admin.guests")}</h3>
        <span className="fine-print">
          {t(
            new Intl.PluralRules(locale).select(activeGuestCount) === "one"
              ? "admin.activeGuests.one"
              : "admin.activeGuests.other",
            { count: activeGuestCount },
          )}
        </span>
      </div>
      <ul className="guest-list">
        {guests.map((guest) => (
          <li key={guest.id}>
            <span className="avatar">
              {guest.name.charAt(0).toLocaleUpperCase(locale)}
            </span>
            <div className="guest-list-name">
              <strong>
                {guest.name}
                {guest.id === currentGuest.id
                  ? ` (${t("admin.yourself")})`
                  : ""}
              </strong>
              <span className="fine-print">
                {!guest.active
                  ? t("admin.accessRevoked")
                  : guest.role === "admin"
                    ? t("admin.host")
                    : t("admin.guest")}
              </span>
            </div>
            <div className="guest-actions">
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => invite(guest)}
                aria-label={t("admin.newLinkFor", { name: guest.name })}
              >
                <Link2 size={16} />
                <span>
                  {busy === `invite-${guest.id}`
                    ? t("admin.creating")
                    : guest.active
                      ? t("admin.newLink")
                      : t("admin.reinvite")}
                </span>
              </button>
              {guest.active && guest.id !== currentGuest.id && (
                <button
                  className="icon-button danger"
                  disabled={!!busy}
                  onClick={() => revoke(guest)}
                  aria-label={t("admin.revokeAccessFor", { name: guest.name })}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type EventDraft = {
  id: number | null;
  title: string;
  description: string;
  teaser: string;
  startsAt: string;
  unlockAt: string;
};
const emptyDraft: EventDraft = {
  id: null,
  title: "",
  description: "",
  teaser: "",
  startsAt: "",
  unlockAt: "",
};
function EventManager({
  initial,
  timezone,
}: {
  initial: PartyEvent[];
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("");
  function edit(event?: PartyEvent) {
    setZone(browserZone());
    setError(null);
    setNotice("");
    setDraft(
      event
        ? {
            id: event.id,
            title: event.title,
            description: event.description,
            teaser: event.teaser,
            startsAt: localInput(event.startsAt),
            unlockAt: localInput(event.unlockAt),
          }
        : { ...emptyDraft },
    );
  }
  function change(key: keyof Omit<EventDraft, "id">, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const data = await api(
        `/admin/programme${draft.id ? `/${draft.id}` : ""}`,
        eventSchema,
        {
          method: draft.id ? "PUT" : "POST",
          body: {
            title: draft.title.trim(),
            description: draft.description.trim(),
            teaser: draft.teaser.trim(),
            startsAt: utcInput(draft.startsAt),
            unlockAt: utcInput(draft.unlockAt),
          },
        },
      );
      setEvents((items) =>
        [...items.filter((item) => item.id !== data.id), data].sort((a, b) =>
          (a.startsAt || "9999").localeCompare(b.startsAt || "9999"),
        ),
      );
      setDraft(null);
      setNotice(t("admin.programmeSaved"));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }
  async function deleteEvent(event: PartyEvent) {
    if (
      !window.confirm(t("admin.deleteEventConfirmation", { name: event.title }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await remove(`/admin/programme/${event.id}`);
      setEvents((items) => items.filter((item) => item.id !== event.id));
      if (draft?.id === event.id) setDraft(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-form">
      <div className="section-row">
        <p className="muted">{t("admin.surpriseHint")}</p>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => edit()}
        >
          <Plus size={17} />
          {t("admin.addEvent")}
        </button>
      </div>
      <ErrorNotice message={error} />
      <p className="success-notice" role="status">
        {notice}
      </p>
      {draft && (
        <form className="event-editor" onSubmit={save}>
          <div className="section-row">
            <h3>{draft.id ? t("admin.editEvent") : t("admin.newEvent")}</h3>
            <button
              type="button"
              className="icon-button"
              onClick={() => setDraft(null)}
              aria-label={t("admin.cancelEdit")}
            >
              <X size={18} />
            </button>
          </div>
          <label htmlFor="event-title">{t("admin.eventTitle")}</label>
          <input
            id="event-title"
            value={draft.title}
            onChange={(event) => change("title", event.target.value)}
            maxLength={160}
            required
          />
          <label htmlFor="event-description">{t("admin.eventDetails")}</label>
          <textarea
            id="event-description"
            rows={3}
            maxLength={4000}
            value={draft.description}
            onChange={(event) => change("description", event.target.value)}
          />
          <label htmlFor="event-teaser">{t("admin.teaser")}</label>
          <input
            id="event-teaser"
            value={draft.teaser}
            maxLength={160}
            onChange={(event) => change("teaser", event.target.value)}
            placeholder={t("admin.teaserPlaceholder")}
          />
          <div className="form-grid">
            <div>
              <label htmlFor="event-start">{t("admin.eventStart")}</label>
              <input
                id="event-start"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => change("startsAt", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="event-unlock">{t("admin.eventUnlock")}</label>
              <input
                id="event-unlock"
                type="datetime-local"
                value={draft.unlockAt}
                onChange={(event) => change("unlockAt", event.target.value)}
              />
            </div>
          </div>
          <p className="fine-print">
            {t("admin.eventDateHint", { zone, timezone })}
          </p>
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy || !draft.title.trim()}
            >
              <Save size={17} />
              {busy ? t("admin.saving") : t("admin.saveEvent")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("admin.cancel")}
            </button>
          </div>
        </form>
      )}
      {events.length === 0 && !draft && (
        <p className="admin-empty">{t("admin.emptyProgramme")}</p>
      )}
      <ul className="admin-event-list">
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <strong>{event.title}</strong>
              <p className="fine-print">
                {event.startsAt
                  ? formatDate(event.startsAt, timezone, true, locale)
                  : t("admin.timePending")}
              </p>
              <span className="fine-print">
                {event.unlockAt
                  ? t("admin.revealedAt", {
                      date: formatDate(event.unlockAt, timezone, true, locale),
                    })
                  : t("admin.detailsVisible")}
              </span>
            </div>
            <div className="button-row">
              <button
                className="icon-button"
                aria-label={t("admin.editNamedEvent", { name: event.title })}
                disabled={busy}
                onClick={() => edit(event)}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-button danger"
                aria-label={t("admin.deleteNamedEvent", { name: event.title })}
                disabled={busy}
                onClick={() => deleteEvent(event)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
