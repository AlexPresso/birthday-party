"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Check, Crown, Moon, Skull, Sun, Undo2, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useConfirm } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n-context";
import type { Werewolf, WerewolfPlayer } from "./contracts";
import type { RunCommand, SendCommand } from "./use-werewolf-game";
import {
  completeWithVillagers,
  countLine,
  roleTotal,
  startObstacle,
} from "./werewolf-model";
import { WerewolfPlayers } from "./werewolf-players";
import { RoleEditor, useRoleEditor } from "./werewolf-role-editor";

/** An icon-only control of one player, named for screen readers and hover. */
function PlayerAction({
  label,
  icon,
  danger = false,
  active = false,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  /** The state the control sets is on, as for the current mayor. */
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={`icon-button${danger ? " danger" : ""}`}
      data-active={active || undefined}
      aria-label={label}
      title={label}
      onClick={onPress}
    >
      {icon}
    </button>
  );
}

type MasterProps = {
  game: Werewolf;
  guestId: number;
  /**
   * A change is being sent. Only the steps of the game wait for it; the
   * controls of a player stay enabled, so they keep the keyboard focus, and
   * their changes are sent in turn.
   */
  busy: boolean;
  command: RunCommand;
};

type Variants = Pick<Werewolf, "hideRolesOfDead" | "ghostMessages">;

/** The two variants, which the game master switches at any time. */
function VariantSwitches({
  game,
  command,
}: Pick<MasterProps, "game" | "command">) {
  const { t } = useI18n();
  const id = useId();
  // What the game master just chose, until the game answers.
  const [chosen, setChosen] = useState<Variants | null>(null);
  const shown = chosen ?? game;

  async function change(changes: Partial<Variants>) {
    const next = {
      hideRolesOfDead: shown.hideRolesOfDead,
      ghostMessages: shown.ghostMessages,
      ...changes,
    };
    setChosen(next);
    await command("/variants", "PUT", next);
    setChosen((current) => (current === next ? null : current));
  }

  return (
    <fieldset className="werewolf-section werewolf-variants">
      <legend>{t("werewolf.variants")}</legend>
      <label className="checkbox-field">
        <input
          type="checkbox"
          role="switch"
          checked={shown.hideRolesOfDead}
          onChange={(event) =>
            void change({ hideRolesOfDead: event.target.checked })
          }
        />
        {t("werewolf.hideRolesOfDead")}
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          role="switch"
          checked={shown.ghostMessages}
          aria-describedby={`${id}-ghosts`}
          onChange={(event) =>
            void change({ ghostMessages: event.target.checked })
          }
        />
        {t("werewolf.ghostMessages")}
      </label>
      <p id={`${id}-ghosts`} className="fine-print">
        {t("werewolf.ghostMessagesHint")}
      </p>
    </fieldset>
  );
}

