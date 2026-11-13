import test from "node:test";
import assert from "node:assert/strict";
import { uploadProxyBodyLimit } from "../runtime/upload-limits.ts";
import { configurationSchema } from "../src/features/party/contracts.ts";

test("the proxy allows every supported saved limit with room for multipart data", () => {
  const largestLimit = configurationSchema.shape.videoSizeMB.parse(1024);
  assert.equal(uploadProxyBodyLimit(), largestLimit * 1024 * 1024 + 65536);
});
