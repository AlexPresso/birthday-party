import { z } from "zod";

export const notificationConfigSchema = z.object({
  publicKey: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
});

export const notificationStatusSchema = z.object({ subscribed: z.boolean() });

export const notificationSavedSchema = z.object({
  subscribed: z.literal(true),
});
