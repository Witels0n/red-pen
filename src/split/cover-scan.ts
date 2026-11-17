// Looks at every page of a PDF for Cover sheets: pdf.js renders each page on the main thread and
// the OMR worker finds the corner squares and reads the QR. Feeds planCoverSplit (cover-plan.ts).
import { createOmrReader, pdfPagesToImageData } from '../shared/omr'
import type { ScannedPage } from './cover-plan'

export interface CoverScan {
  /** Resolves with one entry per page, or null when cancelled. Rejects if the pages cannot be read. */
  result: Promise<ScannedPage[] | null>
  cancel(): void
}

/** Starts scanning `bytes`. `onProgress` is called after each page with how many are done. */
export function scanForCovers(bytes: Uint8Array, onProgress: (done: number, total: number) => void): CoverScan {
  const reader = createOmrReader()
  let cancelled = false

  const run = async (): Promise<ScannedPage[] | null> => {
    const found: ScannedPage[] = []
    try {
      for await (const { page, pages, image } of pdfPagesToImageData(bytes)) {
        if (cancelled) return null
        const id = await reader.identify(image)
        if (cancelled) return null
        if (!id.ok) found.push({ kind: 'page' })
        else if (id.qr?.kind === 'cover') found.push({ kind: 'cover', learnerId: id.qr.learnerId })
        // An Answer sheet in the batch is part of the learner's test.
        else if (id.qr) found.push({ kind: 'page' })
        else found.push({ kind: 'unreadable' })
        onProgress(page, pages)
      }
      return found
    } catch (error) {
      if (cancelled) return null
      throw error
    } finally {
      reader.terminate()
    }
  }

  return {
    result: run(),
    cancel() {
      cancelled = true
      reader.terminate()
    },
  }
}
