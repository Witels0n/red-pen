import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/landing/tools'
import {
  escapeHtml,
  headTags,
  insertToolHelp,
  pageUrl,
  renderToolGroups,
  robotsTxt,
  sitemapXml,
  toolForPage,
} from '../seo'

const site = {
  origin: 'https://example.org',
  base: '/red-pen/',
  pages: { landing: 'index.html', mark: 'mark/index.html' },
}
const page = (head: string) => `<html><head><title>Mark a test · Red Pen</title>${head}</head><body></body></html>`
const attr = (tags: ReturnType<typeof headTags>, key: string, value: string) =>
  tags.find((t) => t.attrs?.[key] === value)?.attrs

describe('pageUrl', () => {
  it('turns a page file into its public address', () => {
    expect(pageUrl(site, 'index.html')).toBe('https://example.org/red-pen/')
    expect(pageUrl(site, 'mark/index.html')).toBe('https://example.org/red-pen/mark/')
  })
})

describe('headTags', () => {
  it("uses the Tool's blurb when the page has no description", () => {
    const tags = headTags(site, 'mark/index.html', page(''))
    expect(attr(tags, 'name', 'description')?.content).toBe(toolForPage('mark/index.html')!.blurb)
  })

  it("keeps a page's own description and does not add a second", () => {
    const tags = headTags(site, 'mark/index.html', page('<meta name="description" content="Mine &amp; yours" />'))
    expect(attr(tags, 'name', 'description')).toBeUndefined()
    expect(attr(tags, 'property', 'og:description')?.content).toBe('Mine & yours')
  })

  it('adds a canonical link and absolute share URLs', () => {
    const tags = headTags(site, 'mark/index.html', page(''))
    expect(attr(tags, 'rel', 'canonical')?.href).toBe('https://example.org/red-pen/mark/')
    expect(attr(tags, 'property', 'og:url')?.content).toBe('https://example.org/red-pen/mark/')
    expect(attr(tags, 'property', 'og:image')?.content).toBe('https://example.org/red-pen/og-image.png')
    expect(attr(tags, 'property', 'og:title')?.content).toBe('Mark a test · Red Pen')
  })

  it('describes a Tool as a free web application and the landing page as a website', () => {
    const ld = (file: string, html: string) =>
      JSON.parse(headTags(site, file, html).find((t) => t.tag === 'script')!.children as string)
    expect(ld('mark/index.html', page(''))).toMatchObject({
      '@type': 'WebApplication',
      name: 'Mark a test',
      offers: { price: '0' },
    })
    expect(ld('index.html', page('<meta name="description" content="Home" />'))['@type']).toBe('WebSite')
  })

  it('keeps JSON-LD from closing its script tag early', () => {
    const tags = headTags(site, 'index.html', page('<meta name="description" content="a &lt;/script&gt; b" />'))
    expect(tags.find((t) => t.tag === 'script')!.children).not.toContain('</script>')
  })

  it('refuses a page with no description and no Tool', () => {
    expect(() => headTags(site, 'index.html', page(''))).toThrow(/no meta description/)
  })
})

describe('renderToolGroups', () => {
  it('links every Tool under the base path', () => {
    const html = renderToolGroups(TOOLS, '/red-pen/')
    for (const t of TOOLS) expect(html).toContain(`href="/red-pen/${t.path}"`)
    expect(html.match(/class="tool-card"/g)).toHaveLength(TOOLS.length)
  })

  it('escapes names and blurbs', () => {
    const html = renderToolGroups(
      [
        {
          name: 'A <b>',
          blurb: 'x & "y"',
          path: 'a/',
          group: 'Classroom',
          help: { steps: ['', '', ''], questions: [] },
        },
      ],
      '/',
    )
    expect(html).toContain('<b>A &lt;b&gt;</b><span>x &amp; &quot;y&quot;</span>')
  })
})

describe('renderToolGroups ids', () => {
  it('gives every group divider its own id and colour', () => {
    const html = renderToolGroups(TOOLS, '/red-pen/')
    const ids = [...html.matchAll(/class="tool-group divider tab-(\d+)" id="([a-z-]+)"/g)]
    expect(ids.map((m) => Number(m[1]))).toEqual(ids.map((_, i) => i + 1))
    expect(new Set(ids.map((m) => m[2])).size).toBe(ids.length)
  })
})

describe('insertToolHelp', () => {
  const mark = toolForPage('mark/index.html')!
  const openError = '<p id="open-error" class="error" role="alert" hidden></p>'

  it("goes under a file tool's drop zone, so it leaves with the opening screen", () => {
    const html = insertToolHelp(
      `<main><section id="open-screen">${openError}</section><section></section></main>`,
      mark,
    )
    expect(html.indexOf('class="tool-help"')).toBeGreaterThan(html.indexOf(openError))
    expect(html.indexOf('class="tool-help"')).toBeLessThan(html.indexOf('</section>'))
  })

  it("otherwise goes at the foot of the page, in the page's own column", () => {
    const html = insertToolHelp('<main><section><div class="intro-inner"></div></section></main>', mark)
    expect(html).toMatch(/<\/section><section class="tool-help tool-help-foot paper"[^>]*><div class="intro-inner">/)
    expect(html).toMatch(/<\/div><\/section><\/main>$/)
  })

  it('writes the three steps and both questions, escaped', () => {
    const tool = {
      ...mark,
      help: { steps: ['<one>', 'two', 'three'] as const, questions: [{ q: 'Q & A?', a: 'Yes' }] },
    }
    const html = insertToolHelp('<main><div class="intro-inner"></div></main>', tool)
    expect(html.match(/<li>/g)).toHaveLength(3)
    expect(html).toContain('&lt;one&gt;')
    expect(html).toContain('Q &amp; A?</dt><dd>Yes</dd>')
  })

  it('refuses a page with no place to put it', () => {
    expect(() => insertToolHelp('<div></div>', mark)).toThrow(/<\/main>/)
  })
})

describe('sitemap and robots', () => {
  it('lists each URL once', () => {
    const xml = sitemapXml(['https://example.org/a/', 'https://example.org/b/'])
    expect(xml.match(/<loc>/g)).toHaveLength(2)
    expect(xml).toContain('<loc>https://example.org/a/</loc>')
  })

  it('points robots.txt at the sitemap', () => {
    expect(robotsTxt('https://example.org/sitemap.xml')).toContain('Sitemap: https://example.org/sitemap.xml')
  })

  it('escapes XML', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b')
  })
})
