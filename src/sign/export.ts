import {
  degrees,
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFImage,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  StandardFonts,
} from 'pdf-lib'
import { placeUpright, toPageSpace } from './geometry'
import { INK_RGB, type Item } from './model'

// Save: fills the real form fields, flattens the form, then draws everything the teacher
// added into the page content, so nothing can be changed by accident afterwards.

/** The value the teacher gave a real form field, by its full name. */
export type FieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'checkbox'; checked: boolean }
  /** `index` is the chosen button's position in the group, used when its export value is not an option. */
  | { kind: 'radio'; value: string | null; index?: number }
  | { kind: 'choice'; value: string }

/** Tick and cross strokes in units of the mark's size, from its top-left. */
export const TICK_POINTS: readonly [number, number][] = [
  [0.12, 0.55],
  [0.4, 0.85],
  [0.9, 0.15],
]
export const CROSS_STROKES: readonly [[number, number], [number, number]][] = [
  [
    [0.18, 0.18],
    [0.82, 0.82],
  ],
  [
    [0.82, 0.18],
    [0.18, 0.82],
  ],
]
export const MARK_STROKE = 0.12

/** "permission-slip.pdf" -> "permission-slip-signed.pdf". */
export function signedFileName(originalName: string): string {
  return `${originalName.replace(/\.pdf$/i, '')}-signed.pdf`
}

/** Drop characters the standard font cannot encode, so odd input never fails the save. */
function encodable(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...s].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
}

function fillField(doc: PDFDocument, font: PDFFont, name: string, v: FieldValue): void {
  const field = doc.getForm().getFieldMaybe(name)
  if (!field) return
  if (v.kind === 'text' && field instanceof PDFTextField) {
    field.setText(encodable(font, v.value) || undefined)
  } else if (v.kind === 'checkbox' && field instanceof PDFCheckBox) {
    if (v.checked) field.check()
    else field.uncheck()
  } else if (v.kind === 'radio' && field instanceof PDFRadioGroup) {
    if (v.value === null) field.clear()
    else {
      const options = field.getOptions()
      const option = options.includes(v.value) ? v.value : v.index !== undefined ? options[v.index] : undefined
      if (option !== undefined) field.select(option)
    }
  } else if (v.kind === 'choice' && (field instanceof PDFDropdown || field instanceof PDFOptionList)) {
    if (v.value === '') field.clear()
    else if (field.getOptions().includes(v.value)) field.select(v.value)
  }
}

export async function buildSignedPdf(
  originalBytes: Uint8Array,
  items: readonly Item[],
  fields: ReadonlyMap<string, FieldValue>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const form = doc.getForm()
  if (form.getFields().length > 0) {
    for (const [name, value] of fields) {
      try {
        fillField(doc, font, name, value)
      } catch {
        // One awkward field must not stop the rest of the document being saved.
      }
    }
    try {
      form.updateFieldAppearances(font)
    } catch {
      // Keep the appearances the fields already have.
    }
    form.flatten({ updateFieldAppearances: false })
  }

  const pages = doc.getPages()
  const images = new Map<string, PDFImage>()
  for (const item of items) {
    const page = pages[item.page - 1]
    if (!page) continue
    const box = page.getCropBox()
    const rotation = page.getRotation().angle
    const at = (x: number, y: number) => toPageSpace(box, rotation, x, y)

    if (item.type === 'text') {
      const text = encodable(font, item.text)
      if (!text.trim()) continue
      const o = placeUpright(box, rotation, item.x, item.y)
      const c = INK_RGB[item.ink]
      page.drawText(text, {
        x: o.x,
        y: o.y,
        size: item.size,
        font,
        color: rgb(c.r, c.g, c.b),
        rotate: degrees(o.angle),
      })
    } else if (item.type === 'tick' || item.type === 'cross') {
      const c = INK_RGB[item.ink]
      const strokes =
        item.type === 'tick'
          ? [
              [TICK_POINTS[0], TICK_POINTS[1]],
              [TICK_POINTS[1], TICK_POINTS[2]],
            ]
          : CROSS_STROKES
      for (const [[x1, y1], [x2, y2]] of strokes) {
        page.drawLine({
          start: at(item.x + x1 * item.size, item.y + y1 * item.size),
          end: at(item.x + x2 * item.size, item.y + y2 * item.size),
          thickness: item.size * MARK_STROKE,
          color: rgb(c.r, c.g, c.b),
          lineCap: LineCapStyle.Round,
        })
      }
    } else {
      let image = images.get(item.src)
      if (!image) {
        image = await doc.embedPng(item.src)
        images.set(item.src, image)
      }
      const o = placeUpright(box, rotation, item.x, item.y + item.height)
      page.drawImage(image, { x: o.x, y: o.y, width: item.width, height: item.height, rotate: degrees(o.angle) })
    }
  }
  return doc.save()
}
