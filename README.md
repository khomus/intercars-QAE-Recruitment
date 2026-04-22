# intercars-QAE-Recruitment

Playwright + TypeScript: test z treści rekrutacyjnej (Intercars.pl).

## Wymagania

- Node.js 18+
- `npm install`
- `npx playwright install chromium`

## Uruchomienie

Wszystkie testy (w tym dymkowy `example.spec.ts`):

```bash
npm test
```

Tylko scenariusz zadania:

```bash
npx playwright test tests/intercars.assignment.spec.ts
```

Tryb z otwartą przeglądarką (polecany przy captcha, challenge lub stronie „Cierpliwości”):

```bash
npm run test:headed
```

Raport HTML po uruchomieniu:

```bash
npx playwright show-report
```

## Uwagi

- Interfejs serwisu jest po polsku (np. menu **WSZYSTKIE** → **Zobacz wszystkie** odpowiada opisowi *All* → *See all* w zadaniu).
- Jeśli pojawi się **CAPTCHA** lub weryfikacja — dokończ ją ręcznie w trybie `test:headed` (zgodnie z treścią zadania).
- Zautomatyzowana przeglądarka może dostać stronę oczekiwania / Cloudflare: uruchom ponownie w trybie headed albo w zwykłej sesji; test zgłosi `test.skip` z krótkim powodem, jeśli tytuł strony wskazuje na blokadę.

## Struktura

- `tests/intercars.assignment.spec.ts` — główny scenariusz.
- `tests/helpers/intercars.ts` — akceptacja cookies, wybór kategorii, filtry, koszyk, parsowanie cen w PLN.
