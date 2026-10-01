# pdf-marker

Lightweight, minimalist tool for marking scanned PDF tests: click for ticks, right-click for crosses, drag in subtotals and text.

Learner PDFs never leave the browser; see `docs/adr/0001-client-only-processing.md`.

## Development

```
npm install
npm run dev          # dev server at http://localhost:5173/pdf-marker/
npm run build        # type-check + production build into dist/
```

## Tests

```
npm test             # Vitest (fast, no browser): unit tests and build-output checks
npm run test:smoke   # Playwright browser smoke tests against the production build
```

The smoke tests need a browser once: `npx playwright install chromium`.
Vitest tests live in `tests/`, Playwright specs in `smoke/`.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml` (test, build, publish to GitHub Pages).
In the repo settings, set Pages source to "GitHub Actions". The site is served under `/pdf-marker/`.
