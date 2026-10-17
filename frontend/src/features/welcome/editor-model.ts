import type { WelcomeStep, WelcomeWidget } from "./contracts.ts";

export type WidgetDraft = WelcomeWidget & { key: number };

export type StepDraft = { key: number; widgets: WidgetDraft[] };

export function stepLabel(step: WelcomeStep | StepDraft) {
  const title = step.widgets.find(
    (widget) => widget.type === "title" && widget.text.trim(),
  );
  if (title?.type === "title") return title.text;
  const text = step.widgets.find(
    (widget) => widget.type === "text" && widget.text.trim(),
  );
  return text?.type === "text" ? text.text : "";
}
