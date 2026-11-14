import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDay,
  dayHeading,
  groupByDay,
  impliedYear,
  spansSeveralDays,
} from "../src/features/programme/agenda-days.ts";

const event = (id: number, startsAt: string | null) => ({ id, startsAt });
const ids = (events: { id: number }[]) => events.map(({ id }) => id);

test("events are grouped by calendar day of the party's timezone, untimed ones last", () => {
  const events = [
    event(1, "2031-06-14T16:30:00Z"),
    event(2, null),
    event(3, "2031-06-14T20:00:00Z"),
    event(4, "2031-06-15T09:00:00Z"),
    event(5, null),
  ];
  assert.equal(spansSeveralDays(events, "Europe/Zurich"), true);
  assert.deepEqual(
    groupByDay(events, "Europe/Zurich").map((day) => [
      day.date,
      ids(day.events),
    ]),
    [
      ["2031-06-14", [1, 3]],
      ["2031-06-15", [4]],
      [null, [2, 5]],
    ],
  );
});

test("days are chronological and events keep the order received inside a day", () => {
  const events = [
    event(1, "2031-06-15T09:00:00Z"),
    event(2, "2031-06-14T20:00:00Z"),
    event(3, "2031-06-15T07:00:00Z"),
    event(4, "2030-12-31T12:00:00Z"),
  ];
  assert.deepEqual(
    groupByDay(events, "Europe/Zurich").map((day) => [
      day.date,
      ids(day.events),
    ]),
    [
      ["2030-12-31", [4]],
      ["2031-06-14", [2]],
      ["2031-06-15", [1, 3]],
    ],
  );
});

test("the party's timezone decides which day an event near midnight belongs to", () => {
  // Both instants are on 14 June in UTC and in Zurich; Auckland is 12 hours ahead.
  const events = [
    event(1, "2031-06-14T11:30:00Z"),
    event(2, "2031-06-14T12:30:00Z"),
  ];
  assert.equal(spansSeveralDays(events, "UTC"), false);
  assert.equal(spansSeveralDays(events, "Europe/Zurich"), false);
  assert.equal(spansSeveralDays(events, "Pacific/Auckland"), true);
  assert.deepEqual(
    groupByDay(events, "Pacific/Auckland").map((day) => [
      day.date,
      ids(day.events),
    ]),
    [
      ["2031-06-14", [1]],
      ["2031-06-15", [2]],
    ],
  );
  // Los Angeles is still on the previous evening after midnight UTC.
  assert.equal(
    calendarDay("2031-06-15T03:00:00Z", "America/Los_Angeles"),
    "2031-06-14",
  );
  assert.equal(calendarDay("2031-06-15T03:00:00Z", "UTC"), "2031-06-15");
});

test("a programme spans several days only when two timed events fall on different days", () => {
  assert.equal(spansSeveralDays([], "Europe/Zurich"), false);
  assert.equal(
    spansSeveralDays([event(1, null), event(2, null)], "Europe/Zurich"),
    false,
  );
  assert.equal(
    spansSeveralDays(
      [
        event(1, "2031-06-14T08:00:00Z"),
        event(2, "2031-06-14T21:59:00Z"),
        event(3, null),
      ],
      "Europe/Zurich",
    ),
    false,
  );
  assert.equal(
    spansSeveralDays(
      [event(1, "2031-06-14T21:59:00Z"), event(2, "2031-06-14T22:00:00Z")],
      "Europe/Zurich",
    ),
    true,
  );
});

test("day headings give the date in words, capitalized, in each language", () => {
  for (const [locale, expected] of [
    ["fr", "Samedi 14 juin"],
    ["en", "Saturday, June 14"],
    ["de", "Samstag, 14. Juni"],
    ["it", "Sabato 14 giugno"],
    ["es", "Sábado, 14 de junio"],
  ] as const) {
    assert.equal(dayHeading("2031-06-14", locale, "2031"), expected);
  }
});

test("a day heading names its year only outside the party's year", () => {
  assert.equal(dayHeading("2032-01-01", "fr", "2031"), "Jeudi 1 janvier 2032");
  assert.equal(dayHeading("2031-12-31", "fr", "2031"), "Mercredi 31 décembre");
  // The party's year is read in its own timezone.
  assert.equal(impliedYear("2031-12-31T12:00:00Z", "Pacific/Auckland"), "2032");
  assert.equal(impliedYear("2031-12-31T12:00:00Z", "Europe/Zurich"), "2031");
  // Without a party date, the current year is the one left out.
  assert.equal(
    impliedYear(null, "Europe/Zurich", new Date("2029-03-01T00:00:00Z")),
    "2029",
  );
});
