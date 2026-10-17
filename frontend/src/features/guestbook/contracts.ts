import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";
import { authorSchema } from "../guests/contracts.ts";

const entryFields = {
  id,
  canDelete: z.boolean(),
  body: z.string(),
  createdAt: instant,
};

export const entrySchema = z.discriminatedUnion("anonymous", [
  z.object({
    ...entryFields,
    anonymous: z.literal(false),
    author: authorSchema,
  }),
  z.object({ ...entryFields, anonymous: z.literal(true), author: z.null() }),
]);

export const entriesSchema = z.object({
  items: z.array(entrySchema),
  nextCursor: z.string().nullable(),
});

export type Entry = z.infer<typeof entrySchema>;

export type EntryPage = z.infer<typeof entriesSchema>;
