import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { mutationHeaders } from "./party";

export type Person = { id: number; name: string; avatarUrl: string | null };
export type RoleCard = {
  key: string | null;
  name: string | null;
  description: string | null;
};
export type Player = Person & {
  alive: boolean;
  mayor: boolean;
  role: RoleCard | null;
};
export type Role = RoleCard & { id: number; count: number };
/** A werewolf game as one viewer's API response describes it. */
export type Werewolf = {
  status: "lobby" | "running" | "finished";
  revision: number;
  gameMaster: Person | null;
  isGameMaster: boolean;
  joined: boolean;
  hideRolesOfDead: boolean;
  ghostMessages: boolean;
  phase: "day" | "night";
  players: Player[];
  myRole: RoleCard | null;
  canWriteMessage: boolean;
  myMessage: string | null;
  mayorMessage: { from: Person; text: string } | null;
  roles: Role[] | null;
  messages: { from: Person; text: string; delivered: boolean }[] | null;
};
export type WerewolfEvent = {
  id: number;
  type: "werewolf";
  revision: number;
  title: string;
  werewolf: {
    status: Werewolf["status"];
    gameMaster: Person | null;
    players: number;
  } | null;
};

/** The built-in roles as the French interface names them. */
const frenchRoles: Record<string, string> = {
  werewolf: "Loup-garou",
  villager: "Villageois",
  seer: "Voyante",
  witch: "Sorcière",
  hunter: "Chasseur",
  cupid: "Cupidon",
  guard: "Garde",
};

/** A role's name as a French-speaking viewer reads it. */
export function roleName(role: RoleCard) {
  const name = role.key === null ? role.name : frenchRoles[role.key];
  if (!name) throw new Error(`Unknown role ${JSON.stringify(role)}.`);
  return name;
}

function gamePath(eventID: number, path = "") {
  return `/api/programme/${eventID}/werewolf${path}`;
}

/** Has the host create a werewolf event, with or without a game master. */
export async function createWerewolf(
  host: APIRequestContext,
  input: { title: string; gameMasterId: number | null },
): Promise<WerewolfEvent> {
  const response = await host.post("/api/admin/programme", {
    data: {
      type: "werewolf",
      title: input.title,
      description: "",
      teaser: "",
      startsAt: null,
      unlockAt: null,
      vote: null,
      werewolf: { gameMasterId: input.gameMasterId },
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

/** Has the host change the game master of a werewolf event. */
export async function setGameMaster(
  host: APIRequestContext,
  event: WerewolfEvent,
  gameMasterId: number | null,
) {
  return host.put(`/api/admin/programme/${event.id}`, {
    data: {
      type: "werewolf",
      title: event.title,
      description: "",
      teaser: "",
      startsAt: null,
      unlockAt: null,
      vote: null,
      werewolf: { gameMasterId },
    },
  });
}

/** The game as `client` may see it. */
export async function gameFrom(
  client: APIRequestContext,
  eventID: number,
): Promise<Werewolf> {
  const response = await client.get(gamePath(eventID));
  expect(response.status()).toBe(200);
  return response.json();
}

/** Sends a game command as `client`; the caller checks the response. */
export function sendToGame(
  client: APIRequestContext,
  eventID: number,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  data?: object,
) {
  return client.fetch(gamePath(eventID, path), {
    method,
    headers: mutationHeaders,
    data,
  });
}

/** Has `client` join the lobby; the caller checks the response. */
export function joinGame(client: APIRequestContext, eventID: number) {
  return sendToGame(client, eventID, "POST", "/players", {});
}

/**
 * Gives the guest signed in as `client` a synthetic portrait, so screenshots
 * stay recognizable without using anyone's photo.
 */
export async function givePortrait(
  page: Page,
  client: APIRequestContext,
  hue: number,
) {
  const image = await page.evaluate((tone) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = `hsl(${tone} 22% 52%)`;
    drawing.fillRect(0, 0, 256, 256);
    drawing.fillStyle = `hsl(${tone} 24% 24%)`;
    drawing.beginPath();
    drawing.ellipse(128, 256, 90, 96, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#edc3a4";
    drawing.beginPath();
    drawing.ellipse(128, 104, 48, 57, 0, 0, Math.PI * 2);
    drawing.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  }, hue);
  const response = await client.put("/api/profile/avatar", {
    headers: mutationHeaders,
    multipart: {
      file: {
        name: "portrait.png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      },
    },
  });
  expect(response.status()).toBe(200);
}
