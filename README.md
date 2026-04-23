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

### Slow runs / timeouts

The suite avoids `networkidle` on intercars (analytics keep the network busy). Default test timeout is **5 minutes**. If something still fails:

```bash
npx playwright test tests/intercars.assignment.spec.ts --headed --trace on
npx playwright show-trace test-results/**/trace.zip
```

## Layout

- `tests/intercars.assignment.spec.ts` — main flow (All → see all, category, filters, cart assertions).
- `tests/helpers/intercars.ts` — cookies, vehicle query strip, subcategory sum, add-to-cart by product path, PL price parsing, cart text checks.

## Notes

- Menu labels are Polish (e.g. **WSZYSTKIE** / **Zobacz wszystkie** = *All* / *See all* in the task).
- If the site returns a challenge / wait page, the test **fails** with a clear error (not skipped). Use headed mode to pass CAPTCHA when needed.
