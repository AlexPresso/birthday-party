import { z } from "zod";

const id = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });
export const guestSchema = z.object({
  id,
  name: z.string(),
  role: z.enum(["admin", "guest"]),
  active: z.boolean(),
});
export const sessionSchema = z.object({ guest: guestSchema });
export const partySchema = z.object({
  title: z.string(),
  timezone: z.string(),
  date: instant.nullable(),
  location: z.string(),
});
const authorSchema = z.object({ id, name: z.string() });
// Media must stay on the authenticated same-origin API, including after validation.
const mediaUrl = z
  .string()
  .regex(/^\/api\/photos\/[1-9]\d*\/image(?:\?size=thumb)?$/);
export const photoSchema = z.object({
  id,
  author: authorSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: instant,
  url: mediaUrl,
  thumbnailUrl: mediaUrl,
});
export const entrySchema = z.object({
  id,
  author: authorSchema,
  body: z.string(),
  createdAt: instant,
});
export const eventSchema = z.object({
  id,
  title: z.string(),
  description: z.string(),
  teaser: z.string(),
  startsAt: instant.nullable(),
  unlockAt: instant.nullable(),
  locked: z.boolean(),
});
export const photosSchema = z.object({
  items: z.array(photoSchema),
  nextCursor: z.string().nullable(),
});
export const entriesSchema = z.object({
  items: z.array(entrySchema),
  nextCursor: z.string().nullable(),
});
export const eventsSchema = z.object({ items: z.array(eventSchema) });
export const guestsSchema = z.object({ items: z.array(guestSchema) });
export const invitationSchema = z.object({
  invitationUrl: z.string().url(),
  expiresAt: instant,
});
export const newGuestSchema = invitationSchema.extend({ guest: guestSchema });
export const previewSchema = z.object({
  guestName: z.string(),
  expiresAt: instant,
});
export type Guest = z.infer<typeof guestSchema>;
export type Party = z.infer<typeof partySchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type PartyEvent = z.infer<typeof eventSchema>;
export type PhotoPage = z.infer<typeof photosSchema>;
export type EntryPage = z.infer<typeof entriesSchema>;

export function formatDate(
  value: string,
  timezone: string,
  time = true,
  locale = "en",
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    ...(time
      ? ({ hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const)
      : {}),
  }).format(new Date(value));
}

export function uploadProblem(file: {
  type: string;
  size: number;
}): "upload_type" | "upload_size" | "upload_empty" | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "upload_type";
  if (file.size > 15 * 1024 * 1024) return "upload_size";
  if (file.size === 0) return "upload_empty";
  return null;
}
