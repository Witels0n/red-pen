import { degrees, PDFDocument } from 'pdf-lib'
import { savedRotation, type PageSlot } from './page-order'

/**
 * Build the organised PDF: the chosen pages of `source` in the given order, each with the
 * teacher's turn added to its stored /Rotate. Pages are copied, never re-rendered, so the
 * output keeps the original quality and text.
 */
export async function organisePdf(source: PDFDocument, pages: readonly PageSlot[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('An organised PDF needs at least one page.')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(
    source,
    pages.map((p) => p.source),
  )
  copied.forEach((page, i) => {
    page.setRotation(degrees(savedRotation(page.getRotation().angle, pages[i].turn)))
    out.addPage(page)
  })
  return out.save()
}
