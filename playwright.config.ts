import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/e2e.mjs supplies a disposable PostgreSQL database for each run.
// This private media directory never contains the host's real data.
const dataDir =
  process.env.BIRTHDAY_E2E_DATA_DIR ??
  mkdtempSync(join(tmpdir(), "birthday-party-e2e-"));
process.env.BIRTHDAY_E2E_DATA_DIR = dataDir;
// scripts/e2e.mjs gives each parallel shard its own ports; one run uses these.
const port = process.env.E2E_PORT ?? "3300";
const apiAddress = `127.0.0.1:${process.env.E2E_API_PORT ?? "18080"}`;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // One worker per server, since the specs share its party. Fully parallel
  // only lets --shard split by test rather than by file, so shards finish
  // together; every test sets up what it needs.
  fullyParallel: true,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    locale: "fr-CH",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/dev.mjs",
    url: `${baseURL}/invitation`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: port,
      LISTEN_ADDR: apiAddress,
      API_INTERNAL_URL: `http://${apiAddress}`,
      PUBLIC_URL: baseURL,
      DATA_DIR: dataDir,
      COOKIE_SECURE: "false",
      PRINT_ADMIN_INVITATION: "false",
      BIRTHDAY_AGE: "30",
      MAX_IMAGE_SIZE_MB: "3",
      MAX_VIDEO_SIZE_MB: "5",
      INVITATION_TITLE: "",
      INVITATION_DESCRIPTION: "",
      INVITATION_TITLE_FR: "",
      INVITATION_DESCRIPTION_FR: "",
      INVITATION_TITLE_EN: "",
      INVITATION_DESCRIPTION_EN: "",
      INVITATION_TITLE_DE: "",
      INVITATION_DESCRIPTION_DE: "",
      INVITATION_TITLE_IT: "",
      INVITATION_DESCRIPTION_IT: "",
      INVITATION_TITLE_ES: "",
      INVITATION_DESCRIPTION_ES: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
