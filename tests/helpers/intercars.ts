import type { Page, Locator } from '@playwright/test';
import { test } from '@playwright/test';

/** Польский формат: "12 345" или "1 234,56 zł" */
export function parsePlInt(s: string): number {
  const d = s.replace(/[\s\u00a0]/g, '').replace(/\D/g, '');
  return d ? parseInt(d, 10) : NaN;
}

export function parsePlPrice(s: string): number {
  const t = s.replace(/\s/g, '').replace(/\u00a0/g, '').replace(',', '.');
  const m = t.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : NaN;
}

export async function acceptCookiesIfVisible(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /akceptuj|akceptuję|zgadzam|zaakceptuj|accept|accept all/i }).first();
  await btn.click({ timeout: 12000 }).catch(() => {});
}

export function isChallengeOrWaitPage(page: Page): Promise<boolean> {
  return page
    .title()
    .then((t) => /cierpliwo|cloudflare|just a moment|attention required|verify you are human/i.test(t));
}

export async function skipIfBlocked(page: Page): Promise<void> {
  if (await isChallengeOrWaitPage(page)) {
    test.skip(true, 'Сайт открыл страницу ожидания/защиты. Запустите тест в headed-режиме: npm run test:headed');
  }
}

/**
 * Usuwa `type=…` w query i w formie `...-id&type=…` (tak w linkach Intercars — inaczej `searchParams` nie ma `type`).
 */
