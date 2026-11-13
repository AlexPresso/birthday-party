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
  status: z.enum(["draft", "open", "closed"]),
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

export const eventSchema = z
  .object({
    id,
    type: z.enum(["event", "vote", "questions"]),
    revision: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    teaser: z.string(),
    startsAt: instant.nullable(),
    unlockAt: instant.nullable(),
    locked: z.boolean(),
    vote: voteSchema.nullable(),
    questions: questionSummarySchema.nullable().optional(),
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
    if (event.type === "vote" && !event.locked && event.vote === null) {
      ctx.addIssue({
        code: "custom",
        message: "An unlocked vote event requires voting details",
      });
    }
  });

export const eventsSchema = z.object({ items: z.array(eventSchema) });

export type PartyEvent = z.infer<typeof eventSchema>;
export type Vote = z.infer<typeof voteSchema>;
export type VoteOption = Vote["options"][number];
/** A vote event whose voting details the viewer may read. */
export type VoteEvent = PartyEvent & { vote: Vote };
