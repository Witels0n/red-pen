import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

// Seam: the production build output (what GitHub Pages serves).
// See docs/adr/0001-client-only-processing.md.
let outDir: string
let html: string

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'pdf-marker-build-'))
  await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  html = readFileSync(join(outDir, 'index.html'), 'utf8')
}, 60_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

function csp(): string {
  const m = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]*)"/i)
  expect(m, 'index.html has a CSP meta tag').not.toBeNull()
  return m![1].replaceAll('&#39;', "'").replaceAll('&apos;', "'")
}

describe('production build', () => {
  it('ships a CSP that forbids all network connections from the page', () => {
    expect(csp()).toMatch(/(^|;\s*)connect-src 'none'(;|$)/)
  })

  it('does not allow any remote origin in the CSP', () => {
    expect(csp()).not.toMatch(/https?:|\*/)
  })

  it('references no third-party origins in the HTML', () => {
    const urls = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)]
    expect(urls).toEqual([])
  })

  it('self-hosts the pdf.js worker', () => {
    const assets = readdirSync(join(outDir, 'assets'))
    expect(assets.some((f) => /^pdf\.worker.*\.mjs$/.test(f))).toBe(true)
  })

  it('serves assets under the GitHub Pages base path', () => {
    expect(html).toContain('/pdf-marker/assets/')
  })
})
