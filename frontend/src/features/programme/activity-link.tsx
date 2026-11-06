"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { PartyEvent } from "./contracts";
import "./activity-link.css";

function ActivityLinkContent({ preparing }: { preparing: boolean }) {
  const { t } = useI18n();
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-live="polite">
        {t(pending || preparing ? "questions.loading" : "questions.view")}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </>
  );
}

export function ActivityLink({
  event,
  beforeNavigate,
}: {
  event: PartyEvent;
  beforeNavigate?: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [preparing, startTransition] = useTransition();
  if (event.locked || event.type !== "questions" || !event.questions)
    return null;
  return (
    <Link
      className="button secondary programme-activity-link"
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
      <ActivityLinkContent preparing={preparing} />
    </Link>
  );
}
