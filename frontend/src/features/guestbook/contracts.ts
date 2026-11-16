import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";
import { authorSchema } from "../guests/contracts.ts";

const entryFields = {
  id,
  canDelete: z.boolean(),
  body: z.string(),
  createdAt: instant,
};

// A voice note stays on the authenticated same-origin API. Go re-encodes it
// and measures its waveform: 48 levels from 0 to 255.
export const voiceSchema = z.object({
  url: z.string().regex(/^\/api\/guestbook\/[1-9]\d*\/voice$/),
  durationMs: z.number().int().positive(),
  peaks: z.array(z.number().int().min(0).max(255)).length(48),
});

export type Voice = z.infer<typeof voiceSchema>;

export const entrySchema = z.discriminatedUnion("anonymous", [
  z.object({
    ...entryFields,
    anonymous: z.literal(false),
    author: authorSchema,
    voice: voiceSchema.nullable(),
  }),
  // A deleted guest's entries become anonymous and keep their voice note.
  z.object({
    ...entryFields,
    anonymous: z.literal(true),
    author: z.null(),
    voice: voiceSchema.nullable(),
  }),
]);

export const entriesSchema = z.object({
  items: z.array(entrySchema),
  nextCursor: z.string().nullable(),
});

export type Entry = z.infer<typeof entrySchema>;
export type EntryPage = z.infer<typeof entriesSchema>;
