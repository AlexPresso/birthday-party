import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  activate,
  mutationHeaders,
  newClient,
  type Guest,
  type Invitation,
} from "./party";

export type VoteOption = {
  id: number;
  label: string;
  guestId: number | null;
  avatarUrl: string | null;
  active: boolean;
  writeIn: boolean;
  votes: number;
};
export type Vote = {
  question: string;
  status: "draft" | "open" | "closed";
  choices: "guests" | "custom";
  allowSelfVote: boolean;
  allowWriteIns: boolean;
  options: VoteOption[];
  myOptionId: number | null;
  canVote: boolean;
};
export type ProgrammeEvent = {
  id: number;
  type: "event" | "vote";
  revision: number;
  title: string;
  description: string;
  teaser: string;
  startsAt: string | null;
  unlockAt: string | null;
  locked: boolean;
  vote: Vote | null;
};

/** Where a vote's options come from, with the rule of that source. */
export type VoteSource =
  | { candidates: Guest[]; allowSelfVote?: boolean }
  | { labels: string[]; allowWriteIns?: boolean };

/** The `vote` settings of a create or update request. */
export function voteSettings(question: string, source: VoteSource) {
  return "candidates" in source
    ? {
        question,
        choices: "guests",
        candidateIds: source.candidates.map((guest) => guest.id),
        allowSelfVote: source.allowSelfVote ?? false,
        allowWriteIns: false,
      }
    : {
        question,
        choices: "custom",
        labels: source.labels,
        allowSelfVote: false,
        allowWriteIns: source.allowWriteIns ?? false,
      };
}

/** The programme as `client` reads it; the host's list includes drafts. */
export async function programme(
  client: APIRequestContext,
  asHost = false,
): Promise<ProgrammeEvent[]> {
  const response = await client.get(
    asHost ? "/api/admin/programme" : "/api/programme",
  );
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}

export async function eventFrom(
  client: APIRequestContext,
  id: number,
  asHost = false,
) {
  const event = (await programme(client, asHost)).find(
    (item) => item.id === id,
  );
  if (!event) throw new Error(`Programme event ${id} was not returned.`);
  return event;
}

export async function voteFrom(
  client: APIRequestContext,
  id: number,
  asHost = false,
) {
  const { vote } = await eventFrom(client, id, asHost);
  if (!vote) throw new Error(`Programme event ${id} has no visible vote.`);
  return vote;
}

/** The option with this label, compared as the server does. */
export function optionOf(vote: Vote, label: string) {
  const option = vote.options.find(
    (item) => item.label.toLowerCase() === label.trim().toLowerCase(),
  );
  if (!option) throw new Error(`The vote has no option “${label}”.`);
  return option;
}

/** Has the host create a draft vote event. */
export async function createVote(
  host: APIRequestContext,
  input: {
    title: string;
    question: string;
    source: VoteSource;
    unlockAt?: string | null;
  },
): Promise<ProgrammeEvent> {
  const response = await host.post("/api/admin/programme", {
    data: {
      type: "vote",
      title: input.title,
      description: "Choisis ce qui t’a le plus fait sourire ce soir.",
      teaser: "Un vote se prépare",
      startsAt: null,
      unlockAt: input.unlockAt ?? null,
      vote: voteSettings(input.question, input.source),
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

/** Has the host move a vote to its next state with the latest revision. */
export async function setVoteStatus(
  host: APIRequestContext,
  eventID: number,
  status: "open" | "closed",
) {
  const event = await eventFrom(host, eventID, true);
  const response = await host.post(
    `/api/admin/programme/${eventID}/vote/state`,
    { data: { status, revision: event.revision } },
  );
  expect(response.status()).toBe(200);
}

/** Sends a ballot for an existing option; the caller checks the response. */
export function castVote(
  client: APIRequestContext,
  eventID: number,
  optionId: number,
) {
  return client.put(`/api/programme/${eventID}/vote`, {
    headers: mutationHeaders,
    data: { optionId },
  });
}

/** Votes for a typed choice, creating its option when nobody has yet. */
export function castWriteIn(
  client: APIRequestContext,
  eventID: number,
  label: string,
) {
  return client.post(`/api/programme/${eventID}/vote/options`, {
    headers: mutationHeaders,
    data: { label },
  });
}

/**
 * Gives a guest a synthetic portrait, so screenshots stay recognizable
 * without using anyone's photo, and returns its avatar URL.
 */
export async function addAvatar(page: Page, invitation: Invitation) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#80748c";
    drawing.fillRect(0, 0, 256, 256);
    drawing.fillStyle = "#3b3043";
    drawing.beginPath();
    drawing.ellipse(128, 256, 90, 96, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#edc3a4";
    drawing.beginPath();
    drawing.ellipse(128, 104, 48, 57, 0, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#45362f";
    drawing.beginPath();
    drawing.ellipse(123, 66, 51, 26, -0.2, 0, Math.PI * 2);
    drawing.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const client = await newClient();
  try {
    await activate(client, invitation.invitationUrl);
    const response = await client.put("/api/profile/avatar", {
      multipart: {
        file: {
          name: "candidate.png",
          mimeType: "image/png",
          buffer: Buffer.from(image, "base64"),
        },
      },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).guest.avatarUrl as string;
  } finally {
    await client.dispose();
  }
}
