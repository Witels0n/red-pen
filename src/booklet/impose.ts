import { degrees, PDFDocument, rgb, type PDFEmbeddedPage } from 'pdf-lib'
import { fitInto, planSheets, type OutputSheet, type Rotation, type Settings, type SourcePage } from './layout'

/** The size and rotation of every page of `doc`, as the layout maths needs them. */
export function sourcePages(doc: PDFDocument): SourcePage[] {
  return doc.getPages().map((page) => {
    const box = page.getCropBox()
    const angle = (((page.getRotation().angle % 360) + 360) % 360) as number
    const rotation = ([0, 90, 180, 270].includes(angle) ? angle : 0) as Rotation
    return { width: box.width, height: box.height, rotation }
  })
}

/**
 * Lay the pages of `source` out on new sheets. Pages are embedded as vector content (never
 * rasterised). `limit` builds only the first sheets, for the preview.
 */
export async function impose(
  source: PDFDocument,
  settings: Settings,
  limit = Infinity,
): Promise<{ bytes: Uint8Array; sheets: OutputSheet[] }> {
  const pages = sourcePages(source)
  const all = planSheets(settings, pages)
  const sheets = all.slice(0, limit)
  const out = await PDFDocument.create()

  const sourceList = source.getPages()
  // A page with no content stream is blank: there is nothing to embed or draw.
  const used = [...new Set(sheets.flatMap((s) => s.slots.map((slot) => slot.source)))].filter(
    (p): p is number => p !== null && sourceList[p].node.Contents() !== undefined,
  )
  const embedded = await out.embedPages(
    used.map((i) => sourceList[i]),
    used.map((i) => {
      const b = sourceList[i].getCropBox()
      return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
    }),
  )
  const byIndex = new Map<number, PDFEmbeddedPage>(used.map((p, k) => [p, embedded[k]]))

  for (const sheet of sheets) {
    const page = out.addPage([sheet.width, sheet.height])
    for (const slot of sheet.slots) {
      const embeddedPage = slot.source === null ? undefined : byIndex.get(slot.source)
      if (slot.source === null || !embeddedPage) continue
      const place = fitInto(slot.cell, pages[slot.source], slot.turn, slot.shiftX)
      page.drawPage(embeddedPage, {
        x: place.x,
        y: place.y,
        xScale: place.scale,
        yScale: place.scale,
        rotate: degrees(-place.rotation),
      })
    }
    for (const b of sheet.borders) {
      page.drawRectangle({ ...b, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.5 })
    }
    for (const l of sheet.cutLines) {
      page.drawLine({
        start: { x: l.x1, y: l.y1 },
        end: { x: l.x2, y: l.y2 },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
        dashArray: [4, 3],
      })
    }
  }
  return { bytes: await out.save(), sheets: all }
}
