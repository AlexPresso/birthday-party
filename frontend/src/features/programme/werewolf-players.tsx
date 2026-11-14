"use client";

import { useId, type ReactNode } from "react";
import { Crown, Skull } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/lib/i18n-context";
import type { Werewolf, WerewolfPlayer } from "./contracts";
import { boardRole, playersByFate, roleText } from "./werewolf-model";

function PlayerList({
  title,
  players,
  game,
  guestId,
  actions,
}: {
  title: string;
  players: WerewolfPlayer[];
  game: Werewolf;
  guestId: number;
  actions?: (player: WerewolfPlayer) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const headingId = useId();
  return (
    <section className="werewolf-section">
      <div className="werewolf-list-heading">
        <h2 id={headingId}>{title}</h2>
        <span>{new Intl.NumberFormat(locale).format(players.length)}</span>
      </div>
      <ul className="werewolf-players" aria-labelledby={headingId}>
        {players.map((player) => {
          const role = boardRole(game, player, guestId);
          return (
            <li
              key={player.id}
              className="werewolf-player"
              data-dead={!player.alive || undefined}
            >
              <span className="werewolf-portrait">
                <Avatar name={player.name} avatarUrl={player.avatarUrl} />
                {!player.alive && (
                  <span className="werewolf-skull" aria-hidden="true">
                    <Skull size={13} />
                  </span>
                )}
              </span>
              <span className="werewolf-player-text">
                <strong className="werewolf-player-name">{player.name}</strong>
                {(player.id === guestId || player.mayor || role) && (
                  <span className="werewolf-player-notes">
                    {player.id === guestId && (
                      <span className="werewolf-tag">{t("werewolf.you")}</span>
                    )}
                    {player.mayor && (
                      <span className="werewolf-tag werewolf-mayor">
                        <Crown size={13} aria-hidden="true" />
                        {t("werewolf.mayor")}
                      </span>
                    )}
                    {role && (
                      <span className="werewolf-player-role">
                        {roleText(role, t).name}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {actions && (
                <span className="werewolf-player-actions">
                  {actions(player)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The dead of a running game, for a viewer who is not the game master, each
 * with the role the server sent, if any. Nothing while nobody died.
 */
export function DeadPlayers({
  game,
  guestId,
}: {
  game: Werewolf;
  guestId: number;
}) {
  const { t } = useI18n();
  const { dead } = playersByFate(game.players);
  if (dead.length === 0) return null;
  return (
    <PlayerList
      title={t("werewolf.dead")}
      players={dead}
      game={game}
      guestId={guestId}
    />
  );
}

/**
 * Every player, in the lobby, on the game master's board and once finished.
 * A lobby lists them in join order; a game lists the living first, then the
 * dead under their own heading, each with the role the server sent, if any.
 * The viewer's own role stays in its card until everyone may see it.
 */
export function WerewolfPlayers({
  game,
  guestId,
  actions,
}: {
  game: Werewolf;
  /** The viewer, whose own row is marked. */
  guestId: number;
  /** The game master's controls for one player. */
  actions?: (player: WerewolfPlayer) => ReactNode;
}) {
  const { t } = useI18n();
  if (game.players.length === 0)
    return <p className="werewolf-empty">{t("werewolf.noPlayers")}</p>;
  if (game.status === "lobby")
    return (
      <PlayerList
        title={t("werewolf.playersTitle")}
        players={game.players}
        game={game}
        guestId={guestId}
        actions={actions}
      />
    );
  const { alive, dead } = playersByFate(game.players);
  return (
    <>
      <PlayerList
        title={t("werewolf.alive")}
        players={alive}
        game={game}
        guestId={guestId}
        actions={actions}
      />
      {dead.length > 0 && (
        <PlayerList
          title={t("werewolf.dead")}
          players={dead}
          game={game}
          guestId={guestId}
          actions={actions}
        />
      )}
    </>
  );
}
