import test from "node:test";
import assert from "node:assert/strict";
import { isInvalidTextWidget } from "../src/features/welcome/editor-model.ts";
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
  ];
  for (const widget of actions)
    assert.equal(isInvalidTextWidget(widget), false);
});
