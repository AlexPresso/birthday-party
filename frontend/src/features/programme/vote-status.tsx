"use client";

import { useI18n } from "@/lib/i18n-context";
import type { Vote } from "./contracts";
import "./vote-status.css";

const labels = {
  draft: "activities.draft",
  open: "activities.openStatus",
  closed: "activities.closed",
} as const;

/** The state of a vote in words; an open vote also carries the accent dot. */
export function VoteStatus({ status }: { status: Vote["status"] }) {
  const { t } = useI18n();
  return (
    <span className="vote-status" data-status={status}>
      {t(labels[status])}
    </span>
  );
}
