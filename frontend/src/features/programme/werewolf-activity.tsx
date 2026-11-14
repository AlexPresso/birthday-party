"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Moon, Pencil, Sun } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ErrorNotice, SavedAnnouncement } from "@/components/ui";
import { useI18n } from "@/lib/i18n-context";
import type { Werewolf } from "./contracts";
import { useWerewolfGame, type ActivityHeading } from "./use-werewolf-game";
import { MasterBoard, MasterLobby } from "./werewolf-master";
import { gamePhase } from "./werewolf-model";
import { PlayerBoard } from "./werewolf-player";
import { WerewolfPlayers } from "./werewolf-players";
import { WerewolfStatus } from "./werewolf-status";
import "./activity-page.css";
import "./werewolf.css";

/**
 * Night recolours the whole app while this page shows it: the night tokens
 * of `tokens.css` apply under `data-phase="night"` on the document root.
 * The attribute stays "day" otherwise while the page is open, so the way
 * back crossfades too, and leaves with the page, which restores the normal
 * theme at once.
 */
function useRootPhase(night: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.phase = night ? "night" : "day";
    return () => {
      delete root.dataset.phase;
    };
  }, [night]);
}

/**
 * The page of a werewolf game. The server decides what this viewer sees; the
 * page picks the view from the state of the game and the viewer's part in it,
 * and follows both when they change while it is open.
 */
export function WerewolfActivity({
  event,
  initial,
  guestId,
  isAdmin,
}: {
  event: ActivityHeading;
  initial: Werewolf;
  guestId: number;
  isAdmin: boolean;
}) {
  const { t } = useI18n();
  const { game, heading, busy, notice, message, retry, send, command } =
    useWerewolfGame(event, initial, isAdmin);
  const master = game.gameMaster;
  const phase = gamePhase(game);
  // While the game runs, a player's screen keeps to the game itself.
  const playing = game.status === "running" && !game.isGameMaster;
  useRootPhase(phase === "night");

  function view() {
    if (game.isGameMaster && game.status === "lobby")
      return (
        <MasterLobby
          game={game}
          guestId={guestId}
          busy={busy}
          command={command}
          send={send}
        />
      );
    if (game.isGameMaster && game.status === "running")
      return (
        <MasterBoard
          game={game}
          guestId={guestId}
          busy={busy}
          command={command}
        />
      );
    if (playing)
      return <PlayerBoard game={game} guestId={guestId} send={send} />;
    return (
      <>
        {game.status === "lobby" && (
          <button
            type="button"
            className={`button ${game.joined ? "secondary" : "primary"} werewolf-join`}
            disabled={busy}
            onClick={() =>
              void (game.joined
                ? command(
                    "/players/me",
                    "DELETE",
                    undefined,
                    t("werewolf.left"),
                  )
                : command("/players", "POST", {}, t("werewolf.joined")))
            }
          >
            {t(game.joined ? "werewolf.leave" : "werewolf.join")}
          </button>
        )}
        {game.status === "finished" && game.isGameMaster && (
          <button
            type="button"
            className="button primary werewolf-join"
            disabled={busy}
            onClick={() =>
              void command("/state", "POST", (revision) => ({
                revision,
                action: "reset",
              }))
            }
          >
            {t("werewolf.reset")}
          </button>
        )}
        <div className="werewolf-main">
          <WerewolfPlayers game={game} guestId={guestId} />
        </div>
      </>
    );
  }

  return (
    <div className="werewolf-page">
      <Link className="activity-back" href="/programme">
        <ArrowLeft size={21} aria-hidden="true" />
        {t("nav.programme")}
      </Link>
      <header className="werewolf-heading">
        <h1>{heading.title}</h1>
        <p className="werewolf-summary">
          <WerewolfStatus status={game.status} />
          <span role="status">
            {phase && (
              <span className="werewolf-phase">
                {phase === "night" ? (
                  <Moon size={16} aria-hidden="true" />
                ) : (
                  <Sun size={16} aria-hidden="true" />
                )}
                {t(phase === "night" ? "werewolf.night" : "werewolf.day")}
              </span>
            )}
          </span>
        </p>
        {!playing && heading.description && (
          <p className="werewolf-description">{heading.description}</p>
        )}
        {!playing &&
          (master ? (
            <p className="werewolf-master">
              <Avatar name={master.name} avatarUrl={master.avatarUrl} />
              <span>
                <span className="werewolf-master-label">
                  {t("werewolf.gameMaster")}
                </span>
                <strong>{master.name}</strong>
              </span>
            </p>
          ) : (
            <p className="werewolf-note">
              {t(
                game.status === "lobby"
                  ? "werewolf.cannotStart"
                  : "werewolf.gameMasterMissing",
              )}
            </p>
          ))}
        {isAdmin && !master && (
          <Link
            className="button secondary"
            href="/parametres?section=programme"
          >
            <Pencil size={17} aria-hidden="true" />
            {t("werewolf.chooseGameMaster")}
          </Link>
        )}
      </header>
      {message && (
        <div className="werewolf-feedback">
          <ErrorNotice message={message} />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={retry}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      {/* The page shows what changed; only screen readers are told. */}
      <SavedAnnouncement message={notice} />
      {view()}
      {isAdmin && master && (
        <Link
          className="button secondary werewolf-manage"
          href="/parametres?section=programme"
        >
          <Pencil size={17} aria-hidden="true" />
          {t("programme.manage")}
        </Link>
      )}
    </div>
  );
}
