import { z } from "zod";
import { imageMimeTypes, videoMimeTypes } from "../../lib/media-types.ts";
import { id, instant } from "../../lib/schema.ts";
import { authorSchema } from "../guests/contracts.ts";

export const mediaCategorySchema = z.object({
  id,
  name: z.string().min(1),
  isPublic: z.boolean(),
  coverThumbnailUrl: z
    .string()
    .regex(/^\/api\/photos\/[1-9]\d*\/image\?size=thumb$/)
    .nullable()
    .optional(),
});

export const mediaCategoriesSchema = z.object({
  items: z.array(mediaCategorySchema),
});

export type MediaCategory = z.infer<typeof mediaCategorySchema>;

export const uploadLimitsSchema = z.object({
  imageBytes: z
    .number()
    .int()
    .positive()
    .max(1024 ** 3),
  videoBytes: z
    .number()
    .int()
    .positive()
    .max(1024 ** 3),
});

// Media must stay on the authenticated same-origin API, including after validation.
const mediaUrl = z
  .string()
  .regex(/^\/api\/photos\/[1-9]\d*\/image(?:\?size=thumb)?$/);

export const photoSchema = z.object({
  id,
  categoryId: id.nullable(),
  author: authorSchema,
  kind: z.enum(["image", "video"]),
  // Go labels a stored Matroska container as such; browsers never offer it.
  mimeType: z.enum([...imageMimeTypes, ...videoMimeTypes, "video/x-matroska"]),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: instant,
  url: mediaUrl,
  thumbnailUrl: mediaUrl,
});

export const welcomeRevisionSchema = z.number().int().nonnegative();

export const welcomeWidgetIndexSchema = z.number().int().nonnegative();

const uploadFields = {
  id,
  categoryId: id.nullable(),
  welcomeRevision: welcomeRevisionSchema.nullable(),
  welcomeWidgetIndex: welcomeWidgetIndexSchema.nullable(),
  clientUploadId: z.uuid(),
  filename: z.string().min(1),
  kind: z.enum(["image", "video"]),
  createdAt: instant,
};

export const uploadSchema = z
  .discriminatedUnion("status", [
    z.object({
      ...uploadFields,
      status: z.enum(["queued", "processing"]),
      errorCode: z.null(),
      photo: z.null(),
    }),
    z.object({
      ...uploadFields,
      status: z.literal("ready"),
      errorCode: z.null(),
      photo: photoSchema.nullable(),
    }),
    z.object({
      ...uploadFields,
      status: z.literal("failed"),
      errorCode: z.string().regex(/^[a-z_]+$/),
      photo: z.null(),
    }),
  ])
  .refine(
    (job) => job.welcomeWidgetIndex === null || job.welcomeRevision !== null,
  );

export const uploadsSchema = z.object({
  items: z.array(uploadSchema),
});

export const photosSchema = z.object({
  items: z.array(photoSchema),
  nextCursor: z.string().nullable(),
  limits: uploadLimitsSchema,
});

export type Photo = z.infer<typeof photoSchema>;

export type UploadJob = z.infer<typeof uploadSchema>;

export type PhotoPage = z.infer<typeof photosSchema>;

export type UploadLimits = PhotoPage["limits"];
