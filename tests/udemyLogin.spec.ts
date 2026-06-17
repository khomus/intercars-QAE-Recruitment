import { expect, type Locator, type Page } from '@playwright/test';

export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly submitBtn: Locator;

  constructor(private readonly page: Page) {
    this.username = this.page.getByTestId('username');
    this.password = this.page.getByTestId('password');
    this.submitBtn = this.page.getByRole('button', { name: 'Sign in' });
  }

  async login(credentials: { username: string; password: string }) {
    await this.username.fill(credentials.username);
    await this.password.fill(credentials.password);
    await this.submitBtn.click();
    await expect(this.page).toHaveURL(/dashboard/);
  }
}
