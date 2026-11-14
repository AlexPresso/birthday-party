import type { Translator } from "../../lib/i18n.ts";
import type {
  RoleCard,
  Werewolf,
  WerewolfPlayer,
  WerewolfRole,
  WerewolfRoleKey,
} from "./contracts.ts";

/** The ceilings Go enforces, repeated where a form can respect them. */
export const roleLimit = 20;
export const roleNameLength = 40;
export const roleDescriptionLength = 600;
export const quantityLimit = 60;
export const messageLength = 280;
export const minimumPlayers = 3;

/** The length Go counts: Unicode code points once trimmed. */
export function codePoints(text: string) {
  return [...text.trim()].length;
}

/**
 * A role's name and explanation as the viewer reads them. A built-in role is
 * named in the viewer's language and explained in it too, until the game
 * master rewrites the explanation; authored text shows as written.
 */
export function roleText(role: RoleCard, t: Translator) {
  if (role.key === null)
    return { name: role.name ?? "", description: role.description ?? "" };
  return {
    name: t(`werewolf.role.${role.key}`),
    description: role.description ?? t(`werewolf.roleText.${role.key}`),
  };
}

type CountForm = "one" | "other";

/** The catalogs hold a singular and a plural; every other form is plural. */
function countForm(count: number, locale: string): CountForm {
  return new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
}

function counted(
  key: "werewolf.players" | "werewolf.roles",
  count: number,
  locale: string,
  t: Translator,
) {
  return t(`${key}.${countForm(count, locale)}`, {
    count: new Intl.NumberFormat(locale).format(count),
  });
}

/** "11 players", in the viewer's language. */
export function playerCount(count: number, locale: string, t: Translator) {
  return counted("werewolf.players", count, locale, t);
}

/** How many roles the list deals, all quantities together. */
export function roleTotal(roles: readonly { count: number }[]) {
  return roles.reduce((total, role) => total + role.count, 0);
}

/**
 * "9 roles for 11 players": what the game master reads while the roles do not
 * add up to the players. Null once they match.
 */
export function countLine(
  total: number,
  players: number,
  locale: string,
  t: Translator,
) {
  if (total === players) return null;
  return t("werewolf.count", {
    roles: counted("werewolf.roles", total, locale, t),
    players: playerCount(players, locale, t),
  });
}

/** What keeps the game from starting: too few players, or roles that differ. */
export function startObstacle(
  total: number,
  players: number,
): "players" | "roles" | null {
  if (players < minimumPlayers) return "players";
  return total === players ? null : "roles";
}

/** Raises the villagers to fill the gap; unchanged when no role is missing. */
export function completeWithVillagers<
  Role extends { key: string | null; count: number },
>(roles: readonly Role[], players: number): Role[] {
  const missing = players - roleTotal(roles);
  return roles.map((role) =>
    missing > 0 && role.key === "villager"
      ? { ...role, count: role.count + missing }
      : role,
  );
}

/** The living first, then the dead, each in the order they joined. */
export function playersByFate<Player extends Pick<WerewolfPlayer, "alive">>(
  players: readonly Player[],
) {
  return {
    alive: players.filter((player) => player.alive),
    dead: players.filter((player) => !player.alive),
  };
}

/**
 * The role to show beside a player's name on the board. The server also
 * sends the viewer their own role there; while the others cannot see it, it
 * stays behind the "see my role" control instead of sitting in the list.
 */
export function boardRole(
  game: Pick<Werewolf, "status" | "hideRolesOfDead">,
  player: Pick<WerewolfPlayer, "id" | "alive" | "role">,
  viewerId: number,
) {
  const everyoneSeesIt =
    game.status === "finished" || (!player.alive && !game.hideRolesOfDead);
  return player.id === viewerId && !everyoneSeesIt ? null : player.role;
}

/**
 * A row of the game master's role editor. `rowKey` identifies the row across
 * saves, so a custom role keeps its fields mounted when it receives its id.
 */
export type RoleDraft = {
  rowKey: string;
  id: number | null;
  key: WerewolfRoleKey | null;
  /** The typed name of a custom role; unused for a built-in one. */
  name: string;
  /** Null while a built-in role keeps its translated explanation. */
  description: string | null;
  count: number;
};

/** A role of the `PUT …/werewolf/roles` request. */
export type RoleInput = {
  id?: number;
  key: WerewolfRoleKey | null;
  name: string | null;
  description: string | null;
  count: number;
};

/** The saved roles as editor rows; `rowKeys` keeps the rows already shown. */
export function roleDrafts(
  roles: readonly WerewolfRole[],
  rowKeys: ReadonlyMap<number, string> = new Map(),
): RoleDraft[] {
  return roles.map((role) => ({
    rowKey: rowKeys.get(role.id) ?? `saved-${role.id}`,
    id: role.id,
    key: role.key,
    name: role.name ?? "",
    description:
      role.key === null ? (role.description ?? "") : role.description,
    count: role.count,
  }));
}

/**
 * The roles to send. A built-in explanation left empty, or typed back to the
 * translated text, returns to the translation for every language.
 */
export function roleInputs(
  drafts: readonly RoleDraft[],
  t: Translator,
): RoleInput[] {
  return drafts.map((draft) => {
    const description = (draft.description ?? "").trim();
    const identity = draft.id === null ? {} : { id: draft.id };
    if (draft.key === null)
      return {
        ...identity,
        key: null,
        name: draft.name.trim(),
        description,
        count: draft.count,
      };
    const original = t(`werewolf.roleText.${draft.key}`);
    return {
      ...identity,
      key: draft.key,
      name: null,
      description:
        description === "" || description === original ? null : description,
      count: draft.count,
    };
  });
}

export function sameRoleInputs(a: RoleInput[], b: RoleInput[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The first custom role without a name: the list is not sent while one is. */
export function unnamedRole(drafts: readonly RoleDraft[]) {
  return drafts.find((draft) => draft.key === null && !draft.name.trim());
}

function sameFields(a: RoleDraft, b: RoleDraft) {
  return (
    a.name === b.name && a.description === b.description && a.count === b.count
  );
}

/**
 * Applies a completed save to the editor. The saved list answers the submitted
 * one row for row. A row the game master changed during the request keeps its
 * newer values and takes the saved id; the others take what the server stored.
 */
export function mergeSavedRoles(
  current: readonly RoleDraft[],
  submitted: readonly RoleDraft[],
  saved: readonly WerewolfRole[],
): RoleDraft[] {
  return current.map((row) => {
    const index = submitted.findIndex((sent) => sent.rowKey === row.rowKey);
    const role = saved[index];
    if (!role) return row;
    const [stored] = roleDrafts([role], new Map([[role.id, row.rowKey]]));
    return sameFields(row, submitted[index]) ? stored : { ...row, id: role.id };
  });
}
