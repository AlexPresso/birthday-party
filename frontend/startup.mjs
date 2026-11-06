import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { uploadProxyBodyLimit } from "./runtime/upload-limits.ts";
import { configureApiProxy } from "./runtime/api-proxy.ts";

performance.mark("next-start");

try {
  process.env.NODE_ENV = "production";
  const dir = fileURLToPath(new URL(".", import.meta.url));
  process.chdir(dir);
  process.env.API_INTERNAL_URL = configureApiProxy(
    new URL(".next/routes-manifest.json", import.meta.url),
    process.env.API_INTERNAL_URL,
  );
  const { config } = JSON.parse(
    readFileSync(
      new URL(".next/required-server-files.json", import.meta.url),
      "utf8",
    ),
  );

  // Match the bounded proxy ceiling used in development; Go enforces the
  // host's current upload limits from PostgreSQL on every request.
  config.experimental.proxyClientMaxBodySize = uploadProxyBodyLimit();
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
  const keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
  const require = createRequire(import.meta.url);
  require("next");
  const { startServer } = require("next/dist/server/lib/start-server");
  await startServer({
    dir,
    isDev: false,
    hostname: process.env.HOSTNAME || "0.0.0.0",
    port,
    allowRetry: false,
    keepAliveTimeout:
      Number.isFinite(keepAliveTimeout) && keepAliveTimeout >= 0
        ? keepAliveTimeout
        : undefined,
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
