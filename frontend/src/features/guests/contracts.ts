import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";

const avatarUrl = z
  .string()
  .regex(/^\/api\/guests\/[1-9]\d*\/avatar\?v=[1-9]\d*$/)
  .nullable();

export const guestSchema = z.object({
  id,
  name: z.string(),
  role: z.enum(["admin", "guest"]),
  active: z.boolean(),
  avatarUrl,
});

export const sessionSchema = z.object({ guest: guestSchema });

export const authorSchema = z.object({ id, name: z.string(), avatarUrl });

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
