import test from "node:test";
import assert from "node:assert/strict";
import {
  photoSchema,
  photosSchema,
  uploadProblem,
  eventsSchema,
  sessionSchema,
  entrySchema,
  uploadSchema,
  uploadsSchema,
} from "../src/lib/contracts.ts";

const defaultLimits = {
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
};

test("upload responses distinguish accepted work, completed media and failed preparation", () => {
  const job = {
    id: 1,
    clientUploadId: "b4174b65-4c1c-45a8-96ee-ac2c42e87090",
    filename: "party.mp4",
    kind: "video",
    createdAt: "2026-10-15T16:00:00Z",
    status: "queued",
    errorCode: null,
    photo: null,
  };
  assert.equal(uploadSchema.safeParse(job).success, true);
  assert.equal(
    uploadSchema.safeParse({ ...job, status: "processing" }).success,
    true,
  );
  assert.equal(
    uploadSchema.safeParse({
      ...job,
      status: "failed",
      errorCode: "unreadable_video",
    }).success,
    true,
  );
  // A completed upload can outlive its deleted media record.
  assert.equal(
    uploadSchema.safeParse({ ...job, status: "ready" }).success,
    true,
  );
  for (const invalid of [
    { ...job, status: "failed" },
    { ...job, status: "ready", errorCode: "unreadable_video" },
    { ...job, status: "done" },
    { ...job, clientUploadId: null },
    { ...job, clientUploadId: "arbitrary-key" },
    { ...job, errorCode: "unreadable_video" },
    { ...job, photo: { url: "https://outside.example/private.mp4" } },
  ])
    assert.equal(uploadSchema.safeParse(invalid).success, false);
  assert.equal(
    uploadsSchema.safeParse({ items: Array(150).fill(job) }).success,
    true,
  );
  assert.equal(
    uploadsSchema.safeParse({ items: Array(151).fill(job) }).success,
    false,
  );
});

test("media responses cannot point a private gallery at an external host", () => {
  const valid = {
    id: 2,
    author: { id: 1, name: "Test guest" },
    kind: "image",
    mimeType: "image/jpeg",
    width: 40,
    height: 30,
    createdAt: "2026-10-14T16:00:00Z",
    url: "/api/photos/2/image",
    thumbnailUrl: "/api/photos/2/image?size=thumb",
  };
  assert.equal(photoSchema.safeParse(valid).success, true);
  assert.equal(
    photoSchema.safeParse({
      ...valid,
      url: "https://outside.example/private.jpg",
    }).success,
    false,
  );
  assert.equal(
    photoSchema.safeParse({ ...valid, thumbnailUrl: "//outside.example/image" })
      .success,
    false,
  );
  assert.equal(photoSchema.safeParse({ ...valid, width: 0 }).success, false);
});

test("client rejects unsupported, oversized and empty selections before upload", () => {
  assert.equal(
    uploadProblem(
      { type: "image/jpeg", size: 15 * 1024 * 1024 },
      defaultLimits,
    ),
    null,
  );
  assert.equal(
    uploadProblem(
      { type: "image/jpeg", size: 15 * 1024 * 1024 + 1 },
      defaultLimits,
    ),
    "upload_size",
  );
  assert.equal(
    uploadProblem({ type: "image/heic", size: 1 }, defaultLimits),
    "upload_type",
  );
  assert.equal(
    uploadProblem({ type: "image/png", size: 0 }, defaultLimits),
    "upload_empty",
  );
  for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
    assert.equal(
      uploadProblem({ type, size: 100 * 1024 * 1024 }, defaultLimits),
      null,
    );
    assert.equal(
      uploadProblem({ type, size: 100 * 1024 * 1024 + 1 }, defaultLimits),
      "upload_video_size",
    );
    assert.equal(
      uploadProblem({ type, size: 0 }, defaultLimits),
      "upload_empty",
    );
  }
  assert.equal(
    uploadProblem({ type: "video/x-msvideo", size: 1 }, defaultLimits),
    "upload_type",
  );
});

test("media pages require bounded upload limits supplied by the server", () => {
  const page = { items: [], nextCursor: null, limits: defaultLimits };
  assert.deepEqual(photosSchema.parse(page).limits, defaultLimits);
  assert.equal(
    photosSchema.safeParse({ items: [], nextCursor: null }).success,
    false,
  );
  for (const limits of [
    { imageBytes: 0, videoBytes: defaultLimits.videoBytes },
    { imageBytes: -1, videoBytes: defaultLimits.videoBytes },
    { imageBytes: 1.5, videoBytes: defaultLimits.videoBytes },
    { imageBytes: defaultLimits.imageBytes, videoBytes: 0 },
    { imageBytes: defaultLimits.imageBytes, videoBytes: 1024 ** 3 + 1 },
    { imageBytes: 1024 ** 3 + 1, videoBytes: defaultLimits.videoBytes },
    { imageBytes: defaultLimits.imageBytes, videoBytes: "100" },
    { imageBytes: defaultLimits.imageBytes },
  ]) {
    assert.equal(photosSchema.safeParse({ ...page, limits }).success, false);
  }
  assert.equal(
    photosSchema.safeParse({
      ...page,
      limits: { imageBytes: 1024 ** 3, videoBytes: 1024 ** 3 },
    }).success,
    true,
  );
});

test("selection checks use custom limits even when images can exceed videos", () => {
  const limits = photosSchema.parse({
    items: [],
    nextCursor: null,
    limits: { imageBytes: 32 * 1024 * 1024, videoBytes: 2 * 1024 * 1024 },
  }).limits;
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(
      uploadProblem({ type, size: limits.imageBytes }, limits),
      null,
    );
    assert.equal(
      uploadProblem({ type, size: limits.imageBytes + 1 }, limits),
      "upload_size",
    );
  }
  for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
    assert.equal(
      uploadProblem({ type, size: limits.videoBytes }, limits),
      null,
    );
    assert.equal(
      uploadProblem({ type, size: limits.videoBytes + 1 }, limits),
      "upload_video_size",
    );
  }
});

test("anonymous entries cannot carry an author identity", () => {
  const entry = {
    id: 1,
    body: "Happy birthday!",
    createdAt: "2026-10-14T16:00:00Z",
    anonymous: true,
    author: null,
    canDelete: false,
  };
  assert.equal(entrySchema.safeParse(entry).success, true);
  assert.equal(
    entrySchema.safeParse({ ...entry, author: { id: 2, name: "Private name" } })
      .success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...entry, anonymous: false }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...entry, canDelete: undefined }).success,
    false,
  );
});

test("API contract rejects ambiguous dates and unrecognized privileges", () => {
  assert.equal(
    sessionSchema.safeParse({
      guest: { id: 1, name: "Test", role: "owner", active: true },
    }).success,
    false,
  );
  assert.equal(
    eventsSchema.safeParse({
      items: [
        {
          id: 1,
          title: "Test",
          description: "",
          teaser: "",
          startsAt: "2026-10-14T18:00:00",
          unlockAt: null,
          locked: false,
        },
      ],
    }).success,
    false,
  );
  assert.equal(eventsSchema.safeParse({ items: [] }).success, true);
});
