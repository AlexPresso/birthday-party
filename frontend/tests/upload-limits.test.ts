import test from "node:test";
import assert from "node:assert/strict";
import { uploadProxyBodyLimit } from "../runtime/upload-limits.ts";

const mebibyte = 1024 * 1024;

test("the proxy leaves multipart room above the configured media limits", () => {
  assert.equal(uploadProxyBodyLimit({}), 100 * mebibyte + 65536);
  assert.equal(
    uploadProxyBodyLimit({ MAX_IMAGE_SIZE_MB: "", MAX_VIDEO_SIZE_MB: "" }),
    100 * mebibyte + 65536,
  );
  assert.equal(
    uploadProxyBodyLimit({ MAX_VIDEO_SIZE_MB: "250" }),
    250 * mebibyte + 65536,
  );
  assert.equal(
    uploadProxyBodyLimit({ MAX_IMAGE_SIZE_MB: "200", MAX_VIDEO_SIZE_MB: "25" }),
    200 * mebibyte + 65536,
  );
  assert.equal(
    uploadProxyBodyLimit({ MAX_IMAGE_SIZE_MB: "1", MAX_VIDEO_SIZE_MB: "1" }),
    mebibyte + 65536,
  );
  assert.equal(
    uploadProxyBodyLimit({ MAX_IMAGE_SIZE_MB: "1024" }),
    1024 * mebibyte + 65536,
  );
});

test("invalid media limits fail at startup instead of silently using a different cap", () => {
  for (const name of ["MAX_IMAGE_SIZE_MB", "MAX_VIDEO_SIZE_MB"]) {
    for (const value of [
      "0",
      "-1",
      "1025",
      "1.5",
      "+2",
      " 2",
      "2 ",
      "2mb",
      "1e2",
      "Infinity",
    ])
      assert.throws(() => uploadProxyBodyLimit({ [name]: value }), {
        message: `${name} must be an integer between 1 and 1024`,
      });
  }
});
