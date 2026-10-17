import { z } from "zod";
import { id } from "../../lib/schema.ts";
import { mediaCategorySchema, uploadLimitsSchema } from "../media/contracts.ts";

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
