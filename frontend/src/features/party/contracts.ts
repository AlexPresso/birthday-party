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
});

export const configurationSchema = publicConfigurationSchema.extend({
  imageSizeMB: z.number().int().min(1).max(1024),
  videoSizeMB: z.number().int().min(1).max(1024),
});

export type PublicConfiguration = z.infer<typeof publicConfigurationSchema>;
export type Configuration = z.infer<typeof configurationSchema>;
