import { test, expect } from '@playwright/test';

/**
 * Минимальная проверка, что раннер и TypeScript настроены.
 * Реальные сценарии — после уточнения задания.
 */
test('среда Playwright запускается', async ({ page }) => {
  await page.goto('about:blank');
  await expect(page).toHaveURL('about:blank');
});
