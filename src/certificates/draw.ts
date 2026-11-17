// Drawing on a PDF page with the origin at the top left and y down, the way the layouts are
// worked out. Text is drawn either with the bundled fonts as vector outlines or with the PDF's
// standard Times fonts; both measure the same way, so fitting works for either.
import {
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import type { Measure } from './fit'
import type { OutlineFont } from './font/outline-font'
import type { Rect } from './layouts'

export type FontKey = 'script' | 'display' | 'sans' | 'sansBold' | 'sansItalic' | 'serif' | 'serifBold' | 'serifItalic'

/** The bundled fonts that are drawn as outlines. */
export type OutlineKey = 'script' | 'display' | 'sans' | 'sansBold' | 'sansItalic'
export type OutlineFonts = Record<OutlineKey, OutlineFont>

export interface DrawFont extends Measure {
  /** The text with characters the font cannot draw replaced or dropped. */
  encodable(text: string): string
  /** How far capitals rise above the baseline, as a share of the font size. */
  readonly capHeight: number
  /** Draws text with its baseline starting at (x, y) in PDF coordinates (y up). */
  drawAt(page: PDFPage, text: string, x: number, y: number, size: number, color: RGB): void
}

function outlineFont(font: OutlineFont, capHeight: number): DrawFont {
  return {
    capHeight,
    encodable: (t) => font.encodable(t),
    widthOf: (t, size) => font.widthOf(t, size),
    drawAt(page, text, x, y, size, color) {
      const path = font.svgPath(text, size)
      if (path) page.drawSvgPath(path, { x, y, color })
    },
  }
}

function standardFont(font: PDFFont): DrawFont {
  const supported = new Set(font.getCharacterSet())
  const encodable = (text: string) => {
    let out = ''
    for (const ch of text.normalize('NFC')) {
      if (supported.has(ch.codePointAt(0)!)) out += ch
      else if (/\s/.test(ch)) out += ' '
      else {
        const bare = ch.normalize('NFD').replace(/\p{M}/gu, '')
        if (bare && [...bare].every((b) => supported.has(b.codePointAt(0)!))) out += bare
      }
    }
    return out
  }
  return {
    capHeight: 0.66,
    encodable,
    widthOf: (t, size) => font.widthOfTextAtSize(encodable(t), size),
    drawAt(page, text, x, y, size, color) {
      const s = encodable(text)
      if (s) page.drawText(s, { x, y, size, font, color })
    },
  }
}

export type FontSet = Record<FontKey, DrawFont>

/** The fonts for one document: the bundled outlines plus the standard Times fonts embedded in it. */
export async function fontSet(doc: PDFDocument, outlines: OutlineFonts): Promise<FontSet> {
  const [serif, serifBold, serifItalic] = await Promise.all([
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanBold),
    doc.embedFont(StandardFonts.TimesRomanItalic),
  ])
  return {
    script: outlineFont(outlines.script, 0.5),
    display: outlineFont(outlines.display, 0.7),
    sans: outlineFont(outlines.sans, 0.68),
    sansBold: outlineFont(outlines.sansBold, 0.68),
    sansItalic: outlineFont(outlines.sansItalic, 0.68),
    serif: standardFont(serif),
    serifBold: standardFont(serifBold),
    serifItalic: standardFont(serifItalic),
  }
}

export type Align = 'left' | 'center' | 'right'

export interface StrokeStyle {
  color: RGB
  width?: number
  dash?: number[]
}

/** A PDF page seen with the origin at the top left, y down. */
export class Painter {
  constructor(
    readonly page: PDFPage,
    readonly fonts: FontSet,
  ) {}

  get width(): number {
    return this.page.getWidth()
  }

  get height(): number {
    return this.page.getHeight()
  }

  private y(top: number): number {
    return this.page.getHeight() - top
  }

  /** Draws one line of text with its baseline at `y` from the top. Returns the width drawn. */
  text(font: DrawFont, text: string, x: number, y: number, size: number, color: RGB, align: Align = 'left'): number {
    const s = font.encodable(text)
    if (!s) return 0
    const w = font.widthOf(s, size)
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    font.drawAt(this.page, s, left, this.y(y), size, color)
    return w
  }

