"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, MessageCircle, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n-context";
import { ErrorNotice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { invitationSchema, type Guest, type Invitation } from "./contracts";
import { whatsappLink } from "./invitation-message";

/**
 * Sends the invitations of every guest who has not come in yet, one WhatsApp
 * message after another. Links are kept only as hashes, so each guest gets a
 * new link when they come up; it is reused if the host goes back to them.
 */
export function BulkWhatsApp({
  guests,
  whatsappMessage,
  onClose,
}: {
  guests: Guest[];
  whatsappMessage: string | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const id = useId();
  // The list is taken when the panel opens, so it does not shift under the host.
  const [waiting] = useState(() =>
    guests.filter((guest) => guest.active && guest.joined === false),
  );
  const recipients = waiting.filter((guest) => guest.phone);
  const withoutPhone = waiting.filter((guest) => !guest.phone);
  const [index, setIndex] = useState(0);
  const [links, setLinks] = useState<Record<number, Invitation>>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<number>());
  const current = recipients[index];
  const link = current ? links[current.id] : undefined;

  useEffect(() => {
    if (!current || requested.current.has(current.id)) return;
    requested.current.add(current.id);
    void api(`/admin/guests/${current.id}/invitation`, invitationSchema, {
      method: "POST",
      body: {},
    })
      .then((invitation) =>
        setLinks((known) => ({ ...known, [current.id]: invitation })),
      )
      .catch((cause) => {
        requested.current.delete(current.id);
        setError(errorMessage(cause, t));
      });
  }, [current, attempt, t]);

  const names = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  });
  return (
    <section className="bulk-whatsapp" aria-labelledby={`${id}-title`}>
      <div className="section-row">
        <h3 id={`${id}-title`}>{t("admin.bulkTitle")}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label={t("admin.closeGuest")}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {withoutPhone.length > 0 && (
        <p className="bulk-whatsapp-missing">
          {t("admin.bulkWithoutPhone", {
            names: names.format(withoutPhone.map((guest) => guest.name)),
          })}
        </p>
      )}
      {recipients.length === 0 ? (
        <p className="fine-print">{t("admin.bulkNobody")}</p>
      ) : (
        <>
          <p className="fine-print">{t("admin.bulkRenews")}</p>
          <div className="bulk-whatsapp-guest" aria-live="polite">
            {current ? (
              <>
                <Avatar name={current.name} avatarUrl={current.avatarUrl} />
                <div>
                  <strong>{current.name}</strong>
                  <span className="fine-print">
                    {t("admin.bulkPosition", {
                      current: index + 1,
                      total: recipients.length,
                    })}
                  </span>
                </div>
              </>
            ) : (
              <p className="fine-print">{t("admin.bulkEnd")}</p>
            )}
          </div>
          <ErrorNotice message={error} />
          {error && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("common.retry")}
            </button>
          )}
          <div className="bulk-whatsapp-actions">
            <button
              type="button"
              className="button secondary"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              {t("welcome.previous")}
            </button>
            {current && (
              // A link without an address while the guest's new link loads:
              // the role keeps it one control throughout.
              <a
                role="link"
                className="button primary"
                aria-disabled={!link}
                href={
                  link && current.phone
                    ? whatsappLink(
                        current.phone,
                        whatsappMessage ?? t("admin.whatsappMessage"),
                        current.name,
                        link.invitationUrl,
                      )
                    : undefined
                }
                // Opening WhatsApp leaves this page as it is: move on to the
                // next guest for when the host comes back.
                onClick={(event) => {
                  if (!link) {
                    event.preventDefault();
                    return;
                  }
                  setTimeout(() => setIndex(index + 1), 0);
                }}
              >
                <MessageCircle size={17} aria-hidden="true" />
                {t("admin.sendWhatsApp")}
              </a>
            )}
            {current && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setIndex(index + 1)}
              >
                {t("welcome.next")}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
