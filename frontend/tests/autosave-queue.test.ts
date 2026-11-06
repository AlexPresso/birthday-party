import assert from "node:assert/strict";
import test from "node:test";
import { createAutosaveQueue } from "../src/lib/autosave-queue.ts";

test("autosave serializes requests and flushes the latest queued edit", async () => {
  let release!: () => void;
  let draft = "first";
  const saved: string[] = [];
  const flush = createAutosaveQueue(async () => {
    const snapshot = draft;
    if (!saved.length)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    saved.push(snapshot);
    return true;
  });
  const first = flush();
  await Promise.resolve();
  draft = "latest";
  const second = flush();
  assert.equal(second, first);
  assert.deepEqual(saved, []);
  release();
  assert.equal(await second, true);
  assert.deepEqual(saved, ["first", "latest"]);
});

test("autosave retains a flush between completion and promise cleanup", async () => {
  let draft = "first";
  const saved: string[] = [];
  const flush = createAutosaveQueue(async () => {
    saved.push(draft);
    return true;
  });
  const first = flush();
  await Promise.resolve();
  draft = "latest";
  const second = flush();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(saved, ["first", "latest"]);
});

test("autosave releases the queue after a synchronous failure", async () => {
  let attempts = 0;
  const flush = createAutosaveQueue(() => {
    if (++attempts === 1) throw new Error("Save failed.");
    return Promise.resolve(true);
  });
  await assert.rejects(flush(), /Save failed/);
  assert.equal(await flush(), true);
  assert.equal(attempts, 2);
});

test("autosave stops on failure and permits an explicit retry", async () => {
  let attempts = 0;
  const flush = createAutosaveQueue(async () => ++attempts > 1);
  assert.equal(await flush(), false);
  assert.equal(attempts, 1);
  assert.equal(await flush(), true);
  assert.equal(attempts, 2);
});
