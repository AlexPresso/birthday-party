import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every run owns a fresh database and media directory, never the host's real data.
const dataDir = process.env.BIRTHDAY_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'birthday-party-e2e-'));
process.env.BIRTHDAY_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3300',
    ...devices['Desktop Chrome'],
    locale: 'fr-CH',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://localhost:3300/invitation',
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: '3300',
      LISTEN_ADDR: '127.0.0.1:18080',
      API_INTERNAL_URL: 'http://127.0.0.1:18080',
      PUBLIC_URL: 'http://localhost:3300',
      DATA_DIR: dataDir,
      COOKIE_SECURE: 'false',
      PRINT_ADMIN_INVITATION: 'false',
      BIRTHDAY_AGE: '30',
      INVITATION_TITLE: '',
      INVITATION_DESCRIPTION: '',
      INVITATION_TITLE_FR: '',
      INVITATION_DESCRIPTION_FR: '',
      INVITATION_TITLE_EN: '',
      INVITATION_DESCRIPTION_EN: '',
      INVITATION_TITLE_DE: '',
      INVITATION_DESCRIPTION_DE: '',
      INVITATION_TITLE_IT: '',
      INVITATION_DESCRIPTION_IT: '',
      INVITATION_TITLE_ES: '',
      INVITATION_DESCRIPTION_ES: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
