import { readFileSync, writeFileSync } from "node:fs";

type Rewrite = { source: string; destination: string };

/** Update Next's compiled proxy before its HTTP and WebSocket routers start. */
export function configureApiProxy(
  manifestPath: string | URL,
  configuredUrl = "http://127.0.0.1:8080",
): string {
  let api: URL;
  try {
    api = new URL(configuredUrl);
    if (
      !["http:", "https:"].includes(api.protocol) ||
      api.username ||
      api.password ||
      api.pathname !== "/" ||
      api.search ||
      api.hash
    )
      throw new Error();
  } catch {
    throw new Error(
      "API_INTERNAL_URL must be an HTTP(S) origin without credentials",
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rewrites: Rewrite[] | undefined = manifest.rewrites?.afterFiles;
  if (manifest.version !== 3 || !Array.isArray(rewrites))
    throw new Error("Unsupported Next.js routes manifest for the API proxy");
  const matches = rewrites.filter((route) => route.source === "/api/:path*");
  if (matches.length !== 1)
    throw new Error(
      "Expected exactly one /api/:path* rewrite in the Next.js routes manifest",
    );
  matches[0].destination = `${api.origin}/api/:path*`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  return api.origin;
}
