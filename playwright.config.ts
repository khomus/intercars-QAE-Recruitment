import { defineConfig, devices } from '@playwright/test';

// intercars.pl live site — pl-PL matches the shop UI.
export default defineConfig({
  testDir: './tests',
  // Live intercars E2E: many steps + 2× product page (dom is slow; do not cap at 2 min)
  timeout: 300_000,
  expect: { timeout: 25_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'https://intercars.pl',
    locale: 'pl-PL',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: {
          'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
  ],
});
