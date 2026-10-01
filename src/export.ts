import { LineCapStyle, PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib'
import { CROSS_STROKES, INK, REASON_TAG, STROKE_WIDTH, TICK_POINTS } from './annotation-geometry'
import type { Annotation } from './marking-model'

// Export: draws the Annotations in red as flattened vector graphics over the original pages.
// Extending: add a drawer for the new type to `drawers`; the compiler enforces completeness.

export interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert a position in displayed page units (origin top-left of the visible page, y down,
 * as the viewer uses) to PDF user space (bottom-left origin, offset by the page box, undone
 * for the page's /Rotate). `box` is the unrotated visible box (CropBox, else MediaBox).
 */
export function toPageSpace(
  box: PageBox,
  rotation: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
  switch (r) {
    case 90:
      return { x: box.x + y, y: box.y + x }
    case 180:
      return { x: box.x + box.width - x, y: box.y + y }
    case 270:
      return { x: box.x + box.width - y, y: box.y + box.height - x }
    default:
      return { x: box.x + x, y: box.y + box.height - y }
  }
}

interface DrawContext {
  page: PDFPage
  /** Map a displayed-space point to user space for this page. */
  at(x: number, y: number): { x: number; y: number }
  /** The page's /Rotate in degrees, normalised to 0, 90, 180 or 270. */
  rotation: number
  /** Standard Helvetica for text; embedded only when some annotation needs it. */
  font: PDFFont
}

/** Drop characters the standard (WinAnsi) font cannot encode, so odd Reasons never fail export. */
function encodable(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...s].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
}

const color = rgb(INK.r, INK.g, INK.b)

const drawers: { [T in Annotation['type']]: (a: Extract<Annotation, { type: T }>, c: DrawContext) => void } = {
  tick(a, c) {
    for (let i = 0; i < TICK_POINTS.length - 1; i++) {
      const [x1, y1] = TICK_POINTS[i]
      const [x2, y2] = TICK_POINTS[i + 1]
      c.page.drawLine({
        start: c.at(a.x + x1, a.y + y1),
        end: c.at(a.x + x2, a.y + y2),
        thickness: STROKE_WIDTH,
        color,
        lineCap: LineCapStyle.Round,
      })
    }
  },
  cross(a, c) {
    for (const [[x1, y1], [x2, y2]] of CROSS_STROKES) {
      c.page.drawLine({
        start: c.at(a.x + x1, a.y + y1),
        end: c.at(a.x + x2, a.y + y2),
        thickness: STROKE_WIDTH,
        color,
        lineCap: LineCapStyle.Round,
      })
    }
    const label = a.reason ? encodable(c.font, a.reason) : ''
    if (label) {
      c.page.drawText(label, {
        ...c.at(a.x + REASON_TAG.dx, a.y + REASON_TAG.dy),
        size: REASON_TAG.fontSize,
        font: c.font,
        color,
        rotate: degrees(c.rotation),
      })
    }
  },
}

/** "learner-12.pdf" -> "learner-12-marked.pdf". */
export function markedFileName(originalName: string): string {
  return `${originalName.replace(/\.pdf$/i, '')}-marked.pdf`
}

export async function exportMarkedPdf(
  originalBytes: Uint8Array,
  annotations: readonly Annotation[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const pages = doc.getPages()
  let helvetica: PDFFont | undefined
  for (const a of annotations) {
    const page = pages[a.page - 1]
    if (!page) continue
    const box = page.getCropBox()
    const rotation = page.getRotation().angle
    if (a.type === 'cross' && a.reason) helvetica ??= await doc.embedFont(StandardFonts.Helvetica)
    const context: DrawContext = {
      page,
      at: (x, y) => toPageSpace(box, rotation, x, y),
      rotation: (((Math.round(rotation / 90) * 90) % 360) + 360) % 360,
      font: helvetica as PDFFont, // set whenever a drawer needs it (only Reasons do)
    }
    const draw = drawers[a.type] as (a: Annotation, c: DrawContext) => void
    draw(a, context)
  }
  return doc.save()
}
