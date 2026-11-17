import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { BASE, ORIGIN, PAGES } from '../vite.config'
import { TOOLS } from '../src/landing/tools'
import { escapeHtml } from '../seo'

// Seam: the production build output (what GitHub Pages serves).
// See docs/adr/0001-client-only-processing.md and docs/adr/0002-multi-page-offline-site.md.
let outDir: string
const pages: Record<string, string> = {}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'red-pen-build-'))
  await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  for (const file of Object.values(PAGES)) pages[file] = readFileSync(join(outDir, file), 'utf8')
}, 60_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

function csp(html: string): string {
  const m = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]*)"/i)
  expect(m, 'page has a CSP meta tag').not.toBeNull()
  return m![1].replaceAll('&#39;', "'").replaceAll('&apos;', "'")
}

/** Every text file in the build, so no page, script or stylesheet can slip in a remote URL. */
function allTextFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(html|js|mjs|css|webmanifest)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

describe.each(Object.values(PAGES))('page %s', (file) => {
  it('ships a CSP that forbids all network connections from the page', () => {
    expect(csp(pages[file])).toMatch(/(^|;\s*)connect-src 'none'(;|$)/)
  })

  it('does not allow any remote origin in the CSP', () => {
    expect(csp(pages[file])).not.toMatch(/https?:|\*/)
  })

  it('allows the web app manifest', () => {
    expect(csp(pages[file])).toMatch(/(^|;\s*)manifest-src 'self'(;|$)/)
  })

  it('loads nothing from a third-party origin', () => {
    // Plain <a> links to other sites (GitHub) are navigation, not loading, so they are allowed.
    // A canonical link names the page's own public address; it loads nothing.
    const loads = [
      ...pages[file].matchAll(/<(?:script|link|img|iframe|source)\b[^>]*(?:src|href)="(?:https?:)?\/\/[^"]+"/g),
    ].filter((m) => !m[0].includes('rel="canonical"'))
    expect(loads).toEqual([])
  })

  it('has exactly one meta description', () => {
    expect(pages[file].match(/<meta\s+name="description"/g)).toHaveLength(1)
  })

  it('names its own public address as canonical and in its share tags', () => {
    const url = ORIGIN + BASE + file.replace(/index\.html$/, '')
    expect(pages[file]).toContain(`<link rel="canonical" href="${url}"`)
    expect(pages[file]).toContain(`<meta property="og:url" content="${url}"`)
    expect(pages[file]).toContain(`<meta property="og:image" content="${ORIGIN}${BASE}og-image.png"`)
  })

  it('carries valid JSON-LD', () => {
    const m = pages[file].match(/<script type="application\/ld\+json">([^<]*)<\/script>/)
    expect(m, 'page has a JSON-LD block').not.toBeNull()
    expect(JSON.parse(m![1])['@context']).toBe('https://schema.org')
  })

  it('serves assets under the GitHub Pages base path', () => {
    expect(pages[file]).toContain(`${BASE}assets/`)
    expect(pages[file]).toContain(`href="${BASE}manifest.webmanifest"`)
  })
})

describe('production build', () => {
  it('self-hosts the pdf.js worker', () => {
    const assets = readdirSync(join(outDir, 'assets'))
    expect(assets.some((f) => /^pdf\.worker.*\.mjs$/.test(f))).toBe(true)
  })

  it('self-hosts its fonts', () => {
    const assets = readdirSync(join(outDir, 'assets'))
    for (const family of ['bricolage-grotesque', 'atkinson-hyperlegible', 'gochi-hand']) {
      expect(assets.some((f) => f.startsWith(family) && f.endsWith('.woff2'))).toBe(true)
    }
  })

  it('references no remote font, script or stylesheet host anywhere', () => {
    const remote = /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs\./
    for (const path of allTextFiles(outDir)) expect(readFileSync(path, 'utf8'), path).not.toMatch(remote)
  })

  it('precaches every page and the pdf.js worker for offline use', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
    const urls = [...sw.matchAll(/"?url"?:\s*"([^"]+)"/g)].map((m) => m[1])
    for (const file of Object.values(PAGES)) expect(urls).toContain(file)
    expect(urls.some((u) => /^assets\/pdf\.worker.*\.mjs$/.test(u))).toBe(true)
  })

  it('leaves out the test-only pages that only the smoke build has', () => {
    const files = readdirSync(outDir, { recursive: true }).map(String)
    expect(files.filter((f) => /smoke|harness/.test(f))).toEqual([])
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
    expect(sw).not.toMatch(/smoke|harness/)
  })

  it('writes every tool link into the landing page, so it works without JavaScript', () => {
    for (const t of TOOLS) expect(pages['index.html']).toContain(`class="tool-card" href="${BASE}${t.path}"`)
  })

  it('writes "How it works" onto every Tool page', () => {
    for (const t of TOOLS) {
      const html = pages[`${t.path}index.html`]
      expect(html, t.name).toContain('<h2 id="tool-help-title">How it works</h2>')
      expect(html, t.name).toContain(escapeHtml(t.help.steps[0]))
    }
    expect(pages['index.html']).not.toContain('tool-help')
  })

  it('ships a sitemap of every page, and a robots.txt that points at it', () => {
    const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8')
    for (const file of Object.values(PAGES))
      expect(sitemap).toContain(`<loc>${ORIGIN}${BASE}${file.replace(/index\.html$/, '')}</loc>`)
    expect(sitemap).not.toMatch(/smoke|harness/)
    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).toContain(`Sitemap: ${ORIGIN}${BASE}sitemap.xml`)
  })

  it('ships the share image but leaves it out of the offline cache', () => {
    expect(readdirSync(outDir)).toContain('og-image.png')
    expect(readFileSync(join(outDir, 'sw.js'), 'utf8')).not.toContain('og-image.png')
  })

  it('ships a manifest scoped to the site', () => {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8'))
    expect(manifest.name).toBe('Red Pen')
    expect(manifest.scope).toBe(BASE)
    expect(manifest.start_url).toBe(BASE)
  })
})
