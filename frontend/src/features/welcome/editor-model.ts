import type { WelcomeStep, WelcomeWidget } from "./contracts.ts";

export type WidgetDraft = WelcomeWidget & { key: number };

export type StepDraft = { key: number; widgets: WidgetDraft[] };

export function isInvalidTextWidget(widget: WelcomeWidget) {
  if (widget.type !== "title" && widget.type !== "text") return false;
  const text = widget.text.trim();
  const maxLength = widget.type === "title" ? 120 : 1000;
  return text.length === 0 || Array.from(text).length > maxLength;
}

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
