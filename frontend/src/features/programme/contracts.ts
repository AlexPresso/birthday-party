import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";

export const eventSchema = z.object({
  id,
  title: z.string(),
  description: z.string(),
  teaser: z.string(),
  startsAt: instant.nullable(),
  unlockAt: instant.nullable(),
  locked: z.boolean(),
});

export const eventsSchema = z.object({ items: z.array(eventSchema) });

export type PartyEvent = z.infer<typeof eventSchema>;
