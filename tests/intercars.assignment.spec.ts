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
  addToCartByIndex,
  readListPricesForFirstProducts,
  readCartGrandTotal,
  acceptCookiesIfVisible,
} from './helpers/intercars';

/**
 * E2E по сценарию тестового задания.
 * CAPTCHA/Cloudflare/«Cierpliwości» — вручную в headed или test.skip, см. README.
 */
test('Intercars: каталог, фильтр, корзина, цены', async ({ page }) => {
  test.setTimeout(180000);
  const savedListPrices: number[] = [];

  await test.step('Wejście: All → Zobacz wszystkie (WSZYSTKIE)', async () => {
    await openAllSeeAllCatalog(page);
    await skipIfBlocked(page);
  });

  let expectedFromCategory: number;
  let chosenName: string;

  await test.step('Wybór kategorii z największą liczbą produktów (krok 3–4)', async () => {
    const categories = await listCategoriesWithProductCounts(page);
    expect(
      categories.length,
      'Na stronie /oferta/ powinny być kategorie z licznikami w nawiasach',
    ).toBeGreaterThan(0);
    const best = pickLargest(categories);
    expectedFromCategory = best.count;
    chosenName = best.name;
    await best.loc.scrollIntoViewIfNeeded();
    await best.loc.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL(/oferta\/.+\-\d+/, { timeout: 60000 });
    await skipIfBlocked(page);
  });

  await test.step('Weryfikacja: filtry (suma podkategorii = krok 3) i nagłówek listy', async () => {
    // Bez `type=…` w URL lista dotyczy całej kategorii (jak w kroku 3), a nie tylko wybranego auta
    await openListingWithoutVehicleTypeParam(page);
    await acceptCookiesIfVisible(page);

    const listingTotal = await readListingTotalCount(page);
    if (listingTotal !== null) {
      expect(listingTotal, 'Liczba w liście powinna odpowiadać kategorii z kroku 3').toBe(
        expectedFromCategory,
      );
    }

    let { sum, parts } = await sumKategorieSectionSubcounts(page);
    if (parts.length === 0) {
      const filter = await getFilterBlockFirst(page);
      const fb = await sumFilterRowCounts(filter);
      sum = fb.sum;
      parts = fb.parts;
    }
    expect(
      parts.length,
      'Oczekiwano sekcji Kategorie z linkami i licznikami (lub innego bloku filtrów)',
    ).toBeGreaterThan(0);
    expect(
      sum,
      `Suma (pod)kategorii w menu filtrów (${sum}) = liczba z kroku 3 (${expectedFromCategory})`,
    ).toBe(expectedFromCategory);
  });

  await test.step('Zastosuj jeden z filtrów (pierwszy użyteczny)', async () => {
    await clickFirstUsableListFilter(page);
  });

  await test.step('Zapisz ceny 2 produktów z listy; dodaj do koszyka', async () => {
    const fromList = await readListPricesForFirstProducts(page, 2);
    expect(
      fromList.length,
      'Oczekiwano co najmniej 2 produktów z widoczną ceną w PLN',
    ).toBeGreaterThanOrEqual(2);
    savedListPrices.length = 0;
    savedListPrices.push(fromList[0]!.price, fromList[1]!.price);

    await addToCartByIndex(page, 0);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /kontynuuj|powrót|zamknij|kupuj dalej|×/i }).first().click().catch(() => page.keyboard.press('Escape'));
    await acceptCookiesIfVisible(page);
    await addToCartByIndex(page, 1);
    await page.getByRole('button', { name: /kontynuuj|powrót|zamknij|kupuj dalej|×/i }).first().click().catch(() => page.keyboard.press('Escape'));
  });

  await test.step('Koszyk: ceny i suma', async () => {
    await page.goto('/cart', { waitUntil: 'load' });
    await acceptCookiesIfVisible(page);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    for (const p of savedListPrices) {
      const s1 = p.toFixed(2).replace('.', ',');
      const s2 = p.toFixed(2);
      const ok = body.includes(s1) || body.replace(/\s/g, '').includes(s1.replace(/\s/g, '')) || body.includes(s2);
      expect(ok, `Koszyk: oczekiwano ceny z listy (ok. ${s1} zł)`).toBeTruthy();
    }
    const total = await readCartGrandTotal(page);
    if (Number.isFinite(total) && total > 0) {
      const want = savedListPrices.reduce((x, y) => x + y, 0);
      const diff = Math.abs(total - want);
      expect(
        diff,
        `Razem w koszyku ${total} zł, suma pozycji z listy ${want} zł (brak wysyłki w porównaniu)`,
      ).toBeLessThan(2);
    }
  });
});
