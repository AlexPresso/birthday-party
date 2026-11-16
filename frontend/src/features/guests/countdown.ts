/** How long until the party, in the party's own calendar days. */
export type Countdown =
  | { kind: "days"; count: number }
  | { kind: "tomorrow" }
  | { kind: "today" }
  | { kind: "started" };

function calendarDay(instant: Date, timezone: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Counts the days between now and the party's start, as its calendar has them:
 * the evening before is "tomorrow" whatever the hour. Go still decides when a
 * guest may come in; this only words the wait.
 */
export function countdown(
  startsAt: string,
  now: Date,
  timezone: string,
): Countdown {
  const start = new Date(startsAt);
  if (now >= start) return { kind: "started" };
  const days = calendarDay(start, timezone) - calendarDay(now, timezone);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  return { kind: "days", count: days };
}
