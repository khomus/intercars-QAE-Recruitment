import { test, expect } from '@playwright/test';

test('should verify the status of Experiment_Beta in a table-heavy UI', async ({ page }) => {
  // Step 1: Navigate to the target portal configuration interface
  await page.goto('/portal/experiments');

  // Step 2: Define a resilient locator for the table wrapper
  const tableGrid = page.locator('#experiments-grid');
  
  // Enforce auto-waiting for the table to be attached and visible
  await expect(tableGrid).toBeVisible();

  // Step 3: Chain locators to target the specific row using the .filter() API
  const targetRow = tableGrid.getByRole('row').filter({ hasText: 'Experiment_Beta' });

  // Step 4: Locate the target cell within that specific row context
  // Using user-facing or robust structural attributes instead of flaky hardcoded coordinates
  const statusCell = targetRow.locator('.status-cell');

  // Step 5: Perform assertion using Playwright's web-first assertions for built-in retries
  await expect(statusCell).toHaveText('Active', { timeout: 5000 });
});