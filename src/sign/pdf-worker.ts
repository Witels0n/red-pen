// Copied from src/mark/pdf-worker.ts so the two tools stay independent until PDF helpers are shared.
import * as pdfjs from 'pdfjs-dist'
// Bundled by Vite as a first-party asset, so the worker is self-hosted (ADR 0001).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type PdfDocument = pdfjs.PDFDocumentProxy
export type PdfPage = pdfjs.PDFPageProxy
export type RenderTask = pdfjs.RenderTask

/** Parse PDF bytes. The bytes are copied because pdf.js transfers (detaches) the buffer it is given. */
export function loadPdf(bytes: Uint8Array): Promise<PdfDocument> {
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}
