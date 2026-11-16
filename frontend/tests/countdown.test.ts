import test from "node:test";
import assert from "node:assert/strict";
import { countdown } from "../src/features/guests/countdown.ts";

const startsAt = "2027-06-05T16:30:00Z"; // 18:30 in Zurich

test("the wait counts the party's calendar days, not 24-hour periods", () => {
  const zurich = "Europe/Zurich";
  assert.deepEqual(
    countdown(startsAt, new Date("2027-05-24T21:00:00Z"), zurich),
    {
      kind: "days",
      count: 12,
    },
  );
  // Any hour of the day before is "tomorrow".
  assert.deepEqual(
    countdown(startsAt, new Date("2027-06-04T08:00:00Z"), zurich),
    { kind: "tomorrow" },
  );
  assert.deepEqual(
    countdown(startsAt, new Date("2027-06-04T22:30:00Z"), zurich),
    { kind: "today" },
  );
  assert.deepEqual(
    countdown(startsAt, new Date("2027-06-05T16:30:00Z"), zurich),
    { kind: "started" },
  );
});

test("the party's timezone decides which day it is", () => {
  // 01:00 on June 5 in Zurich is still June 4 in New York.
  const now = new Date("2027-06-04T23:00:00Z");
  assert.equal(countdown(startsAt, now, "Europe/Zurich").kind, "today");
  assert.equal(countdown(startsAt, now, "America/New_York").kind, "tomorrow");
});
