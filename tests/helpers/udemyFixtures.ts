import { test as base, type Page } from '@playwright/test';

class CustomPage {
    constructor(readonly page: Page) {}
}

type MyFixtures = {
    customPage: CustomPage;
};

export const test = base.extend<MyFixtures>({
    customPage: async ({ page }, use) => {
        const custom = new CustomPage(page);

        await use(custom);

        // cleanup is here
    },
});

export { expect } from '@playwright/test';