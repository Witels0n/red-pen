import { PDFDocument } from 'pdf-lib'

export const COMBINED_FILE_NAME = 'combined.pdf'

/** One PDF in one PDF out: every page of each document, in the order given. */
export async function combinePdfs(docs: readonly PDFDocument[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const doc of docs) {
    const copied = await out.copyPages(doc, doc.getPageIndices())
    for (const page of copied) out.addPage(page)
  }
  return out.save()
}
