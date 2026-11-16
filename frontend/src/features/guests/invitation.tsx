"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Hourglass,
  KeyRound,
  Link2Off,
  MapPin,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { sessionSchema } from "./contracts";
import { partyStartSchema, type PartyStart } from "@/features/party/contracts";
import { countdown } from "./countdown";
import { BrandMark } from "@/components/brand-mark";
import { Snow } from "@/components/snow";
import { ErrorNotice } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import "./invitation.css";

type Invited = { name: string; party: PartyStart };

// A link is single-use: accept each token once per page, even when an effect
// runs twice, and let the request finish so its session cookie is kept.
const accepting = new Map<string, Promise<{ guest: { name: string } }>>();
function accept(token: string) {
  let request = accepting.get(token);
  if (!request) {
    request = api("/invitations/accept", sessionSchema, {
      method: "POST",
      body: { token },
    });
    accepting.set(token, request);
  }
  return request;
}

/**
 * Opening an invitation link signs the guest in on this device at once; the
 * page then says when and where the party is, and its Enter button counts down
 * until Go lets guests in, at the party's date and time.
 */
export function Invitation({
  age,
  title,
  description,
}: {
  age: number;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [invited, setInvited] = useState<Invited | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    async function signedIn() {
      const response = await fetch("/api/session", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) return null;
      const session = sessionSchema.safeParse(await response.json());
      return session.success ? session.data.guest : null;
    }
    async function open() {
      let guest = null;
      let failure: unknown = null;
      if (token) {
        try {
          guest = (await accept(token)).guest;
        } catch (cause) {
          failure = cause;
        }
        // The token is spent or useless now: keep it out of the address bar.
        window.history.replaceState(null, "", "/invitation");
      }
      // A link opened again, or no link at all, still works for a guest whose
      // session on this device is valid.
      const returning = !guest;
      guest ??= await signedIn();
      if (!guest) {
        if (failure) setError(errorMessage(failure, t));
        return;
      }
      const party = await api("/welcome/party", partyStartSchema, { signal });
      // Once the party has started, a returning guest goes straight in.
      if (returning && party.started) {
        router.replace("/photos");
        return;
      }
      setInvited({ name: guest.name, party });
    }
    void open()
      .catch((cause) => {
        if (!signal.aborted) setError(errorMessage(cause, t));
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [router, t]);

  // The button becomes Enter by itself at the party's date and time: the
  // countdown is read again every 30 seconds, and once more at the start.
  const startsAt = invited && !invited.party.started && invited.party.date;
  useEffect(() => {
    if (!startsAt) return;
    const left = new Date(startsAt).getTime() - now.getTime();
    if (left <= 0) return;
    const timer = window.setTimeout(
      () => setNow(new Date()),
      Math.min(left, 30_000),
    );
    return () => window.clearTimeout(timer);
  }, [startsAt, now]);

  const party = invited?.party;
  const wait =
    party && !party.started && party.date
      ? countdown(party.date, now, party.timezone)
      : { kind: "started" as const };
  const time =
    party?.date &&
    new Intl.DateTimeFormat(locale, {
      timeZone: party.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(party.date));

  return (
    <main className="invitation-page">
      <Snow count={70} />
      <div className="invitation-card">
        <div className="brand">
          <BrandMark />
          {title && <strong>{title}</strong>}
        </div>
        <div
          className={`invitation-ring${age > 99 ? " invitation-ring-long" : ""}`}
          aria-hidden="true"
        >
          <span>{age}</span>
        </div>
        <h1>
          {invited
            ? t("invitation.hello", { name: invited.name })
            : t("invitation.welcome")}
        </h1>
        {description && <p className="invitation-intro">{description}</p>}
        {loading ? (
          <p className="loading-inline" role="status">
            <span className="spinner" />
            {t("invitation.checking")}
          </p>
        ) : party ? (
          <>
            {(party.date || party.location || party.mapUrl) && (
              <div className="invitation-details">
                {party.date && (
                  <p className="invitation-date">
                    <CalendarDays size={18} aria-hidden="true" />
                    {formatDate(party.date, party.timezone, true, locale)}
                  </p>
                )}
                {party.mapUrl ? (
                  <a
                    className="invitation-place"
                    href={party.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin size={17} aria-hidden="true" />
                    {party.location || t("programme.openMap")}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </a>
                ) : (
                  party.location && (
                    <p className="invitation-place">
                      <MapPin size={17} aria-hidden="true" />
                      {party.location}
                    </p>
                  )
                )}
              </div>
            )}
            {party.message && (
              <p className="invitation-message">{party.message}</p>
            )}
            <div className="invitation-actions">
              {wait.kind === "started" ? (
                <button
                  className="invitation-enter"
                  onClick={() => {
                    router.replace("/photos");
                    router.refresh();
                  }}
                >
                  <span>{t("invitation.enter")}</span>
                  <span className="invitation-enter-icon" aria-hidden="true">
                    <ArrowRight size={22} strokeWidth={2.25} />
                  </span>
                </button>
              ) : (
                // Not a disabled button: nothing to press until the party.
                <p
                  className="invitation-enter invitation-countdown"
                  role="status"
                >
                  <span>
                    {wait.kind === "days"
                      ? t("invitation.countdownDays", { count: wait.count })
                      : wait.kind === "tomorrow"
                        ? t("invitation.countdownTomorrow")
                        : t("invitation.countdownToday", { time: time ?? "" })}
                  </span>
                  <span className="invitation-enter-icon" aria-hidden="true">
                    <Hourglass size={20} strokeWidth={2.25} />
                  </span>
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="invitation-help">
            {error ? (
              <Link2Off size={25} aria-hidden="true" />
            ) : (
              <KeyRound size={25} aria-hidden="true" />
            )}
            <h2>
              {error ? t("invitation.unavailable") : t("invitation.open")}
            </h2>
            {!error && <p className="muted">{t("invitation.linkHelp")}</p>}
          </div>
        )}
        <ErrorNotice message={error} />
      </div>
    </main>
  );
}
