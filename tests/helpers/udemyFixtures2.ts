import { test as base, expect, Page } from '@playwright/test';

// Define the type for our custom fixtures
type MyFixtures = {
  adminUserPage: Page;
};

// Extend the base test context
export const test = base.extend<MyFixtures>({
  adminUserPage: async ({ page }, use) => {
    // --- SETUP phase ---
    // Injecting a predefined authentication state directly via cookies/session storage
    await page.context().addCookies([{
      name: 'auth_token',
      value: 'secure_mock_admin_token_123',
      domain: 'localhost',
      path: '/'
    }]);

    // Navigate to the land page of the application
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // Pass the fully prepared page context to the actual test execution block
    await use(page);

    // --- TEARDOWN phase ---
    // Executes automatically when the test finishes, regardless of success or failure
    await page.goto('/logout');
    await page.context().clearCookies();
  },
});

export { expect };