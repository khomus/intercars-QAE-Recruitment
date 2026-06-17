import { test, expect } from '@playwright/test';

test('should create experiment via API and validate in UI', async ({ page, request }) => {
    // Pre-condition via API
    const response = await request.post('/api/experiments', {
      data: {
        name: 'A/B Test V2',
        status: 'draft'
      }
    });
    expect(response.ok()).toBeTruthy();
  
    await page.goto('/experiments');
    await expect(page.getByText('A/B Test V2')).toBeVisible();
  
    // Optional: clean up
    // await request.delete(`/api/experiments/${id}`);
  });