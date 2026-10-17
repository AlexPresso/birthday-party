import { z } from "zod";
import { instant } from "../../lib/schema.ts";

export const partySchema = z.object({
  title: z.string(),
  timezone: z.string(),
  date: instant.nullable(),
  location: z.string(),
});

export type Party = z.infer<typeof partySchema>;
