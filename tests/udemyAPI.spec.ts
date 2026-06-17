import { test, expect } from '@playwright/test';

test('should display a fallback banner when partner portal configuration is empty', async ({ page }) => {
  // Step 1: Setup the network intercept routing
  await page.route('**/api/v1/partners/config', async (route) => {
    const mockPayload = {
      id: 'partner_99',
      name: 'Mock Partner Corp',
      features: [] // Forcing an edge case empty data array
    };
    
    // Fulfill the route request with mocked data immediately
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: mockPayload
    });
  });

  // Step 2: Trigger the application flow that executes the API fetch
  await page.goto('/portal/configuration');

  // Step 3: Assert the UI handles the mocked backend state gracefully
  const fallbackMessage = page.getByText('No active features found.');
  await expect(fallbackMessage).toBeVisible({ timeout: 3000 });
});