/** The game master's lobby: the players, the roles and the start. */
export function MasterLobby({
  game,
  guestId,
  busy,
  command,
  send,
}: MasterProps & { send: SendCommand }) {
  const { t, locale } = useI18n();
  const editor = useRoleEditor(game.roles ?? [], send);
  const players = game.players.length;
  const total = roleTotal(editor.rows);
  const obstacle = startObstacle(total, players);
  const list = useRef<HTMLDivElement>(null);

  async function remove(player: WerewolfPlayer) {
    // The button leaves with its row; the list keeps the keyboard's place.
    if (await command(`/players/${player.id}`, "DELETE"))
      list.current?.focus({ preventScroll: true });
  }

  async function start() {
    // The roles on screen are the ones dealt: an unsaved list does not start.
    if (!(await editor.flush())) return;
    await command("/state", "POST", (revision) => ({
      revision,
      action: "start",
    }));
  }

  return (
    <div className="werewolf-layout">
      <div ref={list} className="werewolf-main" tabIndex={-1}>
        <WerewolfPlayers
          game={game}
          guestId={guestId}
          actions={(player) => (
            <PlayerAction
              label={t("werewolf.removePlayer", { name: player.name })}
              icon={<X size={18} aria-hidden="true" />}
              danger
              onPress={() => void remove(player)}
            />
          )}
        />
      </div>
      <div className="werewolf-side">
        <RoleEditor editor={editor} />
        <VariantSwitches game={game} command={command} />
        <div className="werewolf-start">
          <p className="werewolf-count-line" role="status">
            {countLine(total, players, locale, t) ?? ""}
          </p>
          {total < players && (
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                editor.change(completeWithVillagers(editor.rows, players), true)
              }
            >
              {t("werewolf.complete")}
            </button>
          )}
          {obstacle === "players" && (
            <p className="werewolf-start-hint">
              {t("werewolf.minimumPlayers")}
            </p>
          )}
          <button
            type="button"
            className="button primary"
            disabled={busy || obstacle !== null}
            onClick={() => void start()}
          >
            {t("werewolf.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The night's messages: who wrote what and, by day, which one was drawn. */
function NightMessages({ messages }: { messages: Werewolf["messages"] }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <section className="werewolf-section" aria-labelledby={id}>
      <div className="werewolf-list-heading">
        <h2 id={id}>{t("werewolf.messagesTitle")}</h2>
      </div>
      {!messages?.length ? (
        <p className="werewolf-empty">{t("werewolf.noMessages")}</p>
      ) : (
        <ul className="werewolf-messages">
          {messages.map((message) => (
            <li key={message.from.id} className="werewolf-message">
              <p className="werewolf-message-author">
                <Avatar
                  name={message.from.name}
                  avatarUrl={message.from.avatarUrl}
                />
                <strong>{message.from.name}</strong>
                {message.delivered && (
                  <span className="werewolf-tag werewolf-mayor">
                    <Check size={13} aria-hidden="true" />
                    {t("werewolf.delivered")}
                  </span>
                )}
              </p>
              <p className="werewolf-message-text">{message.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The game master's board: every role, the mayor, the dead and the end. */
export function MasterBoard({ game, guestId, busy, command }: MasterProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const board = useRef<HTMLDivElement>(null);
  const night = game.phase === "night";

  async function setAlive(player: WerewolfPlayer, alive: boolean) {
    if (
      !alive &&
      !(await confirm({
        message: t(
          game.hideRolesOfDead
            ? "werewolf.killSecretConfirm"
            : "werewolf.killConfirm",
          { name: player.name },
        ),
        destructive: true,
      }))
    )
      return;
    // The row changes list and its button leaves with it.
    if (await command(`/players/${player.id}`, "PUT", { alive }))
      board.current?.focus({ preventScroll: true });
  }

  async function finish() {
    if (!(await confirm({ message: t("werewolf.finishConfirm") }))) return;
    await command("/state", "POST", (revision) => ({
      revision,
      action: "finish",
    }));
  }

  return (
    <div className="werewolf-layout">
      {game.ghostMessages && (
        <div className="werewolf-phase-control">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() =>
              void command("/phase", "PUT", { phase: night ? "day" : "night" })
            }
          >
            {night ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
            {t(night ? "werewolf.toDay" : "werewolf.toNight")}
          </button>
        </div>
      )}
      <div ref={board} className="werewolf-main" tabIndex={-1}>
        <WerewolfPlayers
          game={game}
          guestId={guestId}
          actions={(player) =>
            player.alive ? (
              <>
                <PlayerAction
                  label={t(
                    player.mayor
                      ? "werewolf.removeMayor"
                      : "werewolf.makeMayor",
                    { name: player.name },
                  )}
                  icon={<Crown size={19} aria-hidden="true" />}
                  active={player.mayor}
                  onPress={() =>
                    void command("/mayor", "PUT", {
                      guestId: player.mayor ? null : player.id,
                    })
                  }
                />
                <PlayerAction
                  label={t("werewolf.kill", { name: player.name })}
                  icon={<Skull size={19} aria-hidden="true" />}
                  danger
                  onPress={() => void setAlive(player, false)}
                />
              </>
            ) : (
              <PlayerAction
                label={t("werewolf.revive", { name: player.name })}
                icon={<Undo2 size={19} aria-hidden="true" />}
                onPress={() => void setAlive(player, true)}
              />
            )
          }
        />
      </div>
      <div className="werewolf-side">
        {game.ghostMessages && <NightMessages messages={game.messages} />}
        <VariantSwitches game={game} command={command} />
        <button
          type="button"
          className="button secondary werewolf-finish"
          disabled={busy}
          onClick={() => void finish()}
        >
          {t("werewolf.finish")}
        </button>
      </div>
    </div>
  );
}
