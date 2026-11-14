type Scheduled = { startsAt: string | null };

export type AgendaDay<Item> = {
  /** The calendar day as YYYY-MM-DD; null gathers the events without a time. */
  date: string | null;
  events: Item[];
};

/** Reads the calendar day of an instant in a timezone as a sortable YYYY-MM-DD. */
function dayReader(timezone: string) {
  const format = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (value: string | Date) => {
    const parts = format.formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

export function calendarDay(value: string | Date, timezone: string) {
  return dayReader(timezone)(value);
}

/** Whether the timed events fall on at least two calendar days of the timezone. */
export function spansSeveralDays(events: Scheduled[], timezone: string) {
  const day = dayReader(timezone);
  const days = new Set<string>();
  for (const event of events) {
    if (event.startsAt) days.add(day(event.startsAt));
    if (days.size > 1) return true;
  }
  return false;
}

/**
 * Groups events by calendar day of the timezone: days in chronological order,
 * events in the order received, and those without a time in a last group.
 */
export function groupByDay<Item extends Scheduled>(
  events: Item[],
  timezone: string,
): AgendaDay<Item>[] {
  const day = dayReader(timezone);
  const days = new Map<string, Item[]>();
  const untimed: Item[] = [];
  for (const event of events) {
    if (!event.startsAt) {
      untimed.push(event);
      continue;
    }
    const date = day(event.startsAt);
    const group = days.get(date);
    if (group) group.push(event);
    else days.set(date, [event]);
  }
  const groups: AgendaDay<Item>[] = [...days.keys()]
    .sort()
    .map((date) => ({ date, events: days.get(date)! }));
  if (untimed.length > 0) groups.push({ date: null, events: untimed });
  return groups;
}

/**
 * The year a day heading leaves out: the party's, or the current one while
 * the party has no date.
 */
export function impliedYear(
  partyDate: string | null,
  timezone: string,
  now = new Date(),
) {
  return calendarDay(partyDate ?? now, timezone).slice(0, 4);
}

/** A calendar day in words, such as "Samedi 14 novembre". */
export function dayHeading(date: string, locale: string, omittedYear: string) {
  const text = new Intl.DateTimeFormat(locale, {
    // The day is already a calendar date: read it back where it was written.
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.startsWith(`${omittedYear}-`)
      ? {}
      : ({ year: "numeric" } as const)),
  }).format(new Date(`${date}T12:00:00Z`));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
