// Writes finished pages into PDFs with pdf-lib, and packs a split into one .zip.
import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { placeImage, type PageSize } from './layout'

/** One finished page: a JPEG and its size in pixels. */
export interface PageJpeg {
  jpeg: Uint8Array
  width: number
  height: number
}

export interface PdfOptions {
  pageSize: PageSize
  marginMm: number
  title?: string
}

/** One PDF with a page per photo, each photo scaled to fit its page and centred. */
export async function buildPdf(pages: readonly PageJpeg[], options: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (options.title) doc.setTitle(options.title)
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  for (const p of pages) {
    const image = await doc.embedJpg(p.jpeg)
    const at = placeImage(p.width, p.height, options.pageSize, options.marginMm)
    const page = doc.addPage([at.pageWidth, at.pageHeight])
    page.drawImage(image, { x: at.x, y: at.y, width: at.width, height: at.height })
  }
  return doc.save()
}

/** A .zip of the given files. PDFs of JPEGs barely compress, so they are stored as they are. */
export function zipFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(files), { level: 0 })
}
