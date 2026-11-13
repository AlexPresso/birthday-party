import type { WelcomeStep, WelcomeWidget } from "./contracts.ts";

/**
 * A widget being edited. Texts stay as typed, and a rules draft holds the
 * lines of its textarea, blank ones included, until the step is saved.
 */
export type WidgetDraft = WelcomeWidget & { key: number };

export type StepDraft = { key: number; widgets: WidgetDraft[] };

const maximumRules = 12;
const maximumRuleLength = 200;

/** The rules typed one per line: trimmed, without the blank lines. */
export function cleanRules(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

export function isInvalidTextWidget(widget: WelcomeWidget) {
  if (widget.type !== "title" && widget.type !== "text") return false;
  const text = widget.text.trim();
  const maxLength = widget.type === "title" ? 120 : 1000;
  return text.length === 0 || Array.from(text).length > maxLength;
}

export function isInvalidRulesWidget(widget: WelcomeWidget) {
  if (widget.type !== "rules") return false;
  const rules = cleanRules(widget.rules);
  return (
    rules.length === 0 ||
    rules.length > maximumRules ||
    rules.some((rule) => Array.from(rule).length > maximumRuleLength)
  );
}

export function isInvalidWidget(widget: WelcomeWidget) {
  return isInvalidTextWidget(widget) || isInvalidRulesWidget(widget);
}

export function stepLabel(step: WelcomeStep | StepDraft) {
  const title = step.widgets.find(
    (widget) => widget.type === "title" && widget.text.trim(),
  );
  if (title?.type === "title") return title.text;
  const text = step.widgets.find(
    (widget) => widget.type === "text" && widget.text.trim(),
  );
  if (text?.type === "text") return text.text;
  const rules = step.widgets.find((widget) => widget.type === "rules");
  return (rules?.type === "rules" && cleanRules(rules.rules)[0]) || "";
}
