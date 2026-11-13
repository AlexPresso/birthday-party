import {
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";

/** The frontend started by playwright.config.ts. */
export const baseURL = "http://localhost:3300";

/** The API rejects state-changing requests without these headers. */
export const mutationHeaders = {
  "X-Requested-With": "birthday-party",
  Origin: baseURL,
};

export type Guest = { id: number; name: string };
export type Invitation = { guest: Guest; invitationUrl: string };

/** Reads the single-use token from an invitation link's fragment. */
export function invitationToken(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("The invitation URL has no token fragment.");
  return token;
}

/** An API client that can send mutations; dispose it when the spec ends. */
export function newClient() {
  return request.newContext({ baseURL, extraHTTPHeaders: mutationHeaders });
}

/** Consumes an invitation, giving `client` that guest's session cookie. */
export async function activate(
  client: APIRequestContext,
  invitationUrl: string,
) {
  const response = await client.post("/api/invitations/accept", {
    headers: mutationHeaders,
    data: { token: invitationToken(invitationUrl) },
  });
  expect(response.status()).toBe(200);
}

/**
 * Creates an administrator through the backend command line, the only way to
 * obtain one, and returns a client signed in as that host.
 */
export async function bootstrapHost(name: string) {
  // Only scripts/e2e.mjs supplies both variables for its disposable database
  // and playwright.config.ts the private media directory. Refuse anything
  // else: these specs create and delete guests, media and settings.
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  )
    throw new Error("Run the browser tests through npm run test:e2e.");
  if (!process.env.BIRTHDAY_E2E_DATA_DIR)
    throw new Error("The isolated E2E data directory is required.");
  const output = execFileSync(
    process.execPath,
    ["scripts/backend.mjs", "invite-admin", "--name", name],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: process.env.BIRTHDAY_E2E_DATA_DIR,
        PUBLIC_URL: baseURL,
        COOKIE_SECURE: "false",
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const match = output.match(
    /http:\/\/localhost:3300\/invitation#token=[A-Za-z0-9_-]+/,
  );
  if (!match)
    throw new Error("Host bootstrap did not return an invitation URL.");
  const host = await newClient();
  await activate(host, match[0]);
  return host;
}

/** Has the host prepare a guest profile and its invitation link. */
export async function invite(
  host: APIRequestContext,
  name: string,
): Promise<Invitation> {
  const response = await host.post("/api/admin/guests", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json();
}

/** Creates a guest and signs the page's browser context in as that guest. */
export async function signInGuest(
  host: APIRequestContext,
  page: Page,
  name: string,
) {
  const invitation = await invite(host, name);
  await activate(page.request, invitation.invitationUrl);
  return invitation.guest;
}

/** Signs a browser context in with the session of an API client. */
export async function shareSession(
  context: BrowserContext,
  client: APIRequestContext,
) {
  await context.addCookies((await client.storageState()).cookies);
}

/** Fails when the page scrolls sideways at its current width. */
export async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
