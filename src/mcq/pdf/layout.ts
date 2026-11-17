// Small typesetting helpers for the MCQ PDFs (pdf-lib, standard fonts, nothing remote): word
// wrapping, a flowing page writer with page breaks, and page footers.
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, type RGB } from 'pdf-lib'
import { A4_HEIGHT, A4_WIDTH, MM } from '../../shared/omr/layout'

export { A4_HEIGHT, A4_WIDTH, MM }

export interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
}

export const INK = rgb(0.1, 0.12, 0.16)
export const MUTED = rgb(0.38, 0.41, 0.46)
export const RULE = rgb(0.8, 0.82, 0.85)

export async function newDocument(title: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  doc.setLanguage('en-ZA')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
  return { doc, fonts }
}

const charsets = new WeakMap<PDFFont, Set<number>>()

/** Keeps only characters the standard (WinAnsi) fonts can draw, so unusual text never fails a PDF. */
export function encodable(font: PDFFont, s: string): string {
  let set = charsets.get(font)
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())))
  const plain = s.replace(/\t/g, ' ').replace(/[‐-―]/g, '-')
  return [...plain].filter((ch) => set.has(ch.codePointAt(0)!)).join('')
}

/** Splits text into lines no wider than `width`. Keeps the text's own line breaks; breaks very long words. */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of encodable(font, text).split(/\r\n|\r|\n/)) {
    const words = paragraph.split(/ +/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        // A word wider than the line: put as much as fits on its own line.
        if (line) {
          lines.push(line)
          line = ''
        }
        let cut = word.length - 1
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** Shortens text with "..." until it fits. */
export function fit(font: PDFFont, text: string, size: number, width: number): string {
  let s = encodable(font, text)
  if (font.widthOfTextAtSize(s, size) <= width) return s
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1)
  return `${s.trimEnd()}...`
}

export interface TextOptions {
  font?: PDFFont
  size?: number
  color?: RGB
  align?: 'left' | 'right' | 'center'
}

/** Draws one line with its baseline at y (measured from the top of the page, y down). */
export function text(page: PDFPage, fonts: Fonts, s: string, x: number, y: number, o: TextOptions = {}): void {
  const font = o.font ?? fonts.regular
  const size = o.size ?? 10
  const safe = encodable(font, s)
  const w = font.widthOfTextAtSize(safe, size)
  const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
  page.drawText(safe, { x: left, y: page.getHeight() - y, size, font, color: o.color ?? INK })
}

export function hline(page: PDFPage, x1: number, x2: number, y: number, thickness = 0.5, color = RULE): void {
  const H = page.getHeight()
  page.drawLine({ start: { x: x1, y: H - y }, end: { x: x2, y: H - y }, thickness, color })
}

/** A filled rectangle given from its top-left corner (y down). */
export function box(page: PDFPage, x: number, y: number, w: number, h: number, color: RGB): void {
  page.drawRectangle({ x, y: page.getHeight() - y - h, width: w, height: h, color })
}

export const MARGIN = 18 * MM
export const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN

/**
 * Writes downwards from the top margin, starting a new page (with `onNewPage` drawing its header)
 * whenever a block would not fit.
 */
export class Flow {
  page!: PDFPage
  y = 0
  readonly bottom = A4_HEIGHT - 20 * MM

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly onNewPage: (page: PDFPage) => number,
  ) {
    this.newPage()
  }

  newPage(): void {
    this.page = this.doc.addPage([A4_WIDTH, A4_HEIGHT])
    this.y = this.onNewPage(this.page)
  }

  /** Starts a new page unless `height` more points fit on this one. */
  ensure(height: number): void {
    if (this.y + height > this.bottom) this.newPage()
  }
}

/** "Page 2 of 5" centred at the foot of every page, with an optional label on the left. */
export function footers(doc: PDFDocument, fonts: Fonts, label = ''): void {
  const pages = doc.getPages()
  pages.forEach((page, i) => {
    const y = A4_HEIGHT - 10 * MM
    if (label) text(page, fonts, label, MARGIN, y, { size: 8, color: MUTED })
    text(page, fonts, `Page ${i + 1} of ${pages.length}`, A4_WIDTH - MARGIN, y, {
      size: 8,
      color: MUTED,
      align: 'right',
    })
  })
}
