import test from "node:test";
import assert from "node:assert/strict";
import type { Welcome } from "../src/features/welcome/contracts.ts";
import { latestWelcome } from "../src/features/welcome/welcome-state.ts";

const waiting: Welcome = {
  open: false,
  revision: 3,
  progressRevision: 10,
  step: null,
  canPrevious: false,
  canNext: false,
  canFinish: false,
  rulesAccepted: false,
};

test("welcome updates unlock controls without replacing identical state", () => {
  assert.equal(latestWelcome(null, waiting), waiting);
  assert.equal(latestWelcome(waiting, { ...waiting }), waiting);
  const unlocked = { ...waiting, revision: 4, canNext: true };
  assert.equal(latestWelcome(waiting, unlocked), unlocked);
  assert.equal(latestWelcome(unlocked, waiting), unlocked);
});

test("a guest navigation response takes precedence over an older concurrent read", () => {
  const unlocked = { ...waiting, revision: 5, canNext: true };
  const moved: Welcome = {
    ...waiting,
    revision: 4,
    progressRevision: 11,
    step: { position: 1, widgets: [{ type: "text", text: "Take a seat." }] },
  };
  assert.equal(latestWelcome(unlocked, moved), moved);
  assert.equal(latestWelcome(moved, unlocked), moved);
  const fresh = { ...moved, revision: 5, canNext: true };
  assert.equal(latestWelcome(moved, fresh), fresh);
});

test("accepting or withdrawing the rules replaces a view with the same revisions", () => {
  const pending: Welcome = {
    ...waiting,
    step: { position: 1, widgets: [{ type: "rules", rules: ["Be kind."] }] },
  };
  const accepted = { ...pending, rulesAccepted: true, canNext: true };
  assert.equal(latestWelcome(pending, accepted), accepted);
  assert.equal(latestWelcome(accepted, { ...accepted }), accepted);
  assert.equal(latestWelcome(accepted, pending), pending);
  // A read from before a host unlock stays older, whatever it says.
  const unlocked = { ...accepted, revision: 4 };
  assert.equal(latestWelcome(unlocked, pending), unlocked);
});

test("finished and restarted guest progress cannot be replaced by stale views", () => {
  const finished = { ...waiting, open: true, progressRevision: 12 };
  assert.equal(latestWelcome(waiting, finished), finished);
  assert.equal(latestWelcome(finished, waiting), finished);
  const restarted = { ...waiting, revision: 7, progressRevision: 13 };
  assert.equal(latestWelcome(finished, restarted), restarted);
  assert.equal(latestWelcome(restarted, finished), restarted);
});
