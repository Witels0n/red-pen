import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import type { PlannedPart } from './plan'

/** Build each planned part as its own PDF, copied page for page from `source`. */
export async function buildParts(source: PDFDocument, parts: readonly PlannedPart[]): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const part of parts) {
    const out = await PDFDocument.create()
    const indices = Array.from({ length: part.end - part.start + 1 }, (_, i) => part.start - 1 + i)
    for (const page of await out.copyPages(source, indices)) out.addPage(page)
    files.set(part.fileName, await out.save())
  }
  return files
}

/** Split `source` into the planned parts and pack them into one .zip. */
export async function splitToZip(source: PDFDocument, parts: readonly PlannedPart[]): Promise<Uint8Array> {
  const files = await buildParts(source, parts)
  // PDFs are already compressed, so store them as they are: faster, and barely any bigger.
  return zipSync(Object.fromEntries(files), { level: 0 })
}
