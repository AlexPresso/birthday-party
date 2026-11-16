import { z } from "zod";
import { instant } from "../../lib/schema.ts";

// A map of the location, opened in the guest's own map app.
export const mapUrlSchema = z.union([
  z.literal(""),
  z.string().regex(/^https:\/\/\S+$/),
]);

export const partySchema = z.object({
  title: z.string(),
  timezone: z.string(),
  date: instant.nullable(),
  location: z.string(),
  // A map of the location, opened in the guest's own map app.
  mapUrl: mapUrlSchema,
});

export type Party = z.infer<typeof partySchema>;

const invitationCopySchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
});

export const appearanceSchema = z.object({
  theme: z.enum(["dark", "light"]),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export type Appearance = z.infer<typeof appearanceSchema>;

export const publicConfigurationSchema = z.object({
  age: z.number().int().min(1).max(150),
  invitation: invitationCopySchema.extend({
    locales: z.object({
      en: invitationCopySchema,
      fr: invitationCopySchema,
      de: invitationCopySchema,
      it: invitationCopySchema,
      es: invitationCopySchema,
    }),
  }),
  appearance: appearanceSchema,
});

export const configurationSchema = publicConfigurationSchema.extend({
  imageSizeMB: z.number().int().min(1).max(1024),
  videoSizeMB: z.number().int().min(1).max(1024),
  // The host's WhatsApp invitation text; null uses the interface's message.
  whatsappMessage: z.string().nullable(),
  // Greets guests waiting for the welcome; null keeps the interface's line.
  waitingMessage: z.string().nullable(),
});

export type PublicConfiguration = z.infer<typeof publicConfigurationSchema>;
export type Configuration = z.infer<typeof configurationSchema>;

// What a signed-in guest learns before entering: whether Go lets them in yet,
// the host's message (null for none) and when and where the party is.
export const partyStartSchema = z.object({
  started: z.boolean(),
  message: z.string().nullable(),
  date: instant.nullable(),
  timezone: z.string(),
  location: z.string(),
  mapUrl: mapUrlSchema,
});

export type PartyStart = z.infer<typeof partyStartSchema>;
