import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/loginPage';

test('should login successfully', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('testuser', 'password123');
  await expect(page).toHaveURL(/dashboard/);
});