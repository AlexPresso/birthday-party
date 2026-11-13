export function formatDate(
  value: string,
  timezone: string,
  time: boolean,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    ...(time ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
}

// Date inputs are explicitly in the organizer's browser timezone. Submitted
// instants always use UTC; guests see them in the party's configured timezone.
export function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function utcInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export const browserZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
