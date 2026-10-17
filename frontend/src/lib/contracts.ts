import { z } from "zod";

const id = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });
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
export const notificationConfigSchema = z.object({
  publicKey: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
});
export const notificationStatusSchema = z.object({ subscribed: z.boolean() });
export const notificationSavedSchema = z.object({
  subscribed: z.literal(true),
});
export const mediaCategorySchema = z.object({
  id,
  name: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= 80),
  isPublic: z.boolean(),
});
export const mediaCategoriesSchema = z.object({
  items: z.array(mediaCategorySchema).max(100),
});
export type MediaCategory = z.infer<typeof mediaCategorySchema>;
const uploadLimitsSchema = z.object({
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
const widgetText = (limit: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length > 0 && Array.from(value).length <= limit,
    );
export const welcomeWidgetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("title"), text: widgetText(120) }),
  z.strictObject({ type: z.literal("text"), text: widgetText(1000) }),
  z.strictObject({ type: z.literal("profile_photo") }),
  z.strictObject({ type: z.literal("enable_notifications") }),
  z.strictObject({
    type: z.literal("media_upload"),
    mediaUpload: z.strictObject({ categoryId: id.nullable() }),
  }),
]);
const welcomeWidgets = z
  .array(welcomeWidgetSchema)
  .min(1)
  .max(12)
  .refine(
    (widgets) =>
      widgets.filter((widget) => widget.type === "profile_photo").length <= 1 &&
      widgets.filter((widget) => widget.type === "enable_notifications")
        .length <= 1,
  );
export const welcomeStepSchema = z.strictObject({ widgets: welcomeWidgets });
export type WelcomeWidget = z.infer<typeof welcomeWidgetSchema>;
export type WelcomeStep = z.infer<typeof welcomeStepSchema>;
const welcomeRevision = z.number().int().nonnegative();
const welcomeWidgetIndex = z.number().int().min(0).max(11);
export const welcomeUploadContextSchema = z.object({
  revision: welcomeRevision,
  widgetIndex: welcomeWidgetIndex,
  category: mediaCategorySchema.nullable(),
  limits: uploadLimitsSchema,
});
export type WelcomeUploadContext = z.infer<typeof welcomeUploadContextSchema>;
export const welcomeSchema = z
  .object({
    open: z.boolean(),
    revision: welcomeRevision,
    progressRevision: welcomeRevision,
    step: welcomeStepSchema
      .extend({ position: z.number().int().min(1).max(12) })
      .nullable(),
    canPrevious: z.boolean(),
    canNext: z.boolean(),
    canFinish: z.boolean(),
  })
  .refine(
    (value) =>
      (!value.open ||
        (value.step === null &&
          !value.canPrevious &&
          !value.canNext &&
          !value.canFinish)) &&
      (!value.canPrevious || (value.step !== null && value.step.position > 1)),
  );
export const adminWelcomeSchema = z
  .object({
    open: z.boolean(),
    revision: welcomeRevision,
    currentStep: z.number().int().min(0).max(12),
    required: z.boolean(),
    steps: z.array(welcomeStepSchema).max(12),
  })
  .refine((value) => value.currentStep <= value.steps.length);
export type Welcome = z.infer<typeof welcomeSchema>;
export type AdminWelcome = z.infer<typeof adminWelcomeSchema>;
export const partySchema = z.object({
  title: z.string(),
  timezone: z.string(),
  date: instant.nullable(),
  location: z.string(),
});
const authorSchema = z.object({ id, name: z.string(), avatarUrl });
// Media must stay on the authenticated same-origin API, including after validation.
const mediaUrl = z
  .string()
  .regex(/^\/api\/photos\/[1-9]\d*\/image(?:\?size=thumb)?$/);
export const photoSchema = z.object({
  id,
  categoryId: id.nullable(),
  author: authorSchema,
  kind: z.enum(["image", "video"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: instant,
  url: mediaUrl,
  thumbnailUrl: mediaUrl,
});
const uploadFields = {
  id,
  categoryId: id.nullable(),
  welcomeRevision: welcomeRevision.nullable(),
  welcomeWidgetIndex: welcomeWidgetIndex.nullable(),
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
  items: z.array(uploadSchema).max(150),
});
const entryFields = {
  id,
  canDelete: z.boolean(),
  body: z.string(),
  createdAt: instant,
};
export const entrySchema = z.discriminatedUnion("anonymous", [
  z.object({
    ...entryFields,
    anonymous: z.literal(false),
    author: authorSchema,
  }),
  z.object({ ...entryFields, anonymous: z.literal(true), author: z.null() }),
]);
export const eventSchema = z.object({
  id,
  title: z.string(),
  description: z.string(),
  teaser: z.string(),
  startsAt: instant.nullable(),
  unlockAt: instant.nullable(),
  locked: z.boolean(),
});
export const photosSchema = z.object({
  items: z.array(photoSchema),
  nextCursor: z.string().nullable(),
  limits: uploadLimitsSchema,
});
export const entriesSchema = z.object({
  items: z.array(entrySchema),
  nextCursor: z.string().nullable(),
});
export const eventsSchema = z.object({ items: z.array(eventSchema) });
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
export type Party = z.infer<typeof partySchema>;
export type Photo = z.infer<typeof photoSchema>;
export type UploadJob = z.infer<typeof uploadSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type PartyEvent = z.infer<typeof eventSchema>;
export type PhotoPage = z.infer<typeof photosSchema>;
export type UploadLimits = PhotoPage["limits"];
export type EntryPage = z.infer<typeof entriesSchema>;

export function formatDate(
  value: string,
  timezone: string,
  time = true,
  locale = "en",
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    ...(time ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
}

export function uploadProblem(
  file: { type: string; size: number },
  limits: UploadLimits,
): "upload_type" | "upload_size" | "upload_video_size" | "upload_empty" | null {
  const video = ["video/mp4", "video/quicktime", "video/webm"].includes(
    file.type,
  );
  if (!video && !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "upload_type";
  if (file.size > (video ? limits.videoBytes : limits.imageBytes))
    return video ? "upload_video_size" : "upload_size";
  if (file.size === 0) return "upload_empty";
  return null;
}
