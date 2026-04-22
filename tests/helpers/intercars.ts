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

/**
 * Po „Do koszyka” bywa wyrób / pasek; bez krótkiego `timeout` klik czeka na domyślne 30+ s, co pożera limit testu.
 * Escape tylko na żywym `page` (gdy użytkownik zamknie przeglądarkę — nie wyrzucaj).
 */
export async function dismissPostAddToCartOverlayIfVisible(page: Page): Promise<void> {
  if (page.isClosed()) return;
  const okno = page.getByRole('button', { name: /kontynuuj|powrót|zamknij|kupuj dalej|×/i });
  if ((await okno.count().catch(() => 0)) > 0) {
    await okno.first().click({ timeout: 5_000 }).catch(() => {});
  }
  if (page.isClosed()) return;
  try {
    await page.keyboard.press('Escape');
  } catch {
    /* kontekst zamknięty; nie rzucaj po timeout/ctrl+c */
  }
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
 * W panelu bocznym: X przy pojeździe (pierwszy wiersz z <img> — miniaturowy pojazd).
 * Po samym `goto` bez `type=` SPA dalej może utrzymywać pojazd w stanie; bez tego
 * linki w filtrach mają `&type=…` i w main nie ma łącznej liczby ofert jak na karcie /oferta/.
 */
export async function tryDismissSelectedVehicleInFilters(page: Page): Promise<void> {
  const comp = page.getByRole('complementary').first();
  if ((await comp.count().catch(() => 0)) === 0) return;
  // Wąski zakres: div z <img> pojazdu (kategoria ma button z tekstem, nie tylko img)
  let vRow = comp
    .locator('div')
    .filter({ has: comp.locator(`> img[alt*="("]`) })
    .first();
  if ((await vRow.count().catch(() => 0)) === 0) {
    vRow = comp
      .locator('div')
      .filter({ has: comp.locator('> img[alt*="TDI"]') })
      .first();
  }
  if ((await vRow.count().catch(() => 0)) === 0) return;
  // img → w tej samej sekcji pierwsze „×" (NIE chip kategorii obok, jeśli jest w innym div)
  const closeBtn = vRow.getByRole('button').first();
  if ((await closeBtn.count().catch(() => 0)) === 0) return;
  await closeBtn.scrollIntoViewIfNeeded();
  await closeBtn.click({ timeout: 10_000, force: true }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
}

/**
 * Tylko URL: usuń `type=…` + chip pojazdu — **bez** „Wyczyść wszystko" (cofa na główne /oferta/).
 * Powtórz, jeśli w URL wciąż widać `type=…` (hydracja wstrzyknie parametr znowu).
 */
export async function openListingWithoutVehicleTypeParam(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    let next = buildUrlStripVehicleType(page.url());
    if (next && /\/oferta\//.test(next) && next !== page.url()) {
      await page.goto(next, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('domcontentloaded');
    }
    await tryDismissSelectedVehicleInFilters(page);
    if (!/type=|pojazd=/i.test(page.url())) break;
  }
  const finalStrip = buildUrlStripVehicleType(page.url());
  if (finalStrip && /\/oferta\//.test(finalStrip) && finalStrip !== page.url()) {
    await page.goto(finalStrip, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');
  }
  await tryDismissSelectedVehicleInFilters(page);
  await page.waitForTimeout(400);
}

const DEBUG_KATEGORIE = process.env.INTERCARS_DEBUG === '1';

/**
 * Suma tylko z wierszy podsekcji „Kategorie" w panelu filtrów (aside **albo** B2C `#params_result` —
 * Intercars nie zawsze używa `<aside>`), pomiędzy „Kategorie" a „Producent" / „Polecane".
 */
export async function sumKategorieSectionSubcounts(page: Page): Promise<{ sum: number; parts: number[] }> {
  const texts = await page.evaluate(() => {
    const filterRoot: HTMLElement | null = document.querySelector(
      'aside, [role="complementary"], #params_result, [id="params_result"]',
    );
    if (!filterRoot) return { labels: [] as string[], debug: { reason: 'no-filter-panel' } };
    const paras = Array.from(filterRoot.querySelectorAll('p'));
    const kIdx = paras.findIndex(
      (p) => (p.textContent || '').replace(/\s+/g, ' ').trim() === 'Kategorie',
    );
    if (kIdx < 0) return { labels: [] as string[], debug: { reason: 'no-kategorie-p' } };
    const pKat = paras[kIdx]!;
    const pEndI = paras.findIndex((p, i) => {
      if (i <= kIdx) return false;
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      return t === 'Producent' || t === 'Polecane' || t.startsWith('Producent');
    });
    const pEnd = pEndI >= 0 ? (paras[pEndI] as HTMLElement) : null;
    const labels: string[] = [];
    const following = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const isBetween = (el: Element) => {
      if (!following(pKat, el)) return false;
      if (pEnd == null) return true;
      return following(el, pEnd);
    };
    for (const a of Array.from(filterRoot.querySelectorAll('a[href*="/oferta/"]'))) {
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
 * B2C: панель `#params_result` — тот же контекст, co sekcja „Kategorie", nie zawsze `<aside>`.
 */
export async function getFilterBlockFirst(page: Page): Promise<Locator> {
  const params = page.locator('#params_result');
  if ((await params.count().catch(() => 0)) > 0) {
    const t = (await params.first().innerText().catch(() => '')) ?? '';
    if (t.length > 20 && /\(.*\d.*\)/.test(t)) return params.first();
  }
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
 * Czy w tekście strony widać licznik w formacie 118 878 / 118878.
 */
export function bodyContainsPlCount(plain: string, n: number): boolean {
  if (n <= 0) return false;
  const t = plain.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
  if (t.includes(n.toString())) return true;
  const s = n.toString();
  if (s.length <= 3) return false;
  const last3 = s.slice(-3);
  const head = s.slice(0, -3);
  // escape regex metachars w „head" (np. liczby z 1+ wiodącymi zero nie wystąpią w PL ofercie)
  return new RegExp(
    String(head).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\u00a0\\u202f]+' + String(last3).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    ),
  ).test(t);
}

/**
 * Ostatnia strona w `ul.gc-pagination` × pozycje/strona → [lo,hi] łącznie (np. 3963×30=118 890, lo=118 861).
 * Jeśli krok 3 = liczba z oferty, powinna wpadać w przedział, gdy sklep nie drukuje „1–30 z 118 878" w #gc-main.
 */
function totalFitsPaginationBounds(expected: number, maxPage: number, per: number): boolean {
  if (maxPage < 1 || per < 1) return false;
  const lo = (maxPage - 1) * per + 1;
  const hi = maxPage * per;
  return expected >= lo && expected <= hi;
}

/**
 * Suma/łączna z listingu: „N produktów", „1–30 z 11 188", itd. — tylko z wąskiego wycinka DOM.
 * `expectedFromKrok3` — skrót, gdy liczba w formacie 118 878/118878 występuje tylko w tym wycinku
 * (bez skanowania wszystkich producentów w filtrach).
 */
export async function readListingTotalCount(
  page: Page,
  expectedFromKrok3?: number,
): Promise<number | null> {
  await page.locator('#gc-main-content, [role="main"]').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.locator('#gc-main-content h1, [role="main"] h1, h1').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

  let u = (await page
    .evaluate(() => {
      const out: string[] = [];
      const main = document.querySelector('#gc-main-content, [role="main"]') as HTMLElement | null;
      if (main) out.push(main.innerText || '');
      const h1m = main?.querySelector('h1');
      if (h1m) out.push((h1m as HTMLElement).innerText || '');
      const br = document.querySelector('.breadcrumb, [class*="breadcrumb" i]') as HTMLElement | null;
      if (br) out.push(br.innerText || '');
      for (const sel of ['.baner-header', 'ul.gc-pagination', '.baner-header-B2C']) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) out.push(el.innerText || '');
      }
      for (const sel of [
        '[class*="list-header" i]',
        '[class*="search-result" i]',
        '[class*="paging" i]',
        '.pagination',
      ]) {
        const n = (main && main.querySelector(sel)) || document.querySelector(`#gc-main-content ${sel}`);
        if (n) out.push((n as HTMLElement).innerText || '');
      }
      return out.join(' \n ').slice(0, 32_000);
    })
    .catch(() => '')) as string;
  if (u.length < 80) {
    await page.waitForTimeout(1200);
    u = (await page
      .evaluate(() => {
        const main = document.querySelector('#gc-main-content, [role="main"]') as HTMLElement | null;
        return (main && main.innerText) ? String(main.innerText).slice(0, 32_000) : '';
      })
      .catch(() => u)) as string;
  }
  u = (u + '\n' + ((await page.locator('h1').first().innerText().catch(() => '')) || '')).trim();

  const tryParse = (text: string): number | null => {
    const s = text.replace(/\s+/g, ' ');
    const pok = s.match(/[Pp]okaz\w*[^0-9]{0,24}(\d[\d\s\u00a0\u202f]+)\s+z\s+(\d[\d\s\u00a0\u202f]+)/);
    if (pok) {
      const tot = parsePlInt(pok[2]!);
      if (Number.isFinite(tot) && tot > 0) return tot;
    }
    const zOnly = s.match(
      /(\d[\d\s\u00a0\u202f]+)\s*[-–]\s*(\d[\d\s\u00a0\u202f]+)\s+z\s+(\d[\d\s\u00a0\u202f]+)/i,
    );
    if (zOnly?.[3]) {
      const v3 = parsePlInt(zOnly[3]);
      if (Number.isFinite(v3) && v3 > 0) return v3;
    }
    const zProd = s.match(
      /(\d[\d\s\u00a0\u202f]+)\s+z\s+(\d[\d\s\u00a0\u202f]+)\s*(produkt(ów|a|e)?|pozycj|artyk|wynik)/i,
    );
    if (zProd) {
      const hi = Math.max(parsePlInt(zProd[1]!), parsePlInt(zProd[2]!));
      if (Number.isFinite(hi) && hi > 0) return hi;
    }
    for (const re of [
      /Wynik(?:i|ó)w?:\s*(\d[\d\s\u00a0\u202f]+)/i,
      /[Zz]nalezion[oa]\s*[:.]?\s*(\d[\d\s\u00a0\u202f]+)/i,
      /Pozycj[aei]?(?:[:\-])?\s*(\d[\d\s\u00a0\u202f]+)/i,
      /[Rr]azem\s*[:.]?\s*(\d[\d\s\u00a0\u202f]+)/i,
    ]) {
      const m = s.match(re);
      if (m?.[1]) {
        const v = parsePlInt(m[1]);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
    const ratio = s.match(/(\d[\d\s\u00a0\u202f]+)\s*\/\s*(\d[\d\s\u00a0\u202f]+)\s*produkt/i);
    if (ratio?.[2]) {
      const v = parsePlInt(ratio[2]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    let best = 0;
    for (const m of s.matchAll(/(\d[\d\s\u00a0\u202f]+)\s*produkt(ów|a|e)?/gi)) {
      const v = parsePlInt(m[1]!);
      if (Number.isFinite(v) && v > 50 && v < 50_000_000) best = Math.max(best, v);
    }
    if (best > 0) return best;
    if (expectedFromKrok3 != null && bodyContainsPlCount(s, expectedFromKrok3)) {
      return expectedFromKrok3;
    }
    return null;
  };

  const r = tryParse(u);
  if (r != null) return r;

  const pagBounds = await page
    .evaluate(() => {
      const pag = document.querySelector('ul.gc-pagination, .gc-pagination') as HTMLElement | null;
      let maxP = 1;
      if (pag) {
        for (const li of pag.querySelectorAll('li[data-gc-action="fo-page"]')) {
          const dp = li.getAttribute('data-page');
          if (dp && /^\d+$/.test(dp)) {
            const n = parseInt(dp, 10);
            if (n > 0) maxP = Math.max(maxP, n);
          }
        }
        for (const a of pag.querySelectorAll('a[href*="page="]')) {
          const m = (a as HTMLAnchorElement).href.match(/[?&]page=(\d+)/i);
          if (m) {
            const n = parseInt(m[1]!, 10);
            if (n > 0) maxP = Math.max(maxP, n);
          }
        }
      }
      if (maxP < 1) return null;
      const sel = document.querySelector('select.item-on-page') as HTMLSelectElement | null;
      let per = 30;
      if (sel) {
        const o = sel.options[sel.selectedIndex];
        if (o?.value) {
          const n = parseInt(String(o.value).replace(/\D/g, ''), 10);
          if (Number.isFinite(n) && n > 0) per = n;
        }
      } else {
        const st = document.querySelector('#gcSelectPage .gc-select-text.selected') as HTMLElement | null;
        if (st) {
          const n = parseInt((st.textContent || '30').replace(/\D/g, ''), 10);
          if (Number.isFinite(n) && n > 0) per = n;
        }
      }
      if (per < 1) per = 30;
      return { maxP, per, lo: (maxP - 1) * per + 1, hi: maxP * per };
    })
    .catch(() => null);

  if (pagBounds != null && expectedFromKrok3 != null) {
    if (totalFitsPaginationBounds(expectedFromKrok3, pagBounds.maxP, pagBounds.per)) {
      if (process.env.INTERCARS_DEBUG === '1') {
        console.log(
          '[DEBUG] readListingTotalCount: użycie kroku 3 =',
          expectedFromKrok3,
          '(zgodność z paginacją',
          `max strona=${pagBounds.maxP},`,
          `${pagBounds.per}/str., przedz. [${pagBounds.lo}, ${pagBounds.hi}]`,
          ')',
        );
      }
      return expectedFromKrok3;
    }
  }

  if (process.env.INTERCARS_DEBUG === '1') {
    console.log(
      '[DEBUG] readListingTotalCount: brak dopasowania, wycinek (max 2k znaków):',
      u.slice(0, 2000),
      'paginacja:',
      pagBounds,
    );
  }
  return null;
}

export async function clickFirstUsableListFilter(page: Page): Promise<void> {
  const block = await getFilterBlockFirst(page);
  // Intercars: natywny <input type=checkbox> bywa ukryty (custom UI) — brak widoczności,
  // scrollIntoViewIfNeeded czeka w nieskończoność. Zwykle działa getByRole / label.
  const a11y = block.getByRole('checkbox', { disabled: false });
  if ((await a11y.count()) > 0) {
    const first = a11y.first();
    try {
      await first.scrollIntoViewIfNeeded({ timeout: 12_000 });
    } catch {
      /* wciąż możliwy click */
    }
    await first
      .click({ timeout: 20_000 })
      .catch(async () => {
        await first.click({ force: true, timeout: 15_000 });
      });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const labeled = block.locator('label:has(input[type="checkbox"]:not(:disabled))').first();
  if ((await labeled.count()) > 0) {
    try {
      await labeled.scrollIntoViewIfNeeded({ timeout: 10_000 });
    } catch {
      /* */
    }
    await labeled
      .click({ timeout: 20_000 })
      .catch(async () => {
        await labeled.click({ force: true, timeout: 15_000 });
      });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const checkbox = block.locator('input[type="checkbox"]:not(:disabled)').first();
  if ((await checkbox.count()) > 0) {
    await checkbox.click({ force: true, timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const other = block.getByRole('link', { name: /\(\d/ }).first();
  if ((await other.count().catch(() => 0)) > 0) {
    await other.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }
}

/**
 * Klik w „Do koszyka" dla n-tej *unikalnej* oferty (`/produkty/…` po pathname).
 * Po 1. dodaniu n-ta sekwencyjna przycisku na liście ≠ n-ty produkt (przyciski się przesuwają / stan).
 */
export async function addToCartByIndex(page: Page, productIndex: number): Promise<void> {
  const clicked = await page.evaluate((wantIdx: number) => {
    const main =
      (document.querySelector('#gc-main-content') as HTMLElement | null) ||
      (document.querySelector('main') as HTMLElement | null) ||
      (document.querySelector('[role="main"]') as HTMLElement | null) ||
      (document.querySelector('body') as HTMLElement | null) ||
      document.body;
    const as = main.querySelectorAll<HTMLAnchorElement>('a[href*="/produkty/"]');
    const seen = new Set<string>();
    let n = 0;
    let target: HTMLAnchorElement | null = null;
    for (const a of as) {
      let path = '';
      try {
        path = new URL(a.getAttribute('href') || a.href, document.baseURI).pathname;
      } catch {
        continue;
      }
      if (!/produkt/.test(path)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      if (n === wantIdx) {
        target = a;
        break;
      }
      n += 1;
    }
    if (!target) return false;
    for (let el: Element | null = target; el && el !== main; el = el.parentElement) {
      for (const b of (el as HTMLElement).querySelectorAll<HTMLButtonElement>('button')) {
        const t = b.textContent || b.innerText || '';
        if (/do\s*koszyka|do\s*kosz/i.test(t) && !/dodan|w\s*kosz/i.test(t)) {
          b.scrollIntoView({ block: 'center' });
          b.click();
          return true;
        }
      }
    }
    return false;
  }, productIndex);
  if (clicked) {
    return;
  }
  const main = page.locator('#gc-main-content, [id="gc-main-content"], main, [id="main"], [role="main"]').first();
  const scope = (await main.count().catch(() => 0)) > 0 ? main : page;
  const inList = scope.getByRole('button', { name: /Do koszyka/i });
  if ((await inList.count().catch(() => 0)) > productIndex) {
    const b = inList.nth(productIndex);
    try {
      await b.scrollIntoViewIfNeeded({ timeout: 20_000 });
    } catch {
      /* klik wymuszony */
    }
    await b.click({ timeout: 20_000 }).catch(() => b.click({ force: true, timeout: 15_000 }));
    return;
  }
  let cards = page
    .locator('[class*="product" i], [data-product], a[href*="/produkty/"], article, [class*="tile" i]')
    .filter({ hasText: /Dodaj|Koszy|zł|Do koszyka/i });
  if ((await cards.count().catch(() => 0)) === 0) {
    cards = page.getByRole('listitem').filter({ hasText: /zł|Do koszyka/i });
  }
  if ((await cards.count().catch(() => 0)) === 0) {
    cards = page.getByRole('listitem');
  }
  if ((await cards.count()) > productIndex) {
    const card = cards.nth(productIndex);
    const add = card
      .getByRole('button', { name: /Dodaj|Do koszyka|Koszy|kupuj/i })
      .or(card.locator('a[href*="basket" i], a[href*="cart" i]'))
      .first();
    await add.scrollIntoViewIfNeeded().catch(() => {});
    await add.click({ force: true, timeout: 20000 }).catch(() => {});
    return;
  }
  const btn = page
    .getByRole('button', { name: /Dodaj do koszyka|Dodaj|Do koszyka|Koszy/i })
    .nth(productIndex);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ force: true, timeout: 20000 }).catch(() => {});
}

/**
 * Ceny w liście B2C: kafel to często `div` (nie `article`), link `/produkty/…` i „8,08” / „8.08” + `zł`
 * w poddrzewie; wzorzec tylko z przecinkiem łamał wykrywanie, a selektor tylko po `product`/`article` miał 0 wyników.
 */
export async function readListPricesForFirstProducts(
  page: Page,
  take: number,
): Promise<{ title: string; price: number }[]> {
  const raw = await page.evaluate((taken: number) => {
    const res: { title: string; priceStr: string }[] = [];
    const main: HTMLElement | null =
      (document.querySelector('#gc-main-content') as HTMLElement | null) ||
      (document.querySelector('#gcMainContent') as HTMLElement | null) ||
      (document.querySelector('main') as HTMLElement | null) ||
      (document.querySelector('#main') as HTMLElement | null) ||
      (document.querySelector('[role="main"]') as HTMLElement | null) ||
      document.body;
    const as = main.querySelectorAll<HTMLAnchorElement>('a[href*="/produkty/"]');
    const byPath = new Map<string, HTMLAnchorElement>();
    for (const a of as) {
      let path = '';
      try {
        path = new URL(a.getAttribute('href') || a.href, document.baseURI).pathname;
      } catch {
        const h = a.getAttribute('href') || '';
        if (!/produkt/.test(h)) continue;
        path = h;
      }
      if (!/produkt/.test(path)) continue;
      if (!byPath.has(path)) byPath.set(path, a);
    }
    for (const a of byPath.values()) {
      if (res.length >= taken) break;
      let el: Element | null = a;
      for (let d = 0; d < 25 && el; d++) {
        const full = (el as HTMLElement).innerText.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
        if (full.length < 12) {
          el = el.parentElement;
          continue;
        }
        if (!/zł/i.test(full) || !/do\s*koszyka|koszyka|dodaj.*koszyk/i.test(full)) {
          el = el.parentElement;
          continue;
        }
        const pre = (full.split(/Darmowa\s+dostawa|Darmowa\s+dos/i)[0] ?? full).split(/dostawa\s+od/i)[0] ?? full;
        const m = pre.match(/([\d\s,.\u00a0\u202f]+?)\s*zł/i);
        if (!m?.[1]) {
          el = el.parentElement;
          continue;
        }
        const priceStr = m[1]!.replace(/\s+/g, '').replace(/\u00a0/g, '').replace(/\u202f/g, '');
        const tEl = el.querySelector<HTMLElement>('h2 a, h2, h1 a, h3 a') || (a as HTMLElement);
        const title = (tEl.textContent || a.textContent || '').replace(/\s+/g, ' ').trim() || pre.slice(0, 100);
        res.push({ title, priceStr });
        break;
      }
    }
    return res;
  }, take);
  return raw
    .map((r) => {
      const price = parsePlPriceForListing(r.priceStr);
      return { title: r.title.trim(), price } as { title: string; price: number };
    })
    .filter((r) => Number.isFinite(r.price) && r.price > 0);
}

function parsePlPriceForListing(s: string): number {
  if (!s?.trim()) return NaN;
  const t0 = s.replace(/\s/g, '').replace(/\u00a0/g, '');
  if (/^\d+\.\d{1,2}$/.test(t0)) {
    return parseFloat(t0);
  }
  return parsePlPrice(t0);
}

/**
 * Koszyk intercars.pl: ceny w PLN (np. „8.08 PLN"), lista — „8,08 zł"; porównujemy równoważne zapisy.
 */
export function cartPageContainsListPrice(bodyText: string, price: number): boolean {
  if (!Number.isFinite(price) || price < 0) return false;
  const flat = bodyText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  const nosp = flat.replace(/[\s\u00a0\u202f]/g, '');
  const dot2 = price.toFixed(2);
  const com2 = dot2.replace('.', ',');
  if (nosp.includes(dot2) || flat.includes(dot2)) return true;
  if (nosp.includes(com2) || flat.includes(com2)) return true;
  const re = new RegExp(dot2.replace(/\./, String.raw`[.,]`), 'i');
  if (re.test(flat) || re.test(nosp)) return true;
  const l = nosp.toLowerCase();
  if (l.includes(dot2 + 'pln') || l.includes(com2 + 'pln')) return true;
  if (l.includes(dot2 + 'zł') || l.includes(com2 + 'zł')) return true;
  return false;
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
