# intercars.pl — QAE Playwright assignment

End-to-end test: catalog → largest category → filter sum check → one filter → two line items in cart → prices vs list + total (Polish shop UI, UI strings stay in PL).

## Requirements

- Node.js 18+
- `npm install`
- `npx playwright install chromium`

## Run

Assignment scenario only:

```bash
npx playwright test tests/intercars.assignment.spec.ts
# or
npm run test:assignment
```

All tests in `tests/`:

```bash
npm test
```

Headed (if CAPTCHA / wait page appears — complete manually, per spec):

```bash
npm run test:headed
```

HTML report:

```bash
npx playwright show-report
```

## Layout

- `tests/intercars.assignment.spec.ts` — main flow (All → see all, category, filters, cart assertions).
- `tests/helpers/intercars.ts` — cookies, vehicle query strip, subcategory sum, add-to-cart by product path, PL price parsing, cart text checks.

## Notes

- Menu labels are Polish (e.g. **WSZYSTKIE** / **Zobacz wszystkie** = *All* / *See all* in the task).
- Flaky automation is normal on production; if the title looks like a challenge / Cloudflare, the test will `test.skip` and you can retry in headed mode.
