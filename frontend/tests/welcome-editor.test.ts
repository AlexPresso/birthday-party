import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanRules,
  isInvalidRulesWidget,
  isInvalidTextWidget,
  isInvalidWidget,
  stepLabel,
} from "../src/features/welcome/editor-model.ts";
import type { WelcomeWidget } from "../src/features/welcome/contracts.ts";

test("welcome text validation counts characters after trimming without changing authored text", () => {
  for (const [type, limit] of [
    ["title", 120],
    ["text", 1000],
  ] as const) {
    for (const [text, invalid] of [
      ["", true],
      [" \t\n ", true],
      ["a".repeat(limit), false],
      ["a".repeat(limit + 1), true],
      ["🎂".repeat(limit), false],
      ["🎂".repeat(limit + 1), true],
      [`  ${"a".repeat(limit)}  `, false],
    ] as const) {
      const widget = Object.freeze({ type, text });
      assert.equal(isInvalidTextWidget(widget), invalid);
      assert.equal(widget.text, text);
    }
  }
});

test("welcome actions have no text requirement", () => {
  const actions: WelcomeWidget[] = [
    { type: "profile_photo" },
    { type: "enable_notifications" },
    { type: "media_upload", mediaUpload: { categoryId: null } },
    { type: "media_upload", mediaUpload: { categoryId: 3 } },
    { type: "rules", rules: [] },
  ];
  for (const widget of actions)
    assert.equal(isInvalidTextWidget(widget), false);
});

test("rules are the trimmed, nonblank lines of the host's textarea", () => {
  const lines = "  Phones stay in pockets. \n\n \t\nBe kind.\n".split("\n");
  assert.deepEqual(cleanRules(lines), ["Phones stay in pockets.", "Be kind."]);
  assert.deepEqual(cleanRules([]), []);
  assert.deepEqual(cleanRules(["", "  "]), []);
});

test("a rules widget needs 1 to 12 rules of at most 200 characters", () => {
  for (const [rules, invalid] of [
    [[], true],
    [["", "  "], true],
    [["Be kind."], false],
    [["", " Be kind. ", ""], false],
    [Array(12).fill("Be kind."), false],
    [Array(13).fill("Be kind."), true],
    [["🎂".repeat(200)], false],
    [[`  ${"a".repeat(200)}  `], false],
    [["🎂".repeat(201)], true],
    [["Be kind.", "a".repeat(201)], true],
  ] as const) {
    const widget: WelcomeWidget = { type: "rules", rules: [...rules] };
    assert.equal(isInvalidRulesWidget(widget), invalid);
    assert.equal(isInvalidWidget(widget), invalid);
  }
  assert.equal(isInvalidRulesWidget({ type: "text", text: "" }), false);
  assert.equal(isInvalidWidget({ type: "text", text: "" }), true);
  assert.equal(isInvalidWidget({ type: "profile_photo" }), false);
});

test("a step is labelled by its title, then its text, then its first rule", () => {
  const rules: WelcomeWidget = { type: "rules", rules: ["", " Be kind. "] };
  const text: WelcomeWidget = { type: "text", text: "Read this." };
  const title: WelcomeWidget = { type: "title", text: "House rules" };
  assert.equal(stepLabel({ widgets: [rules, text, title] }), "House rules");
  assert.equal(stepLabel({ widgets: [rules, text] }), "Read this.");
  assert.equal(stepLabel({ widgets: [rules] }), "Be kind.");
  assert.equal(stepLabel({ widgets: [{ type: "rules", rules: [] }] }), "");
  assert.equal(stepLabel({ widgets: [{ type: "profile_photo" }] }), "");
});
