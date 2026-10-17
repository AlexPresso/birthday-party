"use client";
import { useState } from "react";
import { Users, CalendarDays, PartyPopper, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { Party } from "../party/contracts";
import type { Guest } from "../guests/contracts";
import type { PartyEvent } from "../programme/contracts";
import { PartyEditor } from "../party/party-editor";
import { GuestManager } from "../guests/guest-manager";
import { EventManager } from "../programme/event-manager";

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
