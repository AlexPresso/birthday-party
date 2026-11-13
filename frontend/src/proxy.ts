import { NextResponse, type NextRequest } from "next/server";

// React needs eval in development only, to rebuild server error stacks.
const scriptEval =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

// A plain host name or IPv4 address with an optional port. Anything else,
// IPv6 literals included, is left out of the policy.
const hostSource = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

/**
 * Sources for the same-origin realtime WebSocket. Recent browsers accept
 * ws(s): under 'self'; older ones only match an explicit host.
 */
function webSocketSources(request: NextRequest) {
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    .trim();
  return host && hostSource.test(host) ? ` ws://${host} wss://${host}` : "";
}

function contentSecurityPolicy(nonce: string, request: NextRequest) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptEval}`,
    // Server-rendered style attributes carry sizes, positions and colors.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${webSocketSources(request)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Sends every page with a Content Security Policy and a fresh script nonce. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, request);

  // Next.js reads the nonce for its own scripts from the request's policy.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: the API proxy, build assets, public files (/sw.js keeps
      // its own stricter policy from next.config.ts) and link prefetches need
      // no nonce.
      source:
        "/((?!api|_next/static|_next/image|fonts/|icons/|sw.js|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
