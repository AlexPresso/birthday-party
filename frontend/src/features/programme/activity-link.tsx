"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowRight } from "lucide-react";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n-context";
import type { PartyEvent } from "./contracts";
import "./activity-link.css";

type LinkLabels = { label: MessageKey; loading: MessageKey };

/** The labels of the link to an event's activity page, if it has one to read. */
function activityLabels(
  event: PartyEvent,
  invites: boolean,
): LinkLabels | null {
  if (event.locked) return null;
  if (event.type === "questions" && event.questions)
    return { label: "questions.view", loading: "questions.loading" };
  if (event.type === "vote" && event.vote) {
    const canVote = event.vote.status === "open" && event.vote.canVote;
    return {
      label: invites && canVote ? "programme.vote" : "programme.viewVote",
      loading: "activities.loading",
    };
  }
  return null;
}

function ActivityLinkContent({
  labels,
  preparing,
}: {
  labels: LinkLabels;
  preparing: boolean;
}) {
  const { t } = useI18n();
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-live="polite">
        {t(pending || preparing ? labels.loading : labels.label)}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </>
  );
}

export function ActivityLink({
  event,
  variant = "agenda",
  beforeNavigate,
}: {
  event: PartyEvent;
  /**
   * `featured` is the main action of the featured vote card. `settings` sits
   * among the host's controls and never invites the host to vote.
   */
  variant?: "agenda" | "featured" | "settings";
  beforeNavigate?: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [preparing, startTransition] = useTransition();
  const labels = activityLabels(event, variant !== "settings");
  if (!labels) return null;
  return (
    <Link
      className={`button ${variant === "featured" ? "primary" : "secondary"} programme-activity-link`}
      href={`/programme/${event.id}`}
      aria-busy={preparing || undefined}
      onNavigate={
        beforeNavigate
          ? (navigation) => {
              navigation.preventDefault();
              if (preparing) return;
              startTransition(async () => {
                if (await beforeNavigate())
                  router.push(`/programme/${event.id}`);
              });
            }
          : undefined
      }
    >
      <ActivityLinkContent labels={labels} preparing={preparing} />
    </Link>
  );
}
