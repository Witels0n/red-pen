import type { HtmlTagDescriptor, Plugin } from 'vite'
import { TOOLS, groupTools, type Tool } from './src/landing/tools.ts'

/** Where the site lives on the web, and every page in it (as in PAGES in vite.config.ts). */
export interface Site {
  /** Scheme and host, no trailing slash, e.g. "https://witels0n.github.io". */
  origin: string
  /** Base path, starting and ending in a slash, e.g. "/red-pen/". */
  base: string
  pages: Record<string, string>
}

const SITE_NAME = 'Red Pen'
/** The link-preview image, served from public/. 1200 by 630, as Open Graph expects. */
export const SHARE_IMAGE = 'og-image.png'
const LANDING_PLACEHOLDER = '<div id="tool-groups"></div>'
const TICK_PATH = '<path pathLength="1" d="M5 16 L12 23 L26 5" />'
const TICK = `<svg class="tick" viewBox="0 0 30 30" aria-hidden="true">${TICK_PATH}</svg>`
/** A hand-drawn red-pen ring, drawn around each step number as it scrolls into view. */
const RING =
  '<svg class="help-ring" viewBox="0 0 44 42" aria-hidden="true">' +
  '<path pathLength="1" d="M28 5 C 12 3, 3 13, 5 24 C 7 35, 23 40, 34 34 C 43 28, 42 11, 30 6 C 25 4, 19 5, 15 8" /></svg>'
/** On a file tool's opening screen the help goes right under the drop zone, so it leaves with that screen. */
const OPEN_ERROR = '<p id="open-error" class="error" role="alert" hidden></p>'

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** The public address of a page file, e.g. "mark/index.html" becomes ".../red-pen/mark/". */
export function pageUrl(site: Site, file: string): string {
  return site.origin + site.base + file.replace(/index\.html$/, '')
}

/** The Tool a page file belongs to, or undefined for the landing page. */
export function toolForPage(file: string, tools: readonly Tool[] = TOOLS): Tool | undefined {
  return tools.find((t) => `${t.path}index.html` === file)
}

/** The id of a tool group's divider on the landing page, e.g. "Set and mark" becomes "set-and-mark". */
export function groupId(group: string): string {
  return group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The landing page's tool cards as plain HTML, so crawlers and link previews see every link.
 * Each group is a coloured divider in the folder, its name written on the divider's tab
 * (src/landing/binder.ts turns the dividers into tabs to click through).
 */
export function renderToolGroups(tools: readonly Tool[], base: string): string {
  return groupTools(tools)
    .map(
      ({ group, tools }, i) =>
        `<section class="tool-group divider tab-${i + 1}" id="${groupId(group)}">` +
        `<h3 class="tab"><span>${escapeHtml(group)}</span></h3><div class="tool-grid" data-reveal>` +
        tools
          .map(
            (t) =>
              `<a class="tool-card" href="${escapeHtml(base + t.path)}">${TICK}` +
              `<b>${escapeHtml(t.name)}</b><span>${escapeHtml(t.blurb)}</span></a>`,
          )
          .join('') +
        '</div></section>',
    )
    .join('')
}

/** A Tool's "How it works" steps and questions, as HTML. */
function renderToolHelpBody(tool: Tool): string {
  const steps = tool.help.steps
    .map(
      (step, i) =>
        `<li><span class="help-num">${i + 1}${RING}</span><span class="help-text">${escapeHtml(step)}</span></li>`,
    )
    .join('')
  const questions = tool.help.questions
    .map(
      ({ q, a }) =>
        `<div><dt><svg class="help-tick" viewBox="0 0 30 30" aria-hidden="true">${TICK_PATH}</svg>${escapeHtml(q)}</dt>` +
        `<dd>${escapeHtml(a)}</dd></div>`,
    )
    .join('')
  return (
    `<h2 id="tool-help-title">How it works</h2><ol class="help-steps" data-reveal>${steps}</ol>` +
    `<h2>Questions</h2><dl class="help-faq" data-reveal>${questions}</dl>`
  )
}

/**
 * Puts a Tool's help on its page. On a file tool it goes right under the drop zone, so it leaves
 * with the opening screen. Otherwise it is a ruled-paper band at the foot of the page that uses
 * the page's own .intro-inner column, so it lines up with the band at the top.
 */
export function insertToolHelp(html: string, tool: Tool): string {
  const body = renderToolHelpBody(tool)
  if (html.includes(OPEN_ERROR)) {
    return html.replace(
      OPEN_ERROR,
      `${OPEN_ERROR}<section class="tool-help" aria-labelledby="tool-help-title">${body}</section>`,
    )
  }
  if (html.split('</main>').length !== 2) throw new Error(`${tool.path}index.html needs exactly one </main>`)
  if (!html.includes('class="intro-inner"')) throw new Error(`${tool.path}index.html has no .intro-inner column`)
  return html.replace(
    '</main>',
    `<section class="tool-help tool-help-foot paper" aria-labelledby="tool-help-title">` +
      `<div class="intro-inner">${body}</div></section></main>`,
  )
}

function readTitle(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/)
  if (!m) throw new Error('page has no <title>')
  return unescapeHtml(m[1].trim())
}

