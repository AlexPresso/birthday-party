import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureApiProxy } from "../runtime/api-proxy.ts";

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "birthday-api-proxy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "routes-manifest.json");
  const manifest = {
    version: 3,
    headers: [
      {
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ],
    rewrites: {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/api/:path*",
          destination: "http://build-only:8080/api/:path*",
          regex: "original-regex",
        },
        { source: "/other", destination: "/unchanged" },
      ],
      fallback: [],
    },
  };
  writeFileSync(path, JSON.stringify(manifest));
  return { path, manifest };
}

test("startup changes only the compiled API destination and supports a new runtime on restart", (t) => {
  const { path, manifest } = fixture(t);
  for (const origin of [
    "http://party-a-backend:8080",
    "https://party-b-backend:8443",
  ]) {
    assert.equal(configureApiProxy(path, `${origin}/`), origin);
    manifest.rewrites.afterFiles[0].destination = `${origin}/api/:path*`;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), manifest);
  }
});

test("invalid runtime origins fail before changing the compiled routes", (t) => {
  const { path } = fixture(t);
  const original = readFileSync(path, "utf8");
  for (const origin of [
    "",
    "not-a-url",
    "ftp://backend",
    "http://user:secret@backend",
    "http://backend/prefix",
    "http://backend/?query=1",
    "http://backend/#fragment",
  ]) {
    assert.throws(() => configureApiProxy(path, origin), /API_INTERNAL_URL/);
    assert.equal(readFileSync(path, "utf8"), original);
  }
});

test("unexpected generated manifests fail rather than starting with a stale backend", (t) => {
  const { path, manifest } = fixture(t);
  for (const invalid of [
    { ...manifest, version: 4 },
    { ...manifest, rewrites: [] },
    { ...manifest, rewrites: { afterFiles: [] } },
    {
      ...manifest,
      rewrites: {
        afterFiles: [
          manifest.rewrites.afterFiles[0],
          manifest.rewrites.afterFiles[0],
        ],
      },
    },
  ]) {
    const original = JSON.stringify(invalid);
    writeFileSync(path, original);
    assert.throws(
      () => configureApiProxy(path, "http://backend:8080"),
      /routes manifest/,
    );
    assert.equal(readFileSync(path, "utf8"), original);
  }
});
