import { expect, type APIRequestContext } from "@playwright/test";

export type WelcomeWidget =
  | { type: "title"; text: string }
  | { type: "text"; text: string }
  | { type: "profile_photo" }
  | { type: "enable_notifications" }
  | { type: "media_upload"; mediaUpload: { categoryId: number | null } };
export type WelcomeStep = { widgets: WelcomeWidget[] };
export type AdminWelcome = {
  open: boolean;
  revision: number;
  currentStep: number;
  required: boolean;
  steps: WelcomeStep[];
};

/** A step made of a title, a text and optionally one interactive widget. */
export function step(
  title: string,
  body: string,
  action: "profile_photo" | "media_upload" | null = null,
  categoryId: number | null = null,
): WelcomeStep {
  const widgets: WelcomeWidget[] = [
    { type: "title", text: title },
    { type: "text", text: body },
  ];
  if (action === "profile_photo") widgets.push({ type: action });
  if (action === "media_upload")
    widgets.push({ type: action, mediaUpload: { categoryId } });
  return { widgets };
}

function textOf(step: WelcomeStep, type: "title" | "text") {
  const widget = step.widgets.find((widget) => widget.type === type);
  if (!widget || !("text" in widget))
    throw new Error(`The step has no ${type} widget.`);
  return widget.text;
}
export const titleOf = (step: WelcomeStep) => textOf(step, "title");
export const bodyOf = (step: WelcomeStep) => textOf(step, "text");

/**
 * Host commands for the welcome sequence, each sent with the latest revision.
 * `host` is read on every call, so the controls can be created before the
 * spec's host exists.
 */
export function welcomeControls(host: () => APIRequestContext) {
  async function state(): Promise<AdminWelcome> {
    const response = await host().get("/api/admin/welcome");
    expect(response.status()).toBe(200);
    return response.json();
  }
  async function transition(
    action: "start" | "next" | "open",
  ): Promise<AdminWelcome> {
    const { revision } = await state();
    const response = await host().post("/api/admin/welcome/transition", {
      data: { revision, action },
    });
    expect(response.status()).toBe(200);
    return response.json();
  }
  async function saveSteps(steps: WelcomeStep[]): Promise<AdminWelcome> {
    const { revision } = await state();
    const response = await host().put("/api/admin/welcome", {
      data: { revision, steps },
    });
    expect(response.status()).toBe(200);
    return response.json();
  }
  async function setRequired(required: boolean): Promise<AdminWelcome> {
    const { revision } = await state();
    const response = await host().patch("/api/admin/welcome/required", {
      data: { revision, required },
    });
    expect(response.status()).toBe(200);
    return response.json();
  }
  /** Leaves the app open with the given steps, whatever a test did before. */
  async function restoreOpen(steps: WelcomeStep[], required = false) {
    if (!(await state()).open) await transition("open");
    await transition("start");
    await saveSteps(steps);
    await setRequired(required);
    await transition("open");
  }
  return { state, transition, saveSteps, setRequired, restoreOpen };
}
