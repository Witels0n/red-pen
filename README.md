# Red Pen

Free tools for teachers. Every tool runs entirely in the browser: files are never uploaded, and each
page blocks itself from making network requests (see `docs/adr/0001-client-only-processing.md`).
After one visit the whole site works offline and can be installed as an app
(see `docs/adr/0002-multi-page-offline-site.md`).

Live at `https://witels0n.github.io/red-pen/`.

## Tools

| Tool           | Page                  | Source          |
| -------------- | --------------------- | --------------- |
| Mark a test    | `/red-pen/mark/`      | `src/mark/`     |
| Combine PDFs   | `/red-pen/combine/`   | `src/combine/`  |
| Split a PDF    | `/red-pen/split/`     | `src/split/`    |
| Organise pages | `/red-pen/organise/`  | `src/organise/` |
| Sign and fill  | `/red-pen/sign/`      | `src/sign/`     |
| QR codes       | `/red-pen/qr/`        | `src/qr/`       |

The landing page (`index.html`, `src/landing/`) lists them.

## Layout

```
index.html            landing page
mark/index.html       Mark a test
combine/index.html    Combine PDFs (likewise split/ and organise/)
qr/index.html         QR codes
sign/index.html       Sign and fill
src/shared/           header, design tokens, self-hosted fonts, ruled-paper style, offline (PWA)
src/shared/pdf/       shared PDF code: opening and checking a PDF, pdf.js setup, thumbnails,
                      file picker and drag and drop, reordering, downloads, the PDF Tools' styles
src/landing/          landing page code and the list of tools (tools.ts)
src/mark/             the marker
src/combine/, src/split/, src/organise/   the PDF Tools
src/qr/               the QR code maker (payloads, renderer, export, settings, editor)
src/sign/             Sign and fill (form fields, box detection in a Web Worker, signatures)
public/               icons (the web app manifest is generated in vite.config.ts)
design/icon.svg       source for the app icons
redirect/             the page that keeps the old /pdf-marker/ URL working (published separately)
```

## Adding a tool

1. Create `<tool>/index.html` and `src/<tool>/main.ts`. Call `mountSiteHeader({ toolName })` and
   `registerOffline(header)` from `src/shared/`, and give the open screen `class="paper"`.
2. Add the page to `PAGES` in `vite.config.ts`.
3. Add an entry to `TOOLS` in `src/landing/tools.ts`.

A Tool that works on PDFs can start from `startPdfTool()` and the modules in `src/shared/pdf/`
(see `src/split/` for a small example).

The build tests check that every page carries the CSP and is precached for offline use.

## Development

```
npm install
npm run dev          # dev server at http://localhost:5173/red-pen/
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
In the repo settings, set Pages source to "GitHub Actions". The site is served under `/red-pen/`
(`BASE` in `vite.config.ts`).
