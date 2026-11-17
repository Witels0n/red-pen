// Prints Answer sheets and Cover sheets with pdf-lib, drawing exactly what the layout says.
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib'
import { makeMatrix } from '../../qr/matrix'
import { layoutCoverSheet, layoutSheet } from './layout'
import type { CoverSpec, SheetGeometry, SheetSpec, TextItem } from './types'

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

const BLACK = rgb(0, 0, 0)
const OUTLINE = rgb(0.12, 0.12, 0.12)
const BUBBLE_STROKE = 0.8

/** Drop characters the standard (WinAnsi) fonts cannot encode, so unusual names never fail printing. */
function encodable(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...s].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
}

/** Shortens text with an ellipsis until it fits in maxWidth. */
export function fitText(font: PDFFont, text: string, size: number, maxWidth?: number): string {
  let s = encodable(font, text)
  if (maxWidth === undefined || font.widthOfTextAtSize(s, size) <= maxWidth) return s
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1)
  return `${s.trimEnd()}...`
}

function drawText(page: PDFPage, fonts: Fonts, t: TextItem): void {
  const font = t.bold ? fonts.bold : fonts.regular
  const text = fitText(font, t.text, t.size, t.maxWidth)
  const width = font.widthOfTextAtSize(text, t.size)
  const x = t.align === 'center' ? t.x - width / 2 : t.x
  const g = t.grey ?? 0
  page.drawText(text, { x, y: page.getHeight() - t.y, size: t.size, font, color: rgb(g, g, g) })
}

/** Draws the QR modules as merged horizontal runs: fewer PDF operators and no hairline gaps. */
function drawQr(page: PDFPage, g: SheetGeometry): void {
  const result = makeMatrix(g.qrPayload, 'M')
  if (!result.ok) throw new Error('The sheet code could not be made.')
  const { matrix } = result
  const m = g.qr.w / matrix.size
  const top = page.getHeight() - g.qr.y
  for (let r = 0; r < matrix.size; r++) {
    let c = 0
    while (c < matrix.size) {
      if (!matrix.isDark(r, c)) {
        c++
        continue
      }
      const start = c
      while (c < matrix.size && matrix.isDark(r, c)) c++
      // A hair of overlap between rows avoids white seams when the PDF is rasterised.
      page.drawRectangle({
        x: g.qr.x + start * m,
        y: top - (r + 1) * m - 0.05,
        width: (c - start) * m,
        height: m + 0.1,
        color: BLACK,
      })
    }
  }
}

/** Draws one laid-out page. Exported for tests that rasterise single pages. */
export function drawSheetPage(page: PDFPage, fonts: Fonts, g: SheetGeometry): void {
  const H = page.getHeight()
  for (const f of [...g.fiducials, g.orientationMark]) {
    page.drawRectangle({ x: f.x, y: H - f.y - f.h, width: f.w, height: f.h, color: BLACK })
  }
  drawQr(page, g)
  for (const t of g.texts) drawText(page, fonts, t)
  for (const l of g.lines) {
    page.drawLine({
      start: { x: l.x1, y: H - l.y1 },
      end: { x: l.x2, y: H - l.y2 },
      thickness: l.width,
      color: OUTLINE,
    })
  }
  for (const e of g.examples) page.drawCircle({ x: e.cx, y: H - e.cy, size: e.r, color: BLACK })

  const bubble = (b: { cx: number; cy: number; r: number; label: string }) => {
    page.drawCircle({ x: b.cx, y: H - b.cy, size: b.r, borderColor: OUTLINE, borderWidth: BUBBLE_STROKE })
    const size = 6.5
    const w = fonts.regular.widthOfTextAtSize(b.label, size)
    page.drawText(b.label, {
      x: b.cx - w / 2,
      y: H - b.cy - size * 0.35,
      size,
      font: fonts.regular,
      color: rgb(LETTER_GREY_VALUE, LETTER_GREY_VALUE, LETTER_GREY_VALUE),
    })
  }
  for (const q of g.questions) {
    const label = String(q.index + 1)
    const size = 9
    const w = fonts.bold.widthOfTextAtSize(label, size)
    page.drawText(label, { x: q.numberX - w, y: H - q.numberY, size, font: fonts.bold, color: BLACK })
    q.bubbles.forEach(bubble)
  }
  for (const col of g.idColumns) {
    const b = col.writeBox
    page.drawRectangle({ x: b.x, y: H - b.y - b.h, width: b.w, height: b.h, borderColor: OUTLINE, borderWidth: 0.6 })
    col.bubbles.forEach(bubble)
  }
}

/** Light grey for the letters inside bubbles: readable, but too faint to look like a mark. */
const LETTER_GREY_VALUE = 0.62

async function newDocument(title: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  return { doc, fonts }
}

async function render(geometries: SheetGeometry[], title: string): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(title)
  for (const g of geometries) drawSheetPage(doc.addPage([g.width, g.height]), fonts, g)
  return doc.save()
}

/** One PDF with every learner's Answer sheet, each learner's pages together and in order. */
export function renderAnswerSheetsPdf(specs: SheetSpec[]): Promise<Uint8Array> {
  if (specs.length === 0) throw new Error('There are no Answer sheets to print.')
  return render(specs.flatMap(layoutSheet), `${specs[0].title} answer sheets`)
}

/** One PDF with a Cover sheet per learner. */
export function renderCoverSheetsPdf(covers: CoverSpec[]): Promise<Uint8Array> {
  if (covers.length === 0) throw new Error('There are no Cover sheets to print.')
  return render(covers.map(layoutCoverSheet), 'Cover sheets')
}