export function buildUrlStripVehicleType(href: string): string {
  if (!/type=/.test(href)) return href;
  const strippedAmp = href.replace(/&type=[^&#?]*/gi, '');
  try {
    const u = new URL(strippedAmp);
    u.searchParams.delete('type');
    u.searchParams.delete('vehicle');
    u.searchParams.delete('pojazd');
    let s = u.toString();
    s = s.replace(/[?&]$/g, '');
    return s;
  } catch {
    return strippedAmp;
  }
}

/**
 * Tylko URL: usuń `type=…` — NIE używaj tutaj „Wyczyść wszystko": na Intercars czyści też
 * wybraną kategorię i wraca na główne /oferta/; wtedy w „suma podkategorii" liczy się
 * cała siatka głównych kategorii (setki tys. produktów).
 */
export async function openListingWithoutVehicleTypeParam(page: Page): Promise<void> {
  const raw = page.url();
  const next = buildUrlStripVehicleType(raw);
  if (next && next !== raw) {
    await page.goto(next, { waitUntil: 'load' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
  }
}

const DEBUG_KATEGORIE = process.env.INTERCARS_DEBUG === '1';

/**
 * Suma tylko z wierszy podsekcji „Kategorie" w pasku filtrów (aside), pomiędzy „Kategorie" a
 * następną sekcją (np. „Producent") — bez siatki głównych kategorii z głównej kolumny.
 */
export async function sumKategorieSectionSubcounts(page: Page): Promise<{ sum: number; parts: number[] }> {
  const texts = await page.evaluate(() => {
    const aside: HTMLElement | null = document.querySelector('aside, [role="complementary"]');
    if (!aside) return { labels: [] as string[], debug: { reason: 'no-aside' } };
    const paras = Array.from(aside.querySelectorAll('p'));
    const kIdx = paras.findIndex((p) => (p.textContent || '').trim() === 'Kategorie');
    if (kIdx < 0) return { labels: [] as string[], debug: { reason: 'no-kategorie-p' } };
    const pKat = paras[kIdx]!;
    const pEndI = paras.findIndex((p, i) => {
      if (i <= kIdx) return false;
      const t = (p.textContent || '').trim();
      // „Producent" albo „Polecane" — prawdziwa granica sekcji podkategorii (NIE „Cena" wyżej w aside)
      return t === 'Producent' || t === 'Polecane';
    });
    const pEnd = pEndI >= 0 ? (paras[pEndI] as HTMLElement) : null;
    const labels: string[] = [];
    const following = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const isBetween = (el: Element) => {
      if (!following(pKat, el)) return false; // el po sekcji „Kategorie"
      if (pEnd == null) return true;
      return following(el, pEnd); // koniec sekcji (Producent / Polecane / Cena) dalej niż el
    };
    for (const a of Array.from(aside.querySelectorAll('a[href*="/oferta/"]'))) {
      if (!isBetween(a)) continue;
      const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/\([0-9]/.test(t) || t.length > 500) continue;
      labels.push(t);
    }
    return { labels, debug: { count: labels.length, href: document.location?.href || '' } };
  });
  if (DEBUG_KATEGORIE) {
    console.log('[INTERCARS_DEBUG] Kategorie', JSON.stringify(texts, null, 0));
  }
  const parts: number[] = [];
  for (const t of texts.labels) {
    const paren = t.match(/\(([\d\s\u00a0\u202f]+)\)\s*$/);
    if (!paren) continue;
    const v = parsePlInt(paren[1] ?? '');
    if (Number.isFinite(v) && v > 0) parts.push(v);
  }
  return { sum: parts.reduce((a, b) => a + b, 0), parts };
}

/**
 * Wszystkie (меню) → Zobacz wszystkie
 */
export async function openAllSeeAllCatalog(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await acceptCookiesIfVisible(page);
  await page.getByRole('link', { name: 'WSZYSTKIE' }).first().click();
  await page.getByRole('link', { name: 'Zobacz wszystkie' }).first().click();
  await page.waitForURL(/\/oferta\/?$|\/oferta\/?\?/);
  await page.waitForLoadState('domcontentloaded');
}

type CategoryRow = { count: number; name: string; loc: Locator };

/**
 * Ссылки в основной зоне каталога: текст с числом в скобках.
 */
export async function listCategoriesWithProductCounts(
  page: Page,
  root: Locator = page.locator('main, [role="main"], #main, .gc-main').first(),
): Promise<CategoryRow[]> {
  const links = root.locator('a[href*="/oferta/"]');
  const n = await links.count();
  const out: CategoryRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const loc = links.nth(i);
    const href = (await loc.getAttribute('href').catch(() => null)) || '';
    if (href && seen.has(href)) continue;
    if (href) seen.add(href);
    const text = (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const paren = text.match(/\(([\d\s\u00a0\u202f]+)\)\s*$/);
    if (!paren) continue;
    const count = parsePlInt(paren[1] ?? '');
    if (!Number.isFinite(count) || count <= 0) continue;
    const name = text.replace(/\s*\([^)]+\)\s*$/, '').trim() || text;
    out.push({ count, name, loc });
  }
  if (out.length) return out;

  const fallback = page.locator('a[href*="/oferta/"]');
  const n2 = await fallback.count();
  for (let i = 0; i < n2; i++) {
    const loc = fallback.nth(i);
    const text = (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 500) continue;
    const paren = text.match(/\(([\d\s\u00a0\u202f]+)\)/);
    if (!paren) continue;
    const count = parsePlInt(paren[1] ?? '');
    if (!Number.isFinite(count) || count <= 0) continue;
    const name = text.split('(')[0].trim() || text;
    out.push({ count, name, loc });
  }
  return out;
}

export function pickLargest(categories: CategoryRow[]): CategoryRow {
  if (!categories.length) throw new Error('Не найдено ни одной категории с количеством в скобках');
  return categories.reduce((a, b) => (a.count >= b.count ? a : b));
}

/**
 * Числа в круглых скобках в панели фильтров (подкатегории/варианты). Без дублей подряд.
 */
export function extractParenCountsFromTextBlock(text: string): number[] {
  const re = /\(([\d\s\u00a0\u202f]+)\)/g;
  const r: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parsePlInt(m[1] ?? '');
    if (Number.isFinite(v) && v > 0) r.push(v);
  }
  return r;
}

/** Suma z wierszy filtrów (label / linki z licznikiem w nawiasie na końcu). */
export async function sumFilterRowCounts(filter: Locator): Promise<{ sum: number; parts: number[] }> {
  const rowLoc = filter.locator('label, a[href*="/oferta/"], [role="treeitem"], li');
  const n = await rowLoc.count();
  const parts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (await rowLoc.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 500) continue;
    const paren = t.match(/\(([\d\s\u00a0\u202f]+)\)\s*$/);
    if (!paren) continue;
    const v = parsePlInt(paren[1] ?? '');
    if (Number.isFinite(v) && v > 0) parts.push(v);
  }
  return { sum: parts.reduce((a, b) => a + b, 0), parts };
}

/**
 * Сумма из фильтра: слева/боковая колонка с вложенностями.
 */
export async function getFilterBlockFirst(page: Page): Promise<Locator> {
  const candidates = [
    page.getByRole('complementary'),
    page.locator('[class*="filter" i]'),
    page.locator('aside'),
    page.locator('[id*="filter" i]'),
  ];
  for (const c of candidates) {
    const el = c.first();
    if ((await el.count().catch(() => 0)) > 0) {
      const t = (await el.innerText().catch(() => '')) ?? '';
      if (t.length > 20 && /\(.*\d.*\)/.test(t)) return el;
    }
  }
  return page.locator('body');
}

/**
 * «Итог» в шапке списка: «N produktów» / «Wyniki: N»
 */
export async function readListingTotalCount(page: Page): Promise<number | null> {
  const headerish = page.locator('h1, [class*="result" i], [class*="listing" i]').first();
  const t = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')) ?? '';
  const patterns = [
    /(\d[\d\s\u00a0\u202f]+)\s*produkt(ów|a)?/i,
    /Wynik(?:i)?:\s*(\d[\d\s\u00a0\u202f]+)/i,
    /znalezion[oa]\s*[:.]?\s*(\d[\d\s\u00a0\u202f]+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m?.[1]) {
      const v = parsePlInt(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  const ht = (await headerish.innerText().catch(() => '')) ?? '';
  if (ht) {
    const p = ht.match(/(\d[\d\s\u00a0\u202f]+)\s*$/);
    if (p?.[1]) {
      const v = parsePlInt(p[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

export async function clickFirstUsableListFilter(page: Page): Promise<void> {
  const block = await getFilterBlockFirst(page);
  const checkbox = block.locator('input[type="checkbox"]:not(:disabled)').first();
  if ((await checkbox.count()) > 0) {
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click({ force: true }).catch(() => checkbox.click());
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    return;
  }
  const other = block.getByRole('link', { name: /\(\d/ }).first();
  if ((await other.count().catch(() => 0)) > 0) {
    await other.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
}

export async function addToCartByIndex(page: Page, productIndex: number): Promise<void> {
  let cards = page
    .locator('[class*="product" i], [data-product], article, [class*="tile" i]')
    .filter({ hasText: /Dodaj|Koszy|zł/ });
  if ((await cards.count()) === 0) {
    cards = page.getByRole('listitem');
  }
  if ((await cards.count()) > productIndex) {
    const card = cards.nth(productIndex);
    const add = card
      .getByRole('button', { name: /Dodaj|Koszy|kupuj/i })
      .or(card.locator('a[href*="basket" i], a[href*="cart" i]'))
      .first();
    await add.scrollIntoViewIfNeeded();
    await add.click({ timeout: 20000 });
    return;
  }
  const btn = page.getByRole('button', { name: /Dodaj do koszyka|Dodaj|Koszy/i }).nth(productIndex);
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ timeout: 20000 });
}

export async function readListPricesForFirstProducts(
  page: Page,
  take: number,
): Promise<{ title: string; price: number }[]> {
  const cards = page
    .locator('[class*="product" i], [data-product], li[class*="item" i], article')
    .filter({ hasText: /zł/ });
  const n = await cards.count();
  const res: { title: string; price: number }[] = [];
  const limit = Math.min(take, n);
  for (let i = 0; i < limit; i++) {
    const c = cards.nth(i);
    const raw = (await c.innerText()).replace(/\s+/g, ' ');
    const zl = raw.match(/([\d\s\u00a0]+,?\d*)\s*zł/i);
    if (!zl) continue;
    const price = parsePlPrice(zl[1] ?? '');
    const title = (await c.locator('a, h2, h3, [class*="name" i]').first().textContent().catch(() => null)) || raw.slice(0, 80);
    if (Number.isFinite(price) && price > 0) res.push({ title: (title || '').trim(), price });
  }
  return res;
}

export async function readCartGrandTotal(page: Page): Promise<number> {
  const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const block = page.getByText(/Razem|Łącznie|Suma|Do zapłaty/i);
  if ((await block.count().catch(() => 0)) > 0) {
    const s = (await block.first().locator('xpath=..').innerText().catch(() => t)) || t;
    const m = s.match(/(?:Razem|Łącznie|Suma|zapłaty|Total)[\s:]*[\d\s\u00a0]*([\d\s\u00a0]+,?\d*)\s*zł/i);
    if (m?.[1]) {
      const v = parsePlPrice(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  const lastLine = t.match(/([\d\s\u00a0]+,?\d*)\s*zł\s*$/i);
  if (lastLine?.[1]) return parsePlPrice(lastLine[1]);
  return NaN;
}
