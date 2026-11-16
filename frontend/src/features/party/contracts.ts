import { z } from "zod";
import { instant } from "../../lib/schema.ts";

export const partySchema = z.object({
  title: z.string(),
  timezone: z.string(),
  date: instant.nullable(),
  location: z.string(),
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
});

export type PublicConfiguration = z.infer<typeof publicConfigurationSchema>;
export type Configuration = z.infer<typeof configurationSchema>;
