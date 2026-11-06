import test from "node:test";
import assert from "node:assert/strict";
import {
  eventSchema,
  voteSchema,
  type PartyEvent,
  type Vote,
} from "../src/features/programme/contracts.ts";
import {
  rankedResults,
  replaceEvent,
} from "../src/features/programme/vote-model.ts";

const vote: Vote = {
  question: "Who has the best costume?",
  status: "open",
  allowSelfVote: false,
  candidates: [
    {
      id: 1,
      name: "Alex",
      avatarUrl: "/api/guests/1/avatar?v=2",
      active: true,
    },
    { id: 2, name: "Sam", avatarUrl: null, active: true },
    { id: 3, name: "Robin", avatarUrl: null, active: false },
  ],
  myCandidateId: 2,
  canVote: true,
  participationCount: null,
  results: null,
};

const event: PartyEvent = {
  id: 10,
  type: "vote",
  revision: 1,
  title: "Costumes",
  description: "Choose your favorite costume.",
  teaser: "A vote after dinner",
  startsAt: null,
  unlockAt: null,
  locked: false,
  vote,
};

test("programme events support typed settings and redacted or administrator views of locked votes", () => {
  assert.deepEqual(eventSchema.parse(event), event);
  const ordinary = { ...event, type: "event", vote: null };
  assert.deepEqual(eventSchema.parse(ordinary), ordinary);
  const locked = { ...event, locked: true, vote: null, description: "" };
  assert.deepEqual(eventSchema.parse(locked), locked);
  const lockedAdmin = { ...event, locked: true };
  assert.deepEqual(eventSchema.parse(lockedAdmin), lockedAdmin);
  for (const invalid of [
    { ...event, type: "unknown" },
    { ...event, type: "event" },
    { ...event, revision: 0 },
    { ...event, vote: null },
    { ...event, type: undefined },
  ])
    assert.equal(eventSchema.safeParse(invalid).success, false);
});

test("votes validate candidates, portraits and private results", () => {
  assert.deepEqual(voteSchema.parse(vote), vote);
  for (const invalid of [
    { ...vote, question: "x".repeat(241) },
    { ...vote, candidates: [vote.candidates[0]] },
    { ...vote, candidates: [vote.candidates[0], vote.candidates[0]] },
    {
      ...vote,
      candidates: vote.candidates.map((candidate) => ({
        ...candidate,
        avatarUrl: "https://example.com/portrait.jpg",
      })),
    },
    { ...vote, myCandidateId: 99 },
    { ...vote, status: "closed" },
    { ...vote, results: [{ candidateId: 1, votes: 1 }] },
    { ...vote, status: "revealed", canVote: false },
  ])
    assert.equal(voteSchema.safeParse(invalid).success, false);
});

test("revealed results cover each candidate exactly once and preserve tied rankings", () => {
  const revealed = {
    ...vote,
    status: "revealed",
    canVote: false,
    results: [
      { candidateId: 1, votes: 4 },
      { candidateId: 2, votes: 4 },
      { candidateId: 3, votes: 0 },
    ],
  };
  const parsed = voteSchema.parse(revealed);
  assert.deepEqual(
    rankedResults(parsed).map(({ candidate, votes, rank }) => [
      candidate.id,
      votes,
      rank,
    ]),
    [
      [1, 4, 1],
      [2, 4, 1],
      [3, 0, 3],
    ],
  );
  for (const results of [
    [
      { candidateId: 1, votes: 4 },
      { candidateId: 1, votes: 4 },
      { candidateId: 3, votes: 0 },
    ],
    [
      { candidateId: 1, votes: 4 },
      { candidateId: 2, votes: -1 },
      { candidateId: 3, votes: 0 },
    ],
    [
      { candidateId: 1, votes: 4 },
      { candidateId: 2, votes: 1 },
      { candidateId: 9, votes: 0 },
    ],
  ])
    assert.equal(voteSchema.safeParse({ ...revealed, results }).success, false);
});

test("late ballot acknowledgements cannot reopen a vote or overwrite newer event details", () => {
  const closed = eventSchema.parse({
    ...event,
    title: "Updated costumes",
    revision: 2,
    vote: { ...vote, status: "closed", canVote: false },
  });
  const unchanged = replaceEvent([closed], event)[0];
  assert.equal(unchanged.vote?.status, "closed");
  assert.equal(unchanged.title, "Updated costumes");
  const accepted = {
    ...closed,
    vote: { ...closed.vote!, myCandidateId: 1 },
  };
  assert.equal(replaceEvent([closed], accepted)[0].vote?.myCandidateId, 1);
  assert.equal(closed.vote?.myCandidateId, 2);
  assert.deepEqual(replaceEvent([], accepted), []);
});