function readDescription(html: string): string | undefined {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/)
  return m ? unescapeHtml(m[1]) : undefined
}

/** JSON for a <script type="application/ld+json"> block, safe to place inside HTML. */
function jsonLd(data: object): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}

function structuredData(site: Site, file: string, title: string, description: string): object {
  const home = site.origin + site.base
  const tool = toolForPage(file)
  if (!tool) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: home,
      description,
      inLanguage: 'en-ZA',
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.name,
    alternateName: title,
    url: pageUrl(site, file),
    description,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires a modern web browser with JavaScript',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'ZAR' },
    inLanguage: 'en-ZA',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: home },
  }
}

/** Search and link-preview tags for one page: description, canonical, Open Graph, Twitter and JSON-LD. */
export function headTags(site: Site, file: string, html: string): HtmlTagDescriptor[] {
  const title = readTitle(html)
  const existing = readDescription(html)
  const description = existing ?? toolForPage(file)?.blurb
  if (!description) throw new Error(`${file} has no meta description and is not a Tool with a blurb`)
  const url = pageUrl(site, file)
  const image = site.origin + site.base + SHARE_IMAGE
  const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' })

  return [
    ...(existing ? [] : [meta({ name: 'description', content: description })]),
    { tag: 'link', attrs: { rel: 'canonical', href: url }, injectTo: 'head' },
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: SITE_NAME }),
    meta({ property: 'og:locale', content: 'en_ZA' }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: description }),
    meta({ property: 'og:url', content: url }),
    meta({ property: 'og:image', content: image }),
    meta({ property: 'og:image:width', content: '1200' }),
    meta({ property: 'og:image:height', content: '630' }),
    meta({ property: 'og:image:alt', content: 'Red Pen: free tools for teachers that run in your browser' }),
    meta({ name: 'twitter:card', content: 'summary_large_image' }),
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      children: jsonLd(structuredData(site, file, title, description)),
      injectTo: 'head',
    },
  ]
}

export function sitemapXml(urls: readonly string[]): string {
  const entries = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

export function robotsTxt(sitemapUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`
}

/** The page file a request or build path points at, e.g. "/red-pen/mark/" becomes "mark/index.html". */
function pageFile(site: Site, path: string): string {
  let file = path.split('?')[0].replace(/^\//, '')
  if (file.startsWith(site.base.slice(1))) file = file.slice(site.base.length - 1)
  if (file === '' || file.endsWith('/')) file += 'index.html'
  return file
}

/**
 * Makes every page findable: search and share tags in each head, the landing page's tool links
 * as real HTML, and a sitemap.xml and robots.txt in the build. Test-only pages are left alone.
 */
export function seo(site: Site): Plugin {
  const known = new Set(Object.values(site.pages))
  return {
    name: 'red-pen-seo',
    transformIndexHtml(html, ctx) {
      const file = pageFile(site, ctx.path)
      if (!known.has(file)) return html
      if (file === 'index.html') {
        if (!html.includes(LANDING_PLACEHOLDER)) throw new Error(`index.html has no ${LANDING_PLACEHOLDER}`)
        html = html.replace(LANDING_PLACEHOLDER, `<div id="tool-groups">${renderToolGroups(TOOLS, site.base)}</div>`)
      }
      const tool = toolForPage(file)
      if (tool) html = insertToolHelp(html, tool)
      return { html, tags: headTags(site, file, html) }
    },
    generateBundle() {
      const urls = Object.values(site.pages).map((f) => pageUrl(site, f))
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(urls) })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robotsTxt(site.origin + site.base + 'sitemap.xml'),
      })
    },
  }
}
