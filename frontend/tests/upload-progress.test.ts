import test from "node:test";
import assert from "node:assert/strict";
import { uploadProgress } from "../src/features/media/upload-progress.ts";
import type { UploadJob } from "../src/features/media/contracts.ts";
import type { Transfer } from "../src/features/media/upload-provider.tsx";

function transfer(
  clientUploadId: string,
  status: Transfer["status"],
  progress = 0,
): Transfer {
  return {
    clientUploadId,
    file: new File(["image"], "photo.jpg", { type: "image/jpeg" }),
    status,
    progress,
    retryable: true,
    categoryId: null,
    welcomeRevision: null,
    welcomeWidgetIndex: null,
  };
}

function job(
  clientUploadId: string,
  status: UploadJob["status"] = "queued",
): UploadJob {
  const shared = {
    id: 1,
    clientUploadId,
    filename: "photo.jpg",
    kind: "image" as const,
    createdAt: "2026-10-18T12:00:00Z",
    categoryId: null,
    welcomeRevision: null,
    welcomeWidgetIndex: null,
    photo: null,
  };
  return status === "failed"
    ? { ...shared, status, errorCode: "unreadable_photo" }
    : { ...shared, status, errorCode: null };
}

test("aggregate progress includes files waiting for a browser upload slot", () => {
  const uploading = transfer("sending", "uploading", 50);
  const queued = transfer("waiting", "queued");
  const result = uploadProgress([uploading, queued], [job("accepted")]);
  assert.equal(result.sent, 1);
  assert.equal(result.total, 3);
  assert.equal(result.percent, 50);
  assert.deepEqual(result.pendingTransfers, [uploading, queued]);
});

test("a job confirmed by realtime replaces its still-visible browser transfer", () => {
  const result = uploadProgress(
    [transfer("accepted", "uploading", 100), transfer("waiting", "queued")],
    [job("accepted")],
  );
  assert.equal(result.sent, 1);
  assert.equal(result.total, 2);
  assert.equal(result.percent, 50);
  assert.deepEqual(
    result.pendingTransfers.map((item) => item.clientUploadId),
    ["waiting"],
  );
});

test("sending the last byte stays below completion until server acceptance", () => {
  const jobs = Array.from({ length: 19 }, (_, index) => job(String(index)));
  const result = uploadProgress([transfer("last", "uploading", 100)], jobs);
  assert.equal(result.sent, 19);
  assert.equal(result.total, 20);
  assert.ok(result.percent > 99 && result.percent < 100);
  const accepted = uploadProgress([], [...jobs, job("last")]);
  assert.equal(accepted.sent, 20);
  assert.equal(accepted.percent, 100);
});

test("restored jobs count as sent even when preparation is pending or fails", () => {
  const result = uploadProgress(
    [],
    [
      job("queued", "queued"),
      job("processing", "processing"),
      job("ready", "ready"),
      job("failed", "failed"),
    ],
  );
  assert.equal(result.sent, 4);
  assert.equal(result.total, 4);
  assert.equal(result.percent, 100);
});

test("unaccepted browser failures contribute no completed file units", () => {
  const result = uploadProgress(
    [transfer("failed", "error", 100), transfer("retry", "queued", 75)],
    [job("accepted")],
  );
  assert.equal(result.sent, 1);
  assert.equal(result.total, 3);
  assert.equal(result.percent, (1 / 3) * 100);
});

test("an empty queue has zero progress", () => {
  assert.deepEqual(uploadProgress([], []), {
    pendingTransfers: [],
    sent: 0,
    total: 0,
    percent: 0,
  });
});
