// Small typesetting helpers for worksheet PDFs (pdf-lib, standard fonts, nothing remote). Every
// position is measured from the top-left of the page, y downwards, and converted when drawing.
import { LineCapStyle, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, type RGB } from 'pdf-lib'

export const MM = 72 / 25.4
export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89
export const MARGIN = 16 * MM
export const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN
export const BOTTOM = A4_HEIGHT - 16 * MM

export const INK = rgb(0.1, 0.12, 0.16)
export const MUTED = rgb(0.38, 0.41, 0.46)
export const RULE = rgb(0.72, 0.75, 0.79)
export const MEMO = rgb(0.78, 0.09, 0.15)
export const WHITE = rgb(1, 1, 1)

export interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
}

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

/** Keeps only characters the standard (WinAnsi) fonts can draw, so unusual text never breaks a PDF. */
export function encodable(font: PDFFont, s: string): string {
  let set = charsets.get(font)
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())))
  const plain = s.replace(/\t/g, ' ').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  return [...plain].filter((ch) => set.has(ch.codePointAt(0)!)).join('')
}

export function widthOf(font: PDFFont, s: string, size: number): number {
  return font.widthOfTextAtSize(encodable(font, s), size)
}

/** Splits text into lines no wider than `width`, keeping the text's own line breaks and breaking very long words. */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const paragraph of encodable(font, text).split(/\r\n|\r|\n/)) {
    const words = paragraph.split(/ +/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        if (line) {
          out.push(line)
          line = ''
        }
        let cut = word.length - 1
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--
        out.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) line = next
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

/** The largest size (down to `min`) at which text fits in `width`. */
export function fitSize(font: PDFFont, s: string, size: number, width: number, min = 6): number {
  let z = size
  while (z > min && widthOf(font, s, z) > width) z -= 0.5
  return z
}

export interface TextOptions {
  font: PDFFont
  size: number
  color?: RGB
  align?: 'left' | 'right' | 'center'
}

/** One line of text with its baseline at y. */
export function text(page: PDFPage, s: string, x: number, y: number, o: TextOptions): void {
  const safe = encodable(o.font, s)
  if (safe === '') return
  const w = o.font.widthOfTextAtSize(safe, o.size)
  const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
  page.drawText(safe, { x: left, y: page.getHeight() - y, size: o.size, font: o.font, color: o.color ?? INK })
}

export function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness = 0.6, color = RULE) {
  const H = page.getHeight()
  page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness, color })
}

/** A wide, rounded, see-through stroke: the highlighter in a word search memo. */
export function highlight(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness: number) {
  const H = page.getHeight()
  page.drawLine({
    start: { x: x1, y: H - y1 },
    end: { x: x2, y: H - y2 },
    thickness,
    color: MEMO,
    opacity: 0.22,
    lineCap: LineCapStyle.Round,
  })
}

/** A rectangle from its top-left corner. */
export function rect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: RGB; border?: RGB; borderWidth?: number } = {},
): void {
  page.drawRectangle({
    x,
    y: page.getHeight() - y - h,
    width: w,
    height: h,
    ...(o.fill ? { color: o.fill } : {}),
    ...(o.border ? { borderColor: o.border, borderWidth: o.borderWidth ?? 0.8 } : {}),
  })
}

export function circle(
  page: PDFPage,
  x: number,
  y: number,
  r: number,
  o: { fill?: RGB; border?: RGB; borderWidth?: number },
) {
  page.drawCircle({
    x,
    y: page.getHeight() - y,
    size: r,
    ...(o.fill ? { color: o.fill } : {}),
    ...(o.border ? { borderColor: o.border, borderWidth: o.borderWidth ?? 0.8 } : {}),
  })
}

export function ellipse(page: PDFPage, x: number, y: number, rx: number, ry: number, color: RGB, width = 1.2) {
  page.drawEllipse({ x, y: page.getHeight() - y, xScale: rx, yScale: ry, borderColor: color, borderWidth: width })
}

/**
 * Writes downwards from the top margin, starting a new page (with `onNewPage` drawing its running
 * header) whenever a block would not fit.
 */
export class Flow {
  page!: PDFPage
  y = 0

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly onNewPage: (page: PDFPage, first: boolean) => number,
  ) {
    this.page = doc.addPage([A4_WIDTH, A4_HEIGHT])
    this.y = onNewPage(this.page, true)
  }

  newPage(): void {
    this.page = this.doc.addPage([A4_WIDTH, A4_HEIGHT])
    this.y = this.onNewPage(this.page, false)
  }

  /** Room left on this page. */
  get room(): number {
    return BOTTOM - this.y
  }

  /** Starts a new page unless `height` more points fit on this one. */
  ensure(height: number): void {
    if (this.y + height > BOTTOM) this.newPage()
  }
}
