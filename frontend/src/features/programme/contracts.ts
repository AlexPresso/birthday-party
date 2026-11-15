import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";
import { authorSchema } from "../guests/contracts.ts";

// Responses are checked for their shape and for the invariants the interface
// relies on. Length and count ceilings stay with Go and the forms, so raising
// a backend limit cannot blank a page.
const voteOptionSchema = z.object({
  id,
  label: z.string().min(1),
  /** The guest this option stands for; a custom choice has none. */
  guestId: id.nullable(),
  avatarUrl: authorSchema.shape.avatarUrl,
  /** False once the guest behind the option has lost access. */
  active: z.boolean(),
  /** Added by a guest while the vote was open. */
  writeIn: z.boolean(),
  votes: z.number().int().nonnegative(),
});

export const voteSchema = z
  .object({
    question: z.string().min(1),
    status: z.enum(["draft", "open", "closed"]),
    choices: z.enum(["guests", "custom"]),
    allowSelfVote: z.boolean(),
    allowWriteIns: z.boolean(),
    /** In the server's order: most votes first. */
    options: z.array(voteOptionSchema),
    myOptionId: id.nullable(),
    canVote: z.boolean(),
  })
  .superRefine((vote, ctx) => {
    const ids = new Set(vote.options.map((option) => option.id));
    if (
      ids.size !== vote.options.length ||
      (vote.myOptionId !== null && !ids.has(vote.myOptionId))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Vote options must be distinct and contain the saved choice",
      });
    }
    const forGuests = vote.choices === "guests";
    if (
      vote.options.some(
        (option) =>
          (option.guestId !== null) !== forGuests ||
          (option.writeIn && forGuests),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "A guest vote lists guests only and a custom vote text choices only",
      });
    }
    if (vote.canVote && vote.status !== "open") {
      ctx.addIssue({
        code: "custom",
        message: "Only an open vote accepts ballots",
      });
    }
  });

const questionSummarySchema = z.object({
  // Open from its creation; the host can only close it.
  status: z.enum(["open", "closed"]),
  // The activity page draws exactly two joker tickets.
  jokersUsed: z.number().int().min(0).max(2),
  questionCount: z.number().int().nonnegative(),
});
export const questionRoundSchema = questionSummarySchema.extend({
  revision: z.number().int().positive(),
  items: z.array(
    z.object({
      id,
      body: z.string().min(1),
      status: z.enum(["pending", "answered", "joker"]),
      votes: z.number().int().nonnegative(),
      upvoted: z.boolean(),
    }),
  ),
});
export type QuestionRound = z.infer<typeof questionRoundSchema>;

/** The built-in werewolf roles, named and explained by the message catalogs. */
export const werewolfRoleKeys = [
  "werewolf",
  "villager",
  "seer",
  "witch",
  "hunter",
  "cupid",
  "guard",
] as const;

const werewolfStatusSchema = z.enum(["lobby", "running", "finished"]);

/**
 * A built-in role has a key and is named from it; its description stays null
 * until the game master rewrites it. A custom role has no key and carries its
 * own name and description.
 */
const roleCardShape = {
  key: z.enum(werewolfRoleKeys).nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
};
const customRoleHasName = (role: { key: string | null; name: string | null }) =>
  role.key !== null || Boolean(role.name);
const roleCardSchema = z.object(roleCardShape).refine(customRoleHasName);
const werewolfRoleSchema = z
  .object({ ...roleCardShape, id, count: z.number().int().nonnegative() })
  .refine(customRoleHasName);

const ghostMessageSchema = z.object({
  from: authorSchema,
  text: z.string().min(1),
});

export const werewolfSummarySchema = z.object({
  status: werewolfStatusSchema,
  gameMaster: authorSchema.nullable(),
  /** How many guests joined. */
  players: z.number().int().nonnegative(),
});

/** A werewolf game as one viewer may see it. */
export const werewolfSchema = z
  .object({
    status: werewolfStatusSchema,
    /** Changes with every game master command. */
    revision: z.number().int().nonnegative(),
    gameMaster: authorSchema.nullable(),
    isGameMaster: z.boolean(),
    /** The viewer is a player. */
    joined: z.boolean(),
    hideRolesOfDead: z.boolean(),
    ghostMessages: z.boolean(),
    phase: z.enum(["day", "night"]),
    /** In join order. */
    players: z.array(
      authorSchema.extend({
        alive: z.boolean(),
        mayor: z.boolean(),
        /** Null whenever this viewer may not see it. */
        role: roleCardSchema.nullable(),
      }),
    ),
    myRole: roleCardSchema.nullable(),
    canWriteMessage: z.boolean(),
    myMessage: z.string().nullable(),
    /** Only for the current mayor, by day. */
    mayorMessage: ghostMessageSchema.nullable(),
    /** The role list and every ghost message: the game master's only. */
    roles: z.array(werewolfRoleSchema).nullable(),
    messages: z
      .array(ghostMessageSchema.extend({ delivered: z.boolean() }))
      .nullable(),
  })
  .superRefine((game, ctx) => {
    const players = new Set(game.players.map((player) => player.id));
    const roles = new Set(game.roles?.map((role) => role.id));
    if (
      players.size !== game.players.length ||
      roles.size !== (game.roles?.length ?? 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Players and roles must be distinct",
      });
    }
    if (game.isGameMaster && (game.roles === null || game.messages === null)) {
      ctx.addIssue({
        code: "custom",
        message: "The game master reads the roles and the ghost messages",
      });
    }
  });

export const eventSchema = z
  .object({
    id,
    type: z.enum(["event", "vote", "questions", "werewolf"]),
    revision: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    teaser: z.string(),
    startsAt: instant.nullable(),
    unlockAt: instant.nullable(),
    locked: z.boolean(),
    vote: voteSchema.nullable(),
    questions: questionSummarySchema.nullable().optional(),
    werewolf: werewolfSummarySchema.nullable().optional(),
  })
  .superRefine((event, ctx) => {
    if (event.type !== "vote" && event.vote !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Only vote events contain voting details",
      });
    }
    if (
      (event.questions && event.type !== "questions") ||
      (event.type === "questions" && !event.locked && !event.questions)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Only question events contain a question round; unlocked rounds require details",
      });
    }
    if (
      (event.werewolf && event.type !== "werewolf") ||
      (event.type === "werewolf" && !event.locked && !event.werewolf)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Only werewolf events contain a game; unlocked games require details",
      });
    }
    if (event.type === "vote" && !event.locked && event.vote === null) {
      ctx.addIssue({
        code: "custom",
        message: "An unlocked vote event requires voting details",
      });
    }
  });

export const eventsSchema = z.object({ items: z.array(eventSchema) });

/** Whether guests are notified of event starts and revealed surprises. */
export const programmeNotificationsSchema = z.object({ enabled: z.boolean() });

export type PartyEvent = z.infer<typeof eventSchema>;
export type Vote = z.infer<typeof voteSchema>;
export type VoteOption = Vote["options"][number];
/** A vote event whose voting details the viewer may read. */
export type VoteEvent = PartyEvent & { vote: Vote };
export type Werewolf = z.infer<typeof werewolfSchema>;
export type WerewolfSummary = z.infer<typeof werewolfSummarySchema>;
export type WerewolfPlayer = Werewolf["players"][number];
export type WerewolfRole = NonNullable<Werewolf["roles"]>[number];
export type RoleCard = NonNullable<Werewolf["myRole"]>;
export type WerewolfRoleKey = (typeof werewolfRoleKeys)[number];
