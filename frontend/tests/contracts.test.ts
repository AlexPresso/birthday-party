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
  welcomeSchema,
  adminWelcomeSchema,
  profileSchema,
  mediaCategorySchema,
  mediaCategoriesSchema,
  welcomeUploadContextSchema,
} from "../src/lib/contracts.ts";

test("welcome responses distinguish waiting, the current step and full access", () => {
  const waiting = { open: false, revision: 1, step: null };
  const step = {
    position: 1,
    title: "Meet outside",
    body: "Bring your coat.",
    action: null,
  };
  assert.equal(welcomeSchema.safeParse(waiting).success, true);
  assert.equal(welcomeSchema.safeParse({ ...waiting, step }).success, true);
  assert.equal(
    welcomeSchema.safeParse({ ...waiting, open: true }).success,
    true,
  );
  for (const invalid of [
    { ...waiting, step, open: true },
    { ...waiting, revision: -1 },
    { ...waiting, step: { ...step, position: 0 } },
    { ...waiting, step: { ...step, position: 13 } },
    { ...waiting, step: { ...step, title: "" } },
  ])
    assert.equal(welcomeSchema.safeParse(invalid).success, false);

  const admin = {
    open: false,
    revision: 2,
    currentStep: 1,
    steps: [{ title: step.title, body: step.body, action: null }],
  };
  assert.equal(adminWelcomeSchema.safeParse(admin).success, true);
  assert.equal(
    adminWelcomeSchema.safeParse({ ...admin, currentStep: 2 }).success,
    false,
  );
  assert.equal(
    adminWelcomeSchema.safeParse({ ...admin, open: true }).success,
    false,
  );
  assert.equal(
    adminWelcomeSchema.safeParse({
      ...admin,
      steps: Array(13).fill(admin.steps[0]),
    }).success,
    false,
  );
});

test("welcome steps accept only supported optional actions", () => {
  const step = { title: "Your photo", body: "", action: "profile_photo" };
  const welcome = {
    open: false,
    revision: 3,
    step: { ...step, position: 1 },
  };
  const admin = {
    open: false,
    revision: 3,
    currentStep: 1,
    steps: [step],
  };
  assert.equal(welcomeSchema.parse(welcome).step?.action, "profile_photo");
  assert.equal(
    adminWelcomeSchema.parse(admin).steps[0].action,
    "profile_photo",
  );
  for (const action of [
    undefined,
    "",
    "gallery",
    true,
    [],
    { type: "profile_photo" },
  ]) {
    assert.equal(
      welcomeSchema.safeParse({ ...welcome, step: { ...welcome.step, action } })
        .success,
      false,
    );
    assert.equal(
      adminWelcomeSchema.safeParse({ ...admin, steps: [{ ...step, action }] })
        .success,
      false,
    );
  }
});

const defaultLimits = {
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
};

test("media upload actions require a typed destination and cannot configure another action", () => {
  const state = { open: false, revision: 4, currentStep: 1 };
  const base = { title: "Share a memory", body: "", action: "media_upload" };
  for (const categoryId of [null, 42]) {
    const step = { ...base, mediaUpload: { categoryId } };
    assert.deepEqual(
      adminWelcomeSchema.parse({ ...state, steps: [step] }).steps[0],
      step,
    );
    assert.equal(
      welcomeSchema.safeParse({
        open: false,
        revision: state.revision,
        step: { ...step, position: 1 },
      }).success,
      true,
    );
  }
  for (const mediaUpload of [
    undefined,
    null,
    {},
    true,
    "main",
    { categoryId: 0 },
    { categoryId: -1 },
    { categoryId: 1.5 },
    { categoryId: "42" },
    { categoryId: null, isPublic: true },
  ]) {
    assert.equal(
      adminWelcomeSchema.safeParse({
        ...state,
        steps: [{ ...base, mediaUpload }],
      }).success,
      false,
    );
  }
  for (const action of [null, "profile_photo"]) {
    assert.equal(
      adminWelcomeSchema.safeParse({
        ...state,
        steps: [{ ...base, action, mediaUpload: { categoryId: 42 } }],
      }).success,
      false,
    );
  }
});

