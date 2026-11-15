"use client";
import { useId, useState } from "react";
import { Check, Copy, MessageCircle, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { formatDate } from "@/lib/dates";
import { useCopiedCue } from "@/lib/use-copied-cue";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { guestUpdateSchema, type Guest, type Invitation } from "./contracts";
import { invitationMessage } from "./invitation-message";

/**
 * One guest's name and number, saved when a field is left, and their latest
 * invitation: the link, its copy button and WhatsApp with the message written
 * out. The whatsapp:// scheme opens the app on the device itself, so the link
 * never travels in a web address's query.
 */
export function GuestPanel({
  guest,
  invitation,
  whatsappMessage,
  timezone,
  onGuestChange,
  onInvitation,
  onClose,
}: {
  guest: Guest;
  invitation: Invitation | null;
  whatsappMessage: string | null;
  timezone: string;
  onGuestChange: (guest: Guest) => void;
  onInvitation: (invitation: Invitation) => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const id = useId();
  const [name, setName] = useState(guest.name);
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, markCopied] = useCopiedCue<true>();
  const savedPhone = guest.phone ?? "";
  const dirty = name.trim() !== guest.name || phone.trim() !== savedPhone;

  async function save() {
    if (!dirty || saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api(`/admin/guests/${guest.id}`, guestUpdateSchema, {
        method: "PUT",
        body: { name, phone },
      });
      setName(saved.guest.name);
      setPhone(saved.guest.phone ?? "");
      onGuestChange(saved.guest);
      if (saved.invitation) {
        markCopied(null);
        onInvitation(saved.invitation);
      }
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.invitationUrl);
      markCopied(true);
    } catch {
      setError(t("admin.copyUnavailable"));
    }
  }

  const whatsapp =
    invitation && guest.phone && !dirty
      ? `whatsapp://send?phone=${guest.phone.slice(1)}&text=${encodeURIComponent(
          invitationMessage(
            whatsappMessage ?? t("admin.whatsappMessage"),
            guest.name,
            invitation.invitationUrl,
          ),
        )}`
      : null;
  return (
    <section className="invitation-result" aria-labelledby={`${id}-title`}>
      <div className="section-row">
        <h3 id={`${id}-title`}>{guest.name}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label={t("admin.closeGuest")}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div
        className="guest-panel-fields"
        aria-busy={saving}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      >
        <div>
          <label htmlFor={`${id}-name`}>{t("admin.guestName")}</label>
          <input
            id={`${id}-name`}
            value={name}
            required
            maxLength={80}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div>
          <label htmlFor={`${id}-phone`}>{t("admin.phone")}</label>
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            value={phone}
            autoComplete="off"
            placeholder="+41 79 123 45 67"
            aria-describedby={guest.active ? `${id}-phone-hint` : undefined}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
          />
          {guest.active && (
            <p id={`${id}-phone-hint`} className="fine-print">
              {t("admin.phoneRenewsLink")}
            </p>
          )}
        </div>
      </div>
      <ErrorNotice message={error} />
      {invitation && (
        <>
          <label htmlFor={`${id}-link`}>{t("admin.personalLink")}</label>
          <input
            id={`${id}-link`}
            readOnly
            value={invitation.invitationUrl}
            onFocus={(event) => event.target.select()}
          />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t("admin.linkCopied") : t("admin.copyLink")}
            </button>
            {whatsapp && (
              <a className="button primary" href={whatsapp}>
                <MessageCircle size={17} aria-hidden="true" />
                {t("admin.sendWhatsApp")}
              </a>
            )}
            <SavedAnnouncement message={copied ? t("admin.linkCopied") : ""} />
          </div>
          <p className="fine-print">
            {t("admin.expiresAt", {
              date: formatDate(invitation.expiresAt, timezone, true, locale),
            })}{" "}
            {t("admin.singleUse")}
          </p>
        </>
      )}
    </section>
  );
}
