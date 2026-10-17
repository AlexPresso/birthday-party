"use client";
import { useState } from "react";
import { Plus, Copy, Check, Link2, Trash2, X } from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { formatDate } from "@/lib/dates";
import { invitationSchema, newGuestSchema, type Guest } from "./contracts";
import { ErrorNotice } from "@/components/ui";
import { Avatar } from "@/components/avatar";

export function GuestManager({
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
            <Avatar
              name={guest.name}
              avatarUrl={
                guest.id === currentGuest.id
                  ? currentGuest.avatarUrl
                  : guest.avatarUrl
              }
            />
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
