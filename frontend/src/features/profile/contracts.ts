import { z } from "zod";
import { guestSchema } from "../guests/contracts.ts";

export const profileSchema = z.object({
  guest: guestSchema,
  limits: z.object({
    imageBytes: z
      .number()
      .int()
      .positive()
      .max(1024 ** 3),
  }),
});

export type Profile = z.infer<typeof profileSchema>;
