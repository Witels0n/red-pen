# Red Pen

[![Deploy](https://github.com/Witels0n/red-pen/actions/workflows/deploy.yml/badge.svg)](https://github.com/Witels0n/red-pen/actions/workflows/deploy.yml)
[![CI](https://github.com/Witels0n/red-pen/actions/workflows/ci.yml/badge.svg)](https://github.com/Witels0n/red-pen/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Free tools for teachers: marking, MCQ assessments, PDFs, QR codes and class lists.

**[witels0n.github.io/red-pen](https://witels0n.github.io/red-pen/)**

Red Pen is a static web app with no backend. Every file a teacher opens is processed in their own
browser and never uploaded. Each page ships a Content Security Policy with `connect-src 'none'`,
so the browser itself refuses any network request the page might make. After one visit the whole
site works offline and can be installed as an app.

## Tools

| Tool               | What it does                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Mark a test**    | Ticks, crosses, reasons, subtotals, totals and notes on a scanned test; exports a marked PDF.         |
| **MCQ assessments** | Builds a multiple-choice test (with optional pictures), prints one shared shuffled paper and answer sheets for a class list or pasted names, reads scans, and gives a marksheet and item analysis. |
| **Cover sheets**   | A QR cover sheet per learner from a class list, so a batch scan splits into one PDF per learner.      |
| **Markbook builder** | Designs a markbook (assessments, weights, Categories, CAPS levels, class summary) and downloads an .xlsx with live Excel formulas. |
| **Question paper grid** | Analysis grid for a paper: marks per cognitive level (CAPS, Bloom's, Barrett's or custom) and topic against targets, a level by topic matrix, and a one-page PDF or Excel file for the HoD. |
| **Combine PDFs**   | Joins several PDFs into one, in a chosen order.                                                       |
| **Split a PDF**    | Splits by page, every N pages, at cover sheets (named per learner) or custom ranges; downloads a zip. |
| **Organise pages** | Rotates, reorders and deletes pages, storing rotation in the PDF rather than redrawing pages.         |
| **Photos to PDF**  | Phone photos to a PDF: crop corners with perspective correction, scan looks, reorder; or a PDF per learner in a zip. |
| **Booklet printing** | A5 booklets in the right order for double-sided printing, 2 to 9 pages per sheet, or copies of a page with cut lines. |
| **Compress a PDF** | Shrinks scanned PDFs by redrawing pages as JPEG pictures, several files at once, with an optional target size. |
| **Sign and fill**  | Fills PDF form fields, detects lines and boxes on scanned forms, and adds dates and a signature.      |
| **QR codes**       | Links, Wi-Fi, email and contact cards, with colours, module shapes, a logo, and PNG or SVG export.    |
| **Class lists**    | Class lists from typed names, numbers only, or CSV/XLSX import; stored only on the device.            |
| **Class picker**   | A fair spinning wheel (learners or custom options) and random groups with rules, locks and a projector view. |

## Privacy by design

- **No server.** The site is static files on GitHub Pages. There is no API, database, analytics or
  third-party script.
- **Enforced, not promised.** The CSP blocks every connection, remote script, stylesheet and font.
  Build tests fail if any page loses the policy or references a remote host.
- **Self-hosted everything.** Fonts, pdf.js and its worker, and all libraries are bundled.
- **Minimal storage.** Settings live in `localStorage` under `red-pen.<tool>.` keys. Class lists,
  MCQ assessments (with their results, never the scans) and question paper grids live in IndexedDB on the device. A signature is stored only if the teacher opts in.

Details and trade-offs: [ADR 0001](docs/adr/0001-client-only-processing.md).

## Architecture

- **Vite multi-page app** in strict TypeScript with no UI framework. Each tool is its own HTML
  entry point and loads only its own code ([ADR 0002](docs/adr/0002-multi-page-offline-site.md)).
- **Shared layer** (`src/shared/`): site header, design tokens with light and dark themes,
  self-hosted fonts, the offline service worker, PDF helpers and class list storage.
- **PDF stack:** [pdf.js](https://mozilla.github.io/pdf.js/) for rendering and
  [pdf-lib](https://pdf-lib.js.org/) for writing.
- **Offline:** [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox) precaches every page
  and asset. Updates are offered, never forced, so work in progress is never lost.

```
index.html, <tool>/index.html   page entry points (landing page and one per tool)
src/landing/                    landing page and the tool registry (tools.ts)
src/shared/                     header, tokens, fonts, PWA, shared PDF and class list modules
src/<tool>/                     one folder per tool
tests/                          Vitest unit and build-output tests
smoke/                          Playwright browser tests against the production build
docs/adr/                       architecture decision records
docs/specs/                     feature specifications
GLOSSARY.md                     domain language used in code and UI
```

## Development

Requires Node.js 22 or later.

```sh
npm install
npm run dev            # http://localhost:5173/red-pen/
npm run build          # type check and production build into dist/
npm run preview        # serve the production build
```

## Quality checks

```sh
npm run check          # type check, formatting and unit tests
npm run test:smoke     # Playwright browser tests (run `npx playwright install chromium` once)
npm run format         # apply Prettier formatting
```

CI runs both suites on every pull request. Pushing to `main` runs the checks, builds and deploys to
GitHub Pages.

## Adding a tool

1. Create `<tool>/index.html` and `src/<tool>/main.ts`. Call `mountSiteHeader({ toolName })` and
   `registerOffline(header)` from `src/shared/`, and give the open screen `class="paper"`.
   PDF tools can start from `startPdfTool()` in `src/shared/pdf/`.
2. Register the page in `PAGES` in `vite.config.ts`.
3. Add an entry to `TOOLS` in `src/landing/tools.ts`.

The build tests then check that the new page carries the CSP and is precached for offline use.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security
or privacy concerns privately as described in [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE)
