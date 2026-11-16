import { z } from "zod";
import { id, instant } from "../../lib/schema.ts";

const avatarUrl = z
  .string()
  .regex(/^\/api\/guests\/[1-9]\d*\/avatar\?v=[1-9]\d*$/)
  .nullable();

export const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/);

export const guestSchema = z.object({
  id,
  name: z.string(),
  role: z.enum(["admin", "guest"]),
  active: z.boolean(),
  avatarUrl,
  // Only the host's guest list carries a number, in international form.
  phone: phoneSchema.optional(),
  // Also only in that list: whether the guest ever opened an invitation.
  joined: z.boolean().optional(),
});

export const sessionSchema = z.object({ guest: guestSchema });

export const authorSchema = z.object({ id, name: z.string(), avatarUrl });

export const guestsSchema = z.object({ items: z.array(guestSchema) });

export const invitationSchema = z.object({
  invitationUrl: z.string().url(),
  expiresAt: instant,
});

export type Invitation = z.infer<typeof invitationSchema>;

export const newGuestSchema = invitationSchema.extend({ guest: guestSchema });

// A changed number of a guest with access comes back with its new link.
export const guestUpdateSchema = z.object({
  guest: guestSchema,
  invitation: invitationSchema.nullable(),
});

export type Guest = z.infer<typeof guestSchema>;
