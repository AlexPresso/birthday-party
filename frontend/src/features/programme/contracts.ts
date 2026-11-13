import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";
import { authorSchema } from "../guests/contracts.ts";

// Responses are checked for their shape and for the invariants the interface
// relies on. Length and count ceilings stay with Go and the forms, so raising
// a backend limit cannot blank a page.
export const voteSchema = z
  .object({
    question: z.string().min(1),
    status: z.enum(["draft", "open", "closed", "revealed"]),
    allowSelfVote: z.boolean(),
    candidates: z.array(authorSchema.extend({ active: z.boolean() })).min(2),
    myCandidateId: id.nullable(),
    canVote: z.boolean(),
    participationCount: z.number().int().nonnegative().nullable(),
    results: z
      .array(
        z.object({ candidateId: id, votes: z.number().int().nonnegative() }),
      )
      .nullable(),
  })
  .superRefine((vote, ctx) => {
    const ids = new Set(vote.candidates.map((candidate) => candidate.id));
    if (
      ids.size !== vote.candidates.length ||
      (vote.myCandidateId !== null && !ids.has(vote.myCandidateId))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Vote candidates must be distinct and contain the saved choice",
      });
    }
    if (vote.canVote && vote.status !== "open") {
      ctx.addIssue({
        code: "custom",
        message: "Only an open vote accepts ballots",
      });
    }
    if ((vote.status === "revealed") !== (vote.results !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Results are available only after revelation",
      });
    }
    if (
      vote.results &&
      (vote.results.length !== ids.size ||
        new Set(vote.results.map((result) => result.candidateId)).size !==
          ids.size ||
        vote.results.some((result) => !ids.has(result.candidateId)))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Results must cover each candidate once",
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