test("categories require explicit visibility and bounded names and collections", () => {
  const category = { id: 1, name: "For later", isPublic: false };
  assert.deepEqual(mediaCategorySchema.parse(category), category);
  assert.equal(
    mediaCategorySchema.safeParse({ ...category, isPublic: true }).success,
    true,
  );
  assert.equal(
    mediaCategorySchema.safeParse({ ...category, name: "🎂".repeat(80) })
      .success,
    true,
  );
  for (const invalid of [
    { ...category, isPublic: undefined },
    { ...category, isPublic: "false" },
    { ...category, id: 0 },
    { ...category, name: "" },
    { ...category, name: "🎂".repeat(81) },
  ])
    assert.equal(mediaCategorySchema.safeParse(invalid).success, false);
  assert.equal(
    mediaCategoriesSchema.safeParse({ items: Array(100).fill(category) })
      .success,
    true,
  );
  assert.equal(
    mediaCategoriesSchema.safeParse({ items: Array(101).fill(category) })
      .success,
    false,
  );
});

test("welcome upload context identifies the current destination and effective limits", () => {
  const context = { revision: 6, category: null, limits: defaultLimits };
  assert.deepEqual(welcomeUploadContextSchema.parse(context), context);
  assert.equal(
    welcomeUploadContextSchema.safeParse({
      ...context,
      category: { id: 2, name: "Surprise", isPublic: false },
    }).success,
    true,
  );
  for (const invalid of [
    { ...context, revision: -1 },
    { ...context, category: undefined },
    { ...context, limits: undefined },
    { ...context, limits: { ...defaultLimits, videoBytes: 0 } },
  ])
    assert.equal(welcomeUploadContextSchema.safeParse(invalid).success, false);
});

test("profile photos stay on the authenticated API and require effective image limits", () => {
  const profile = {
    guest: {
      id: 1,
      name: "Test guest",
      role: "guest",
      active: true,
      avatarUrl: null,
    },
    limits: { imageBytes: defaultLimits.imageBytes },
  };
  assert.equal(profileSchema.safeParse(profile).success, true);
  assert.equal(
    profileSchema.safeParse({
      ...profile,
      guest: { ...profile.guest, avatarUrl: "/api/guests/1/avatar?v=2" },
    }).success,
    true,
  );
  for (const avatarUrl of [
    undefined,
    "/api/guests/1/avatar",
    "/api/guests/1/avatar?v=0",
    "https://example.com/avatar.jpg",
    "//example.com/avatar.jpg",
    "/api/guests/../avatar?v=1",
  ]) {
    assert.equal(
      profileSchema.safeParse({
        ...profile,
        guest: { ...profile.guest, avatarUrl },
      }).success,
      false,
    );
  }
  for (const imageBytes of [undefined, 0, -1, 1.5, 1024 ** 3 + 1]) {
    assert.equal(
      profileSchema.safeParse({ ...profile, limits: { imageBytes } }).success,
      false,
    );
  }
});

test("upload responses distinguish accepted work, completed media and failed preparation", () => {
  const job = {
    id: 1,
    categoryId: null,
    welcomeRevision: null,
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
  // Ready jobs can omit media that is deleted, private or still welcome-gated.
  assert.equal(
    uploadSchema.safeParse({ ...job, status: "ready" }).success,
    true,
  );
  assert.equal(
    uploadSchema.safeParse({
      ...job,
      status: "ready",
      categoryId: 12,
      welcomeRevision: 4,
      photo: null,
    }).success,
    true,
  );
  for (const invalid of [
    { ...job, status: "failed" },
    { ...job, status: "ready", errorCode: "unreadable_video" },
    { ...job, status: "done" },
    { ...job, clientUploadId: null },
    { ...job, clientUploadId: "arbitrary-key" },
    { ...job, categoryId: undefined },
    { ...job, categoryId: -1 },
    { ...job, welcomeRevision: undefined },
    { ...job, welcomeRevision: -1 },
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
    categoryId: null,
    author: { id: 1, name: "Test guest", avatarUrl: null },
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
    photoSchema.safeParse({ ...valid, categoryId: 12 }).success,
    true,
  );
  assert.equal(
    photoSchema.safeParse({ ...valid, categoryId: undefined }).success,
    false,
  );
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
    entrySchema.safeParse({
      ...entry,
      author: {
        id: 2,
        name: "Private name",
        avatarUrl: "/api/guests/2/avatar?v=1",
      },
    }).success,
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
      guest: {
        id: 1,
        name: "Test",
        role: "owner",
        active: true,
        avatarUrl: null,
      },
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
