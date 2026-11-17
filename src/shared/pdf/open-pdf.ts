import { PDFDocument } from 'pdf-lib'
import { looksLikePdf } from './pdf-file'

/** A PDF the teacher opened, parsed with pdf-lib and ready to copy pages from. */
export interface OpenedPdf {
  name: string
  bytes: Uint8Array
  doc: PDFDocument
  pageCount: number
}

/** A PDF that cannot be used. The message is written for the teacher and names the file. */
export class PdfOpenError extends Error {
  override name = 'PdfOpenError'
}

/**
 * Parse PDF bytes, refusing anything that is not a usable PDF: other file types,
 * password-protected (encrypted) PDFs, and damaged PDFs or PDFs with no pages.
 */
export async function parsePdf(name: string, bytes: Uint8Array): Promise<OpenedPdf> {
  if (!looksLikePdf(bytes)) throw new PdfOpenError(`"${name}" is not a PDF file.`)
  const damaged = new PdfOpenError(`"${name}" could not be opened: it appears to be damaged.`)
  let doc: PDFDocument
  let pageCount = 0
  try {
    // Load even when encrypted, only to tell the teacher why it cannot be used.
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
    pageCount = doc.getPageCount()
  } catch {
    throw damaged
  }
  if (doc.isEncrypted) throw new PdfOpenError(`"${name}" could not be opened: it is password protected.`)
  if (pageCount === 0) throw damaged
  return { name, bytes, doc, pageCount }
}

/** Read a chosen or dropped file and parse it as a PDF. Throws PdfOpenError with a teacher-facing message. */
export async function openPdfFile(file: File): Promise<OpenedPdf> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new PdfOpenError(`"${file.name}" could not be read.`)
  }
  return parsePdf(file.name, bytes)
}

/** The message to show for an error thrown while opening a file. */
export function openErrorMessage(e: unknown, fileName: string): string {
  return e instanceof PdfOpenError ? e.message : `"${fileName}" could not be opened.`
}