  rect(r: Rect, fill?: RGB, stroke?: StrokeStyle): void {
    this.page.drawRectangle({
      x: r.x,
      y: this.y(r.y + r.height),
      width: r.width,
      height: r.height,
      ...(fill ? { color: fill } : {}),
      ...(stroke
        ? {
            borderColor: stroke.color,
            borderWidth: stroke.width ?? 1,
            ...(stroke.dash ? { borderDashArray: stroke.dash } : {}),
          }
        : { borderWidth: 0 }),
    })
  }

  /** A rectangle with rounded corners. */
  roundRect(r: Rect, radius: number, fill?: RGB, stroke?: StrokeStyle): void {
    const k = Math.min(radius, r.width / 2, r.height / 2)
    const c = k * 0.5523
    const { width: w, height: h } = r
    const path =
      `M${k} 0 L${w - k} 0 C${w - k + c} 0 ${w} ${k - c} ${w} ${k} L${w} ${h - k} ` +
      `C${w} ${h - k + c} ${w - k + c} ${h} ${w - k} ${h} L${k} ${h} C${k - c} ${h} 0 ${h - k + c} 0 ${h - k} ` +
      `L0 ${k} C0 ${k - c} ${k - c} 0 ${k} 0 Z`
    this.path(path, r.x, r.y, fill, stroke)
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: StrokeStyle): void {
    this.page.drawLine({
      start: { x: x1, y: this.y(y1) },
      end: { x: x2, y: this.y(y2) },
      color: stroke.color,
      thickness: stroke.width ?? 1,
      ...(stroke.dash ? { dashArray: stroke.dash } : {}),
    })
  }

  circle(cx: number, cy: number, r: number, fill?: RGB, stroke?: StrokeStyle): void {
    this.page.drawCircle({
      x: cx,
      y: this.y(cy),
      size: r,
      ...(fill ? { color: fill } : {}),
      ...(stroke ? { borderColor: stroke.color, borderWidth: stroke.width ?? 1 } : { borderWidth: 0 }),
    })
  }

  /** An SVG path (y down) drawn with its origin at (x, y) from the top left. */
  path(d: string, x: number, y: number, fill?: RGB, stroke?: StrokeStyle, scale = 1): void {
    this.page.drawSvgPath(d, {
      x,
      y: this.y(y),
      scale,
      ...(fill ? { color: fill } : {}),
      ...(stroke
        ? {
            borderColor: stroke.color,
            borderWidth: stroke.width ?? 1,
            ...(stroke.dash ? { borderDashArray: stroke.dash } : {}),
          }
        : {}),
    })
  }

  /** An image fitted inside a box, keeping its shape, centred across and aligned to `vAlign` down. */
  image(img: PDFImage, box: Rect, vAlign: 'top' | 'middle' | 'bottom' = 'middle'): Rect {
    const scale = Math.min(box.width / img.width, box.height / img.height)
    const w = img.width * scale
    const h = img.height * scale
    const x = box.x + (box.width - w) / 2
    const y = vAlign === 'top' ? box.y : vAlign === 'bottom' ? box.y + box.height - h : box.y + (box.height - h) / 2
    this.page.drawImage(img, { x, y: this.y(y + h), width: w, height: h })
    return { x, y, width: w, height: h }
  }

  /** Runs `draw` with everything turned upside down about the centre of `box`. */
  upsideDown(box: Rect, draw: () => void): void {
    const cx = box.x + box.width / 2
    const cy = this.y(box.y + box.height / 2)
    this.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(-1, 0, 0, -1, 2 * cx, 2 * cy))
    try {
      draw()
    } finally {
      this.page.pushOperators(popGraphicsState())
    }
  }
}

/** "#1f3a93" -> rgb. */
export function hex(colour: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim())
  const n = m ? parseInt(m[1], 16) : 0
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** A colour mixed with white: 0 is the colour, 1 is white. */
export function tint(c: RGB, amount: number): RGB {
  return rgb(c.red + (1 - c.red) * amount, c.green + (1 - c.green) * amount, c.blue + (1 - c.blue) * amount)
}
