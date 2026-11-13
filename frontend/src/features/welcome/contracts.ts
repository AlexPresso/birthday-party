import { z } from "zod";
import { id } from "../../lib/schema.ts";
import {
  mediaCategorySchema,
  uploadLimitsSchema,
  welcomeRevisionSchema,
  welcomeWidgetIndexSchema,
} from "../media/contracts.ts";

// The editor and Go enforce text lengths and the number of steps and widgets;
// responses only need the shape and the rules the interface depends on.
const widgetText = z.string().refine((value) => value.trim().length > 0);

const welcomeWidgetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("title"), text: widgetText }),
  z.strictObject({ type: z.literal("text"), text: widgetText }),
  z.strictObject({ type: z.literal("profile_photo") }),
  z.strictObject({ type: z.literal("enable_notifications") }),
  z.strictObject({
    type: z.literal("media_upload"),
    mediaUpload: z.strictObject({ categoryId: id.nullable() }),
  }),
  z.strictObject({
    type: z.literal("rules"),
    rules: z.array(widgetText).min(1),
  }),
]);

export type WelcomeWidget = z.infer<typeof welcomeWidgetSchema>;

/**
 * A step mounts a single profile editor and a single notification control, and
 * records one acceptance for its rules.
 */
export const singleWidgetTypes: readonly WelcomeWidget["type"][] = [
  "profile_photo",
  "enable_notifications",
  "rules",
];

const welcomeWidgets = z
  .array(welcomeWidgetSchema)
  .min(1)
  .refine((widgets) =>
    singleWidgetTypes.every(
      (type) => widgets.filter((widget) => widget.type === type).length <= 1,
    ),
  );

const welcomeStepSchema = z.strictObject({ widgets: welcomeWidgets });

export type WelcomeStep = z.infer<typeof welcomeStepSchema>;

export const welcomeUploadContextSchema = z.object({
  revision: welcomeRevisionSchema,
  widgetIndex: welcomeWidgetIndexSchema,
  category: mediaCategorySchema.nullable(),
  limits: uploadLimitsSchema,
});

export type WelcomeUploadContext = z.infer<typeof welcomeUploadContextSchema>;

export const welcomeSchema = z
  .object({
    open: z.boolean(),
    revision: welcomeRevisionSchema,
    progressRevision: welcomeRevisionSchema,
    step: welcomeStepSchema
      .extend({ position: z.number().int().positive() })
      .nullable(),
    canPrevious: z.boolean(),
    canNext: z.boolean(),
    canFinish: z.boolean(),
    // True only once this guest ticked every rule of the current step.
    rulesAccepted: z.boolean(),
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
    revision: welcomeRevisionSchema,
    currentStep: z.number().int().nonnegative(),
    required: z.boolean(),
    steps: z.array(welcomeStepSchema),
  })
  .refine((value) => value.currentStep <= value.steps.length);

export type Welcome = z.infer<typeof welcomeSchema>;

export type AdminWelcome = z.infer<typeof adminWelcomeSchema>;
