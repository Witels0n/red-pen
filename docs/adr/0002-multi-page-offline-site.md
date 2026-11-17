# Red Pen is a multi-page, offline-first site

The project grew from a single PDF marker into Red Pen, a set of tools for teachers. Each Tool is its own page in a Vite multi-page build (`index.html` for the landing page, `<tool>/index.html` for each Tool), sharing a header, design tokens and self-hosted fonts from `src/shared/`. We chose this over a single-page app with a router because the marker's markup moves across unchanged, each Tool loads only its own code, URLs are real and bookmarkable, and GitHub Pages serves it with no 404 workaround.

The site is a PWA: `vite-plugin-pwa` precaches every page and asset, so after one visit the whole site works offline and can be installed. A new version never reloads the page by itself, because that could wipe a test halfway through marking; the header offers a Reload button instead.

The site is served under `/red-pen/` (the base path is `BASE` in `vite.config.ts`, and its host is `ORIGIN`). At build time `seo.ts` writes the landing page's tool links into the HTML, adds search and share tags to every page, and emits `sitemap.xml` and `robots.txt`. Each Tool keeps its settings in local storage under its own `red-pen.<tool>.` key prefix.
