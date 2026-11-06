import assert from "node:assert/strict";
import test from "node:test";
import { createUploadPreviews } from "../src/features/media/upload-previews.ts";
import {
  restoreUploadDismissals,
  storeUploadDismissals,
} from "../src/features/media/upload-dismissals.ts";

test("local image previews remain available until dismissal or eviction and are bounded", (t) => {
  let next = 0;
  const revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => `blob:preview-${++next}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const previews = createUploadPreviews();
  const image = new File(["image"], "private-photo.jpg", {
    type: "image/jpeg",
  });
  for (let index = 0; index < 25; index++) {
    previews.remember(String(index), image);
  }
  assert.equal(previews.get("0"), undefined);
  assert.equal(previews.get("4"), undefined);
  assert.equal(previews.get("5"), "blob:preview-6");
  assert.equal(previews.get("24"), "blob:preview-25");
  assert.equal(revoked.length, 5);

  previews.release("5");
  assert.equal(previews.get("5"), undefined);
  previews.clear();
  previews.clear();
  assert.equal(revoked.length, 25);
  assert.equal(new Set(revoked).size, 25);
  assert.equal(previews.get("24"), undefined);
});

test("replacing a local preview releases its old URL and videos have no image preview", (t) => {
  let next = 0;
  const revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => `blob:preview-${++next}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const previews = createUploadPreviews();
  const image = new File(["image"], "photo.png", { type: "image/png" });
  previews.remember("photo", image);
  previews.remember("photo", image);
  previews.remember(
    "video",
    new File(["video"], "video.mp4", { type: "video/mp4" }),
  );
  assert.deepEqual(revoked, ["blob:preview-1"]);
  assert.equal(previews.get("photo"), "blob:preview-2");
  assert.equal(previews.get("video"), undefined);
  assert.equal(next, 2);
  previews.clear();
});

function uploadId(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

test("dismissals survive restoration with only the latest 200 unique upload IDs", () => {
  let stored = "";
  const ids = Array.from({ length: 205 }, (_, index) => uploadId(index));
  storeUploadDismissals(
    [...ids, ids[204], "private-photo.jpg", "not-an-upload-id"],
    {
      setItem(_key, value) {
        stored = value;
      },
    },
  );
  assert.deepEqual(
    restoreUploadDismissals({ getItem: () => stored }),
    ids.slice(-200),
  );
  assert.ok(stored.length <= 8192);
  assert.equal(stored.includes("private-photo"), false);
});

test("unavailable storage and malformed or oversized dismissal data leave uploads usable", () => {
  for (const raw of [null, "broken", "{}", '"string"', " ".repeat(8193)]) {
    assert.deepEqual(restoreUploadDismissals({ getItem: () => raw }), []);
  }
  assert.deepEqual(
    restoreUploadDismissals({
      getItem() {
        throw new Error("Storage unavailable.");
      },
    }),
    [],
  );
  assert.doesNotThrow(() =>
    storeUploadDismissals([uploadId(1)], {
      setItem() {
        throw new Error("Storage full.");
      },
    }),
  );
});
