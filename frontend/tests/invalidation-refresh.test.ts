import test from "node:test";
import assert from "node:assert/strict";
import { createInvalidationRefresh } from "../src/lib/invalidation-refresh.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("invalidations during a read coalesce into a trailing refresh without overlap", async () => {
  const requests = [deferred(), deferred(), deferred()];
  let reads = 0;
  let active = 0;
  let maximum = 0;
  const refresh = createInvalidationRefresh(
    async () => {
      const request = requests[reads++];
      maximum = Math.max(maximum, ++active);
      await request.promise;
      active--;
    },
    (error) => assert.fail(String(error)),
  );
  const finished = refresh.request();
  void refresh.request();
  void refresh.request();
  assert.equal(reads, 1);
  requests[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  void refresh.request();
  requests[1].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    reads,
    3,
    "changes during a trailing read must also be observed",
  );
  requests[2].resolve();
  await finished;
  assert.equal(maximum, 1);
  refresh.dispose();
});

test("unmount aborts the active request and discards queued refreshes and errors", async () => {
  let reads = 0;
  let signal: AbortSignal | undefined;
  const refresh = createInvalidationRefresh(
    async (current) => {
      reads++;
      signal = current;
      await new Promise<void>((_, reject) => {
        current.addEventListener("abort", () => reject(current.reason), {
          once: true,
        });
      });
    },
    (error) => assert.fail(String(error)),
  );
  const finished = refresh.request();
  void refresh.request();
  refresh.dispose();
  await finished;
  await refresh.request();
  assert.equal(signal?.aborted, true);
  assert.equal(reads, 1);
});

test("an invalidation between completion and cleanup still triggers a fresh read", async () => {
  let reads = 0;
  const refresh = createInvalidationRefresh(
    async () => {
      reads++;
    },
    (error) => assert.fail(String(error)),
  );
  const finished = refresh.request();
  queueMicrotask(() => void refresh.request());
  await finished;
  assert.equal(reads, 2);
  refresh.dispose();
});

test("failed reads stop until a new signal or explicit retry", async () => {
  const errors: unknown[] = [];
  let reads = 0;
  const refresh = createInvalidationRefresh(
    async () => {
      if (++reads === 1) throw new Error("Request failed");
    },
    (error) => errors.push(error),
  );
  await refresh.request();
  assert.equal(reads, 1);
  assert.equal(errors.length, 1);
  await refresh.request();
  assert.equal(reads, 2);
  assert.equal(errors.length, 1);
  refresh.dispose();
});
