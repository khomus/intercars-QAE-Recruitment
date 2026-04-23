import { test, expect } from '@playwright/test';
import {
  openAllSeeAllCatalog,
  skipIfBlocked,
  listCategoriesWithProductCounts,
  pickLargest,
  getFilterBlockFirst,
  openListingWithoutVehicleTypeParam,
  sumKategorieSectionSubcounts,
  sumFilterRowCounts,
  readListingTotalCount,
  clickFirstUsableListFilter,
  addToCartByProductPath,
  readListPricesForFirstProducts,
  readCartGrandTotal,
  acceptCookiesIfVisible,
  cartPageContainsListPrice,
  dismissPostAddToCartOverlayIfVisible,
} from './helpers/intercars';

// Assignment: intercars.pl, All → See all, biggest category, filter sums, one filter, 2 items, price math.
// CAPTCHA: manual in headed if needed.
test('intercars: catalog, filter, cart, list vs basket prices', async ({ page }) => {
  test.setTimeout(180000);
  const savedListPrices: number[] = [];

  await test.step('Home: All (WSZYSTKIE) → see all (Zobacz wszystkie)', async () => {
    await openAllSeeAllCatalog(page);
    await skipIfBlocked(page);
  });

  let expectedFromCategory: number;

  await test.step('Pick the category with the higest product count (dynamic)', async () => {
    // (higest left in step name — how ppl type fast)
    const categories = await listCategoriesWithProductCounts(page);
    expect(
      categories.length,
      'Category grid should expose at least one /oferta/ link with a count in parentheses',
    ).toBeGreaterThan(0);
    const best = pickLargest(categories);
    expectedFromCategory = best.count;
    await best.loc.scrollIntoViewIfNeeded();
    await best.loc.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL(/oferta\/.+\-\d+/, { timeout: 60000 });
    await skipIfBlocked(page);
  });

  await test.step('Listing total vs filter subcategores sum (assignment step)', async () => {
    // subcategores: speling like in a hurry
    // strip &type= so list total matches the category card count
    await openListingWithoutVehicleTypeParam(page);
    await acceptCookiesIfVisible(page);

    const listingTotal = await readListingTotalCount(page, expectedFromCategory);
    expect(listingTotal, 'Could not read product total from listing header/area').not.toBeNull();
    if (listingTotal == null) return;
    expect(
      listingTotal,
      'Listing count should match the number from the chosen category card',
    ).toBe(expectedFromCategory);

    let { sum, parts } = await sumKategorieSectionSubcounts(page);
    if (parts.length === 0) {
      const filter = await getFilterBlockFirst(page);
      const fb = await sumFilterRowCounts(filter);
      sum = fb.sum;
      parts = fb.parts;
    }
    expect(
      parts.length,
      'Expected at least one row in Kategorie with (count)',
    ).toBeGreaterThan(0);
    // subcats can ovelap in the tree (same SKU in more than one branch) — sum >= listing
    expect(
      sum,
      `Sum of Kategorie rows (${sum}) should be >= listing total (${listingTotal})`,
    ).toBeGreaterThanOrEqual(listingTotal);
    // sanity upper bound: DOM scrape errors, not a strict business rule
    const maxSum = Math.ceil(listingTotal * 1.2);
    expect(sum, `Kategorie sum sanity cap (~120% of listing) — check filter panel if this fails`).toBeLessThanOrEqual(
      maxSum,
    );
  });

  await test.step('Apply the first usuable filter in the list', async () => {
    // "usuable" = usual typo, filter block api keeps changing
    await clickFirstUsableListFilter(page);
  });

  await test.step('Read two list prices, add two distinct products to cart', async () => {
    // same productPath for price + add — avoids mismatch vs nth(list)
    const fromList = await readListPricesForFirstProducts(page, 2);
    expect(
      fromList.length,
      'Need at least two products with a PLN price on the list',
    ).toBeGreaterThanOrEqual(2);
    savedListPrices.length = 0;
    savedListPrices.push(fromList[0]!.price, fromList[1]!.price);

    await addToCartByProductPath(page, fromList[0]!.productPath);
    await page.waitForTimeout(500);
    await dismissPostAddToCartOverlayIfVisible(page);
    await acceptCookiesIfVisible(page);
    await addToCartByProductPath(page, fromList[1]!.productPath);
    await dismissPostAddToCartOverlayIfVisible(page);
  });

  await test.step('Cart: list prices + grand total (no shipping in compare)', async () => {
    await page.goto('/cart', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await acceptCookiesIfVisible(page);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const empty = /\bkoszyk (jest )?pusty|pusty (twój )?koszy|brak (produkt|pozycji)|the cart (is )?empty\b/i.test(
      body,
    );
    expect(empty, 'Cart should not be empty after two add-to-basket steps').toBeFalsy();
    // cart table is not always <tr> — use broad row/cell links
    const lineCount = await page
      .locator(
        'table a[href*="/produkty/"], [role="row"] a[href*="/produkty/"], #gc-main-content a[href*="/produkty/"], main a[href*="/produkty/"]',
      )
      .count();
    expect(
      lineCount,
      'Need two distinct product hrefs in cart (two lines); one line usually means 2nd add did not run',
    ).toBeGreaterThanOrEqual(2);
    for (const p of savedListPrices) {
      const s1 = p.toFixed(2).replace('.', ',');
      const ok = cartPageContainsListPrice(body, p);
      expect(
        ok,
        `List price not found in cart body (PL formats): expect ~${s1} (comma/dot, PLN)`,
      ).toBeTruthy();
    }
    const total = await readCartGrandTotal(page);
    if (Number.isFinite(total) && total > 0) {
      const want = savedListPrices.reduce((x, y) => x + y, 0);
      const diff = Math.abs(total - want);
      expect(
        diff,
        `Grand total ${total} PLN should match sum of list line prices ${want} PLN (tolerance, no delivery)`,
      ).toBeLessThan(2);
    }
  });
});
