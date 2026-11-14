"use client";

import { useI18n } from "@/lib/i18n-context";
import type { WerewolfSummary } from "./contracts";
import { playerCount } from "./werewolf-model";
import "./werewolf-status.css";

/**
 * The state of a werewolf game in words. A game guests can join or are
 * playing also carries the accent dot. `players` adds how many joined.
 */
export function WerewolfStatus({
  status,
  players,
}: {
  status: WerewolfSummary["status"];
  players?: number;
}) {
  const { t, locale } = useI18n();
  return (
    <span className="werewolf-status" data-status={status}>
      {t(`werewolf.status.${status}`)}
      {players !== undefined && ` · ${playerCount(players, locale, t)}`}
    </span>
  );
}
