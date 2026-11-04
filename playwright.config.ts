import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build. Supabase points at an
 * unreachable local address, so these tests cover everything that does not
 * need a live backend: rendering, routing guards, forms, responsiveness and
 * API auth. Set E2E_BASE_URL to run against a fully configured deployment.
 *
 * Uses an installed browser channel (default: Microsoft Edge) instead of
 * downloading Playwright browsers; override with PW_CHANNEL=chrome.
 */
const PORT = Number(process.env.E2E_PORT ?? 39171);
const channel = process.env.PW_CHANNEL ?? "msedge";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start -p ${PORT}`,
        url: baseURL,
        timeout: 300_000,
        // Never attach to whatever else may be listening on the port.
        reuseExistingServer: false,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-test-key",
          NEXT_PUBLIC_SITE_URL: baseURL,
        },
      },
});
