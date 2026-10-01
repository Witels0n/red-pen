import * as pdfjs from 'pdfjs-dist'
// Bundled by Vite as a first-party asset, so the worker is self-hosted (ADR 0001).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
