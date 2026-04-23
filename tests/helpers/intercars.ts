import type { Page, Locator, Frame, Response } from '@playwright/test';

// Helpers for intercars.pl — PL number formats, filters, list vs cart (assignment flow).
// Locators are defensive; the DOM is noisy.

/** Polish int: "12 345" in parens, etc. */
export function parsePlInt(s: string): number {
  const d = s.replace(/[\s\u00a0]/g, '').replace(/\D/g, '');
  return d ? parseInt(d, 10) : NaN;
}

export function parsePlPrice(s: string): number {
  const t = s.replace(/\s/g, '').replace(/\u00a0/g, '').replace(',', '.');
  const m = t.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : NaN;
}

// PL cookie bar — best-effort, no throw
export async function acceptCookiesIfVisible(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /akceptuj|akceptuję|zgadzam|zaakceptuj|accept|accept all/i }).first();
  await btn.click({ timeout: 12000 }).catch(() => {});
}

/** SalesManago web push — `wpc_w` markup, no `role="dialog"`, often in an **iframe** (separate document). */
async function dismissSalesmanagoWebPushInContext(fr: Frame): Promise<void> {
  if (fr.isDetached()) return;
  const clicked = await fr
    .evaluate(() => {
      const b = document.querySelector('button.wpc_w_f_c_b-n, button[class*="wpc_w_f_c_b-n"]') as
        | HTMLButtonElement
        | null;
      if (b) {
        b.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (clicked) {
    return;
  }
  const nie = fr
    .locator('button.wpc_w_f_c_b-n, [class*="wpc_w_f_c_b-n"]')
    .or(fr.locator('.wpc_w_f, .wpc_w').getByRole('button', { name: 'NIE', exact: true }))
    .first();
  if ((await nie.count().catch(() => 0)) > 0) {
    await nie.click({ timeout: 3_000, force: true }).catch(() => {});
  }
}

async function dismissSalesmanagoWebPushEverywhere(page: Page): Promise<void> {
  if (page.isClosed()) return;
  let n = 0;
  for (const fr of page.frames()) {
    if (++n > 24) break;
    if (fr.isDetached()) continue;
    if (fr.url() === 'about:blank') continue;
    await dismissSalesmanagoWebPushInContext(fr);
  }
}

/** Promo / SalesManago / dialog "Nie przegap…" — close with NIE. Do not scan all `div,section`+hasText (PLP minute hangs). */
export async function dismissIntercarsPromoOrNewsletterIfVisible(page: Page): Promise<void> {
  if (page.isClosed()) return;
  for (let sm = 0; sm < 2; sm++) {
    await dismissSalesmanagoWebPushEverywhere(page);
    if (page.isClosed()) return;
    await page.waitForTimeout(150).catch(() => {});
  }
  const promoHeading = /nie\s+przegap|najnowszych\s+rabat|rabaty\s+i\s+promocj/i;
  for (let round = 0; round < 3; round++) {
    if (page.isClosed()) return;
    const byRole = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .filter({ hasText: promoHeading });
    if ((await byRole.count().catch(() => 0)) === 0) {
      break;
    }
    const shell = byRole.first();
    if (!(await shell.isVisible().catch(() => false))) {
      break;
    }
    const nie = shell
      .getByRole('button', { name: 'NIE', exact: true })
      .or(shell.getByRole('link', { name: 'NIE', exact: true }))
      .first();
    if ((await nie.count().catch(() => 0)) > 0) {
      await nie.click({ timeout: 4_000, force: true }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    if (!(await shell.isVisible().catch(() => true))) {
      break;
    }
    await page.waitForTimeout(250).catch(() => {});
  }
  if (page.isClosed()) return;
  const wpcHit = page.getByText(promoHeading, { exact: false }).first();
  if ((await wpcHit.count().catch(() => 0)) > 0 && (await wpcHit.isVisible().catch(() => false))) {
    await wpcHit
      .locator('xpath=ancestor::div[contains(@class,"wpc_w")][1]')
      .getByRole('button', { name: 'NIE', exact: true })
      .click({ force: true, timeout: 3_000 })
      .catch(() => {});
  }
  if (page.isClosed()) return;
  await dismissSalesmanagoWebPushEverywhere(page);
  await page.waitForTimeout(100).catch(() => {});
}

// After "Do koszyka" a modal can block; short timeout or click wait eats the whole test budget.
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
    /* page gone — ignore */
  }
}

// Cloudflare / "please wait" titles
export function isChallengeOrWaitPage(page: Page): Promise<boolean> {
  return page
    .title()
    .then((t) => /cierpliwo|cloudflare|just a moment|attention required|verify you are human/i.test(t));
}

/**
 * Does not use test.skip — a challenge page makes the test **fail** (visible in CI) instead of “skipped”.
 * Use headed + manual step if the site shows CAPTCHA (per assignment).
 */
export async function assertNotBlockedByChallenge(page: Page): Promise<void> {
  if (await isChallengeOrWaitPage(page)) {
    throw new Error(
      'Challenge or wait page (title matches Cloudflare / Cierpliwości / etc.). ' +
        'Run: npm run test:headed and complete any check, or retry from a normal browser session.',
    );
  }
}

// Strips `type=vehicle` from hrefs — Intercars embeds it in slugs, not only searchParams.
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

// Clicks the small [x] on the preselected car chip in the filter colum so totals match the category step.
export async function tryDismissSelectedVehicleInFilters(page: Page): Promise<void> {
  const comp = page.getByRole('complementary').first();
  if ((await comp.count().catch(() => 0)) === 0) return;
  // narrow: row with a car thumnail, not a category chip (typo: thumnail)
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
  const closeBtn = vRow.getByRole('button').first();
  if ((await closeBtn.count().catch(() => 0)) === 0) return;
  await closeBtn.scrollIntoViewIfNeeded();
  await closeBtn.click({ timeout: 10_000, force: true }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400).catch(() => {});
}

// URL-only cleanup + chip dismiss; do NOT "clear all" — that goes back to /oferta/ root and breaks counts.
export async function openListingWithoutVehicleTypeParam(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    let next = buildUrlStripVehicleType(page.url());
    if (next && /\/oferta\//.test(next) && next !== page.url()) {
      await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await tryDismissSelectedVehicleInFilters(page);
    if (!/type=|pojazd=/i.test(page.url())) break;
  }
  const finalStrip = buildUrlStripVehicleType(page.url());
  if (finalStrip && /\/oferta\//.test(finalStrip) && finalStrip !== page.url()) {
    await page.goto(finalStrip, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await tryDismissSelectedVehicleInFilters(page);
  await page.waitForTimeout(400).catch(() => {});
}

// Sum of subcategory counts under "Kategorie" (aside or #params_result); between Producent.
export async function sumKategorieSectionSubcounts(page: Page): Promise<{ sum: number; parts: number[] }> {
  const texts = await page.evaluate(() => {
    const filterRoot: HTMLElement | null = document.querySelector(
      'aside, [role="complementary"], #params_result, [id="params_result"]',
    );
    if (!filterRoot) return { labels: [] as string[] };
    const paras = Array.from(filterRoot.querySelectorAll('p'));
    const kIdx = paras.findIndex(
      (p) => (p.textContent || '').replace(/\s+/g, ' ').trim() === 'Kategorie',
    );
    if (kIdx < 0) return { labels: [] as string[] };
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
    return { labels };
  });
  const parts: number[] = [];
  for (const t of texts.labels) {
    const paren = t.match(/\(([\d\s\u00a0\u202f]+)\)\s*$/);
    if (!paren) continue;
    const v = parsePlInt(paren[1] ?? '');
    if (Number.isFinite(v) && v > 0) parts.push(v);
  }
  return { sum: parts.reduce((a, b) => a + b, 0), parts };
}

// All → see all: assignment menu path (PL labels: WSZYSTKIE, Zobacz wszystkie).
export async function openAllSeeAllCatalog(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await acceptCookiesIfVisible(page);
  await page.getByRole('link', { name: 'WSZYSTKIE' }).first().click();
  await page.getByRole('link', { name: 'Zobacz wszystkie' }).first().click();
  await page.waitForURL(/\/oferta\/?$|\/oferta\/?\?/);
  await page.waitForLoadState('domcontentloaded');
}

type CategoryRow = { count: number; name: string; loc: Locator };

// /oferta/ index: links with "(12345)"-style counts.
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
  if (!categories.length) throw new Error('No category with a count in parentheses');
  return categories.reduce((a, b) => (a.count >= b.count ? a : b));
}

// Pull (123) counts from a chunk of filter text; dedupe not applied here.
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

// Sum parenthetic counts in a generic filter block.
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

// First panel that looks like a filter (often #params_result, not a semantic aside).
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

// Whether body text has `n` with optional PL space grouping (e.g. 118 878).
export function bodyContainsPlCount(plain: string, n: number): boolean {
  if (n <= 0) return false;
  const t = plain.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
  if (t.includes(n.toString())) return true;
  const s = n.toString();
  if (s.length <= 3) return false;
  const last3 = s.slice(-3);
  const head = s.slice(0, -3);
  return new RegExp(
    String(head).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\u00a0\\u202f]+' + String(last3).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    ),
  ).test(t);
}

// Cross-check: category total from step 3 should sit inside (maxPage*per) window from paginator.
function totalFitsPaginationBounds(expected: number, maxPage: number, per: number): boolean {
  if (maxPage < 1 || per < 1) return false;
  const lo = (maxPage - 1) * per + 1;
  const hi = maxPage * per;
  return expected >= lo && expected <= hi;
}

// Parse the listing header / breadcrumb / pagination strip for a single "total products" number.
export async function readListingTotalCount(
  page: Page,
  expectedFromKrok3?: number,
): Promise<number | null> {
  await dismissIntercarsPromoOrNewsletterIfVisible(page);
  const mainLoc = page
    .locator('#gc-main-content, #gcMainContent, [id="gc-main-content"], [role="main"]')
    .first();
  await mainLoc.waitFor({ state: 'attached', timeout: 35_000 }).catch(() => {});
  await mainLoc.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await page
    .locator('#gc-main-content h1, #gcMainContent h1, [role="main"] h1, h1')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

  let u = (await page
    .evaluate(() => {
      const out: string[] = [];
      const main = (document.querySelector(
        '#gc-main-content, #gcMainContent, [id="gc-main-content"], [role="main"]',
      ) as HTMLElement | null);
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
  if (u.length < 80 && !page.isClosed()) {
    await page.waitForTimeout(400).catch(() => {});
    u = (await page
      .evaluate(() => {
        const main = document.querySelector(
          '#gc-main-content, #gcMainContent, [id="gc-main-content"], [role="main"]',
        ) as HTMLElement | null;
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
      return expectedFromKrok3;
    }
  }
  return null;
}

export async function clickFirstUsableListFilter(page: Page): Promise<void> {
  const block = await getFilterBlockFirst(page);
  // Native checkbox is often invisble — use role/label, not force-scroll to hidden <input>.
  const a11y = block.getByRole('checkbox', { disabled: false });
  if ((await a11y.count()) > 0) {
    const first = a11y.first();
    try {
      await first.scrollIntoViewIfNeeded({ timeout: 12_000 });
    } catch {
      /* scroll failed — click may still work */
    }
    await first
      .click({ timeout: 20_000 })
      .catch(async () => {
        await first.click({ force: true, timeout: 15_000 });
      });
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const labeled = block.locator('label:has(input[type="checkbox"]:not(:disabled))').first();
  if ((await labeled.count()) > 0) {
    try {
      await labeled.scrollIntoViewIfNeeded({ timeout: 10_000 });
    } catch {
      /* ignore */
    }
    await labeled
      .click({ timeout: 20_000 })
      .catch(async () => {
        await labeled.click({ force: true, timeout: 15_000 });
      });
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const checkbox = block.locator('input[type="checkbox"]:not(:disabled)').first();
  if ((await checkbox.count()) > 0) {
    await checkbox.click({ force: true, timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    return;
  }
  const other = block.getByRole('link', { name: /\(\d/ }).first();
  if ((await other.count().catch(() => 0)) > 0) {
    await other.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  }
}

/** After "Do koszyka": wait for cart-like response + toast, so the next `goto` does not race the first add. */
async function waitForPdpAddToCartSettled(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  const resOk = (r: Response) => {
    if (r.status() >= 400) {
      return false;
    }
    const u = r.url();
    if (!/intercars\.pl/i.test(u) || r.request().resourceType() === 'document') {
      return false;
    }
    return /basket|cart|kosz|dodaj|add[-_]?|graphql|\/api\//i.test(u);
  };
  await page.waitForResponse(resOk, { timeout: 12_000 }).catch(() => {});
  if (page.isClosed()) {
    return;
  }
  await page
    .getByText(/dodano|dodany|w\s+koszyku|kontynuuj|zamknij|powrót\s+do/i)
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
}

async function addToCartOnProductPage(page: Page, productPath: string): Promise<void> {
  const raw = (productPath.split('?')[0] || '').trim();
  if (!/produkt/i.test(raw)) {
    throw new Error(`addToCart: need a /produkty/… path, got: ${productPath}`);
  }
  const target = raw.startsWith('/') ? raw : `/${raw}`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await acceptCookiesIfVisible(page);
  await page.waitForTimeout(600).catch(() => {});
  await dismissIntercarsPromoOrNewsletterIfVisible(page);
  const pdpName = /Dodaj\s+do\s+koszyka|Dodaj\s*do\s*koszyka|Do\s*koszyka/i;
  const root = page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { level: 1 }) })
    .or(page.locator('#gc-main-content, #gcMainContent, [id="gc-main-content"]'))
    .first();
  await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await root.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
  await dismissIntercarsPromoOrNewsletterIfVisible(page);
  const cta = root
    .getByRole('button', { name: pdpName })
    .or(root.getByRole('link', { name: pdpName }))
    .or(page.getByRole('button', { name: pdpName }))
    .or(page.getByRole('link', { name: pdpName }));
  if ((await cta.count().catch(() => 0)) === 0) {
    const fallback = page
      .getByRole('main')
      .or(page.locator('#gc-main-content, #gcMainContent'))
      .first()
      .locator('a, button')
      .filter({ hasText: pdpName })
      .first();
    if ((await fallback.count().catch(() => 0)) > 0) {
      await fallback
        .click({ force: true, timeout: 15_000 })
        .catch(() => fallback.click({ force: true, timeout: 10_000 }).catch(() => {}));
    } else {
      await dismissIntercarsPromoOrNewsletterIfVisible(page);
      await page.waitForTimeout(500).catch(() => {});
      const cta2 = root
        .getByRole('button', { name: pdpName })
        .or(root.getByRole('link', { name: pdpName }))
        .or(page.getByRole('button', { name: pdpName }))
        .or(page.getByRole('link', { name: pdpName }));
      const fb2 = page
        .getByRole('main')
        .or(page.locator('#gc-main-content, #gcMainContent'))
        .first()
        .locator('a, button')
        .filter({ hasText: pdpName })
        .first();
      if ((await cta2.count().catch(() => 0)) > 0) {
        const b = cta2.first();
        await b
          .click({ force: true, timeout: 20_000 })
          .catch(() => b.click({ force: true, timeout: 12_000 }).catch(() => {}));
      } else if ((await fb2.count().catch(() => 0)) > 0) {
        await fb2
          .click({ force: true, timeout: 15_000 })
          .catch(() => fb2.click({ force: true, timeout: 10_000 }).catch(() => {}));
      } else {
        throw new Error(`addToCart: no add-to-basket control on ${target}`);
      }
    }
  } else {
    const b0 = cta.first();
    await b0
      .click({ force: true, timeout: 20_000 })
      .catch(() => b0.click({ force: true, timeout: 12_000 }).catch(() => {}));
  }
  await waitForPdpAddToCartSettled(page);
}

/** Same `productPath` as in `readListPricesForFirstProducts` — adds via **PDP** (stable; listing grid was unreliable). */
export async function addToCartByProductPath(page: Page, productPath: string): Promise<void> {
  await addToCartOnProductPage(page, productPath);
}

// first N offer rows with a parsable zł in an ancestor; returns productPath for the same row as price
export async function readListPricesForFirstProducts(
  page: Page,
  take: number,
): Promise<{ title: string; price: number; productPath: string }[]> {
  const raw = await page.evaluate((taken: number) => {
    const res: { title: string; priceStr: string; productPath: string }[] = [];
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
      let productPath = '';
      try {
        productPath = new URL(a.getAttribute('href') || a.href, document.baseURI).pathname;
      } catch {
        const h = a.getAttribute('href') || '';
        if (!/produkt/.test(h)) {
          productPath = '';
        } else {
          productPath = h.split('?')[0] ?? h;
        }
      }
      if (productPath && !/produkt/.test(productPath)) {
        productPath = '';
      }
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
        res.push({ title, priceStr, productPath });
        break;
      }
    }
    return res;
  }, take);
  const rows = raw
    .map((r) => {
      const price = parsePlPriceForListing(r.priceStr);
      return {
        title: r.title.trim(),
        price,
        productPath: (r.productPath || '').split('?')[0]!,
      } as { title: string; price: number; productPath: string };
    })
    .filter(
      (r) =>
        Number.isFinite(r.price) &&
        r.price > 0 &&
        r.productPath.length > 0 &&
        /produkt/i.test(r.productPath),
    );
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.productPath;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

function parsePlPriceForListing(s: string): number {
  if (!s?.trim()) return NaN;
  const t0 = s.replace(/\s/g, '').replace(/\u00a0/g, '');
  if (/^\d+\.\d{1,2}$/.test(t0)) {
    return parseFloat(t0);
  }
  return parsePlPrice(t0);
}

// Fuzzy match of list price in cart text (8.08 / 8,08 / thin spaces, PLN, etc).
export function cartPageContainsListPrice(bodyText: string, price: number, eps = 0.03): boolean {
  if (!Number.isFinite(price) || price < 0) return false;
  const flat = bodyText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  const nosp = flat
    .replace(/[\s\u00a0\u202f\u2007]/g, '')
    .replace(String.fromCharCode(0x00a0), '');
  const dot2 = price.toFixed(2);
  const com2 = dot2.replace('.', ',');
  if (nosp.includes(dot2) || flat.includes(dot2)) return true;
  if (nosp.includes(com2) || flat.includes(com2)) return true;
  const re = new RegExp(dot2.replace(/\./, String.raw`[.,]`), 'i');
  if (re.test(flat) || re.test(nosp)) return true;
  const l = nosp.toLowerCase();
  if (l.includes(dot2 + 'pln') || l.includes(com2 + 'pln')) return true;
  if (l.includes(dot2 + 'zł') || l.includes(com2 + 'zł')) return true;
  const forTokens = bodyText
    .replace(/[\s\u00a0\u202f\u2007]/g, ' ')
    .replace(/[·]/g, ',');
  for (const m of forTokens.matchAll(/\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}/g)) {
    const v = parsePlPrice(m[0]!);
    if (Number.isFinite(v) && Math.abs(v - price) <= eps) {
      return true;
    }
  }
  return false;
}

// "Do zapłaty" / Razem in PL; NaN if layout changed a lot
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
