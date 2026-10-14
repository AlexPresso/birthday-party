import test from "node:test";
import assert from "node:assert/strict";
import {
  photoSchema,
  uploadProblem,
  eventsSchema,
  sessionSchema,
} from "../src/lib/contracts.ts";

test("media responses cannot point a private gallery at an external host", () => {
  const valid = {
    id: 2,
    author: { id: 1, name: "Test guest" },
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
    uploadProblem({ type: "image/jpeg", size: 15 * 1024 * 1024 }),
    null,
  );
  assert.equal(
    uploadProblem({ type: "image/jpeg", size: 15 * 1024 * 1024 + 1 })!,
    "upload_size",
  );
  assert.equal(uploadProblem({ type: "image/heic", size: 1 }), "upload_type");
  assert.equal(uploadProblem({ type: "image/png", size: 0 }), "upload_empty");
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
