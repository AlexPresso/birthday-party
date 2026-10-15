import test from "node:test";
import assert from "node:assert/strict";
import { moveItem } from "../src/lib/reorder.ts";

test("reordering retains each step and its draft without changing the original list", () => {
  const steps = Object.freeze([
    { key: 10, title: "Arrival", action: null },
    { key: 20, title: "Your photo", action: "profile_photo" },
    { key: 30, title: "Next instruction", action: null },
  ]);
  for (const [from, to, order] of [
    [0, 2, [20, 30, 10]],
    [2, 0, [30, 10, 20]],
    [1, 2, [10, 30, 20]],
    [1, 1, [10, 20, 30]],
  ] as const) {
    const moved = moveItem(steps, from, to);
    assert.deepEqual(
      moved.map((step) => step.key),
      order,
    );
    for (const step of moved) {
      assert.equal(
        step,
        steps.find((original) => original.key === step.key),
      );
    }
  }
  assert.deepEqual(
    steps.map((step) => step.key),
    [10, 20, 30],
  );
  for (const [from, to] of [
    [-1, 1],
    [1, 3],
    [0.5, 1],
    [0, NaN],
  ]) {
    assert.deepEqual(moveItem(steps, from, to), steps);
  }
  assert.deepEqual(moveItem([], 0, 1), []);
});
