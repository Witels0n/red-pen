import { degrees, LineCapStyle, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, type RGB } from 'pdf-lib'
import {
  BOX_HEIGHT,
  boxWidth,
  CROSS_STROKES,
  FONT_SIZE,
  REASON_TAG,
  STROKE_WIDTH,
  SUBTOTAL_RADIUS,
  TICK_POINTS,
} from './annotation-geometry'
import { INK_PRESETS, type InkRgb } from './ink'
import { createMarkingModel, type Annotation, type MarkingModel } from './marking-model'

// Export: draws the Annotations in the Ink colour as flattened vector graphics over the original pages.
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
export function toPageSpace(box: PageBox, rotation: number, x: number, y: number): { x: number; y: number } {
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
  font: PDFFont
  /** The Ink colour every Annotation is drawn in. */
  color: RGB
  /** Derived values (Subtotal counts, the Total) for the Annotations being exported. */
  model: Pick<MarkingModel, 'getSubtotalCount' | 'getTotal'>
}

/** Drop characters the standard (WinAnsi) font cannot encode, so odd Reasons never fail export. */
function encodable(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...s].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
}

/** Draw text with its baseline starting at a displayed-space point, following the page rotation. */
function drawText(c: DrawContext, text: string, x: number, y: number, align: 'start' | 'middle'): void {
  const safe = encodable(c.font, text)
  const width = c.font.widthOfTextAtSize(safe, FONT_SIZE)
  const startX = align === 'middle' ? x - width / 2 : x
  const origin = c.at(startX, y + FONT_SIZE * 0.35) // baseline sits a little below the centre
  const along = c.at(startX + 1, y + FONT_SIZE * 0.35)
  const angle = Math.atan2(along.y - origin.y, along.x - origin.x) * (180 / Math.PI)
  c.page.drawText(safe, {
    x: origin.x,
    y: origin.y,
    size: FONT_SIZE,
    font: c.font,
    color: c.color,
    rotate: degrees(angle),
  })
}

const drawers: { [T in Annotation['type']]: (a: Extract<Annotation, { type: T }>, c: DrawContext) => void } = {
  tick(a, c) {
    for (let i = 0; i < TICK_POINTS.length - 1; i++) {
      const [x1, y1] = TICK_POINTS[i]
      const [x2, y2] = TICK_POINTS[i + 1]
      c.page.drawLine({
        start: c.at(a.x + x1, a.y + y1),
        end: c.at(a.x + x2, a.y + y2),
        thickness: STROKE_WIDTH,
        color: c.color,
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
        color: c.color,
        lineCap: LineCapStyle.Round,
      })
    }
    const label = a.reason ? encodable(c.font, a.reason) : ''
    if (label) {
      c.page.drawText(label, {
        ...c.at(a.x + REASON_TAG.dx, a.y + REASON_TAG.dy),
        size: REASON_TAG.fontSize,
        font: c.font,
        color: c.color,
        rotate: degrees(c.rotation),
      })
    }
  },
  subtotal(a, c) {
    const centre = c.at(a.x, a.y)
    c.page.drawCircle({
      x: centre.x,
      y: centre.y,
      size: SUBTOTAL_RADIUS,
      borderColor: c.color,
      borderWidth: STROKE_WIDTH,
    })
    drawText(c, String(c.model.getSubtotalCount(a.id) ?? 0), a.x, a.y, 'middle')
  },
  total(a, c) {
    const label = `${c.model.getTotal()?.count ?? 0} / ${a.outOf}`
    const w = boxWidth(label)
    const h = BOX_HEIGHT
    const corners = [
      c.at(a.x - w / 2, a.y - h / 2),
      c.at(a.x + w / 2, a.y - h / 2),
      c.at(a.x + w / 2, a.y + h / 2),
      c.at(a.x - w / 2, a.y + h / 2),
    ]
    corners.forEach((start, i) =>
      c.page.drawLine({
        start,
        end: corners[(i + 1) % 4],
        thickness: STROKE_WIDTH,
        color: c.color,
        lineCap: LineCapStyle.Projecting,
      }),
    )
    drawText(c, label, a.x, a.y, 'middle')
  },
  text(a, c) {
    drawText(c, a.text, a.x, a.y, 'start')
  },
}

/** "learner-12.pdf" -> "learner-12-marked.pdf". */
export function markedFileName(originalName: string): string {
  return `${originalName.replace(/\.pdf$/i, '')}-marked.pdf`
}

export async function exportMarkedPdf(
  originalBytes: Uint8Array,
  annotations: readonly Annotation[],
  ink: InkRgb = INK_PRESETS.red,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const color = rgb(ink.r, ink.g, ink.b)
  const model = createMarkingModel(annotations)
  for (const a of annotations) {
    const page = pages[a.page - 1]
    if (!page) continue
    const box = page.getCropBox()
    const rotation = page.getRotation().angle
    const context: DrawContext = {
      page,
      font,
      color,
      model,
      rotation: (((Math.round(rotation / 90) * 90) % 360) + 360) % 360,
      at: (x, y) => toPageSpace(box, rotation, x, y),
    }
    const draw = drawers[a.type] as (a: Annotation, c: DrawContext) => void
    draw(a, context)
  }
  return doc.save()
}
