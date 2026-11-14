"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n-context";
import type { Guest } from "../guests/contracts";
import type { WerewolfSummary } from "./contracts";

/** The one setting of a werewolf event: the guest who leads the game. */
export function GameMasterPicker({
  gameMasterId,
  saved,
  locked,
  guests,
  busy,
  onChange,
}: {
  gameMasterId: number | null;
  /** The game master as last saved, who may have lost access since. */
  saved: WerewolfSummary["gameMaster"];
  /** The game is running: its game master cannot change. */
  locked: boolean;
  guests: Guest[];
  busy: boolean;
  onChange: (gameMasterId: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const choices = guests.filter((guest) => guest.active);
  // The select always shows who is saved, even a guest it no longer offers.
  if (saved && !choices.some((guest) => guest.id === saved.id))
    choices.push({ ...saved, role: "guest", active: false });
  return (
    <div className="werewolf-settings">
      <label htmlFor={id}>{t("werewolf.gameMaster")}</label>
      <select
        id={id}
        value={gameMasterId ?? ""}
        disabled={busy || locked}
        aria-describedby={`${id}-hint`}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">{t("werewolf.noGameMaster")}</option>
        {choices.map((guest) => (
          <option key={guest.id} value={guest.id}>
            {guest.name}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="fine-print">
        {t(locked ? "werewolf.gameMasterLocked" : "werewolf.gameMasterHint")}
      </p>
    </div>
  );
}
