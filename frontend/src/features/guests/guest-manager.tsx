"use client";
import { useState } from "react";
import { Plus, Link2, Pencil, Trash2 } from "lucide-react";
import { api, remove, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { GuestPanel } from "./guest-panel";
import {
  invitationSchema,
  newGuestSchema,
  type Guest,
  type Invitation,
} from "./contracts";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar } from "@/components/avatar";
import "./guests.css";

export function GuestManager({
  guests,
  onGuestChange,
  onGuestRemove,
  currentGuest,
  whatsappMessage,
  timezone,
}: {
  guests: Guest[];
  onGuestChange: (guest: Guest) => void;
  onGuestRemove: (id: number) => void;
  currentGuest: Guest;
  /** The host's WhatsApp invitation text; null uses the interface's. */
  whatsappMessage: string | null;
  timezone: string;
}) {
  const { locale, t } = useI18n();
  const confirm = useConfirm();
  const activeGuestCount = guests.filter((guest) => guest.active).length;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The guest open in the panel, with the link issued in this visit if any.
  const [open, setOpen] = useState<{
    guestId: number;
    invitation: Invitation | null;
  } | null>(null);
  const openGuest = open && guests.find((guest) => guest.id === open.guestId);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const { guest, ...invitation } = await api(
        "/admin/guests",
        newGuestSchema,
        { method: "POST", body: { name: name.trim(), phone } },
      );
      onGuestChange(guest);
      setOpen({ guestId: guest.id, invitation });
      setName("");
      setPhone("");
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  async function invite(guest: Guest) {
    setBusy(`invite-${guest.id}`);
    setError(null);
    try {
      const invitation = await api(
        `/admin/guests/${guest.id}/invitation`,
        invitationSchema,
        { method: "POST", body: {} },
      );
      onGuestChange({ ...guest, active: true });
      setOpen({ guestId: guest.id, invitation });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  async function revoke(guest: Guest) {
    const confirmed = await confirm({
      message: t("admin.revokeConfirmation", { name: guest.name }),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(`revoke-${guest.id}`);
    setError(null);
    try {
      await remove(`/admin/guests/${guest.id}`);
      onGuestChange({ ...guest, active: false });
      // Revocation removed the link.
      if (open?.guestId === guest.id) setOpen({ ...open, invitation: null });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }
  // A guest whose access was removed can then be deleted for good.
  async function deletePermanently(guest: Guest) {
    const confirmed = await confirm({
      message: t("admin.deleteConfirmation", { name: guest.name }),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(`delete-${guest.id}`);
    setError(null);
    try {
      await remove(`/admin/guests/${guest.id}/record`);
      if (open?.guestId === guest.id) setOpen(null);
      onGuestRemove(guest.id);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
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
        <div>
          <label htmlFor="guest-phone">{t("admin.phone")}</label>
          <input
            id="guest-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="off"
            placeholder="+41 79 123 45 67"
          />
        </div>
        <button className="button primary" disabled={!!busy || !name.trim()}>
          <Plus size={18} />
          {busy === "create"
            ? t("admin.creating")
            : t("admin.createInvitation")}
        </button>
      </form>
      <ErrorNotice message={error} />
      {open && openGuest && (
        <GuestPanel
          // A new link starts the panel afresh, its copy cue included.
          key={`${openGuest.id}-${open.invitation?.invitationUrl ?? ""}`}
          guest={openGuest}
          invitation={open.invitation}
          whatsappMessage={whatsappMessage}
          timezone={timezone}
          onGuestChange={onGuestChange}
          onInvitation={(invitation) =>
            setOpen({ guestId: openGuest.id, invitation })
          }
          onClose={() => setOpen(null)}
        />
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
            <button
              type="button"
              className="guest-list-name"
              onClick={() =>
                setOpen(
                  open?.guestId === guest.id
                    ? open
                    : { guestId: guest.id, invitation: null },
                )
              }
              aria-label={t("admin.editGuest", { name: guest.name })}
            >
              <strong>
                {guest.name}
                {guest.id === currentGuest.id
                  ? ` (${t("admin.yourself")})`
                  : ""}
                <Pencil size={13} aria-hidden="true" />
              </strong>
              <span className="fine-print">
                {!guest.active
                  ? t("admin.accessRevoked")
                  : guest.role === "admin"
                    ? t("admin.host")
                    : t("admin.guest")}
              </span>
            </button>
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
              {!guest.active && (
                <button
                  className="icon-button danger permanent"
                  disabled={!!busy}
                  onClick={() => deletePermanently(guest)}
                  aria-label={t("admin.deleteFor", { name: guest.name })}
                  title={t("admin.deleteFor", { name: guest.name })}
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
