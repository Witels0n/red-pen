import { PDFDocument } from 'pdf-lib'
import type { PdfDocument } from '../shared/pdf/pdf-worker'
import { renderScale, type Attempt } from './settings'

/** Thrown when the teacher presses Cancel. */
export class CompressCancelled extends Error {
  override name = 'CompressCancelled'
}

export interface CompressOptions {
  greyscale: boolean
  signal?: AbortSignal
  /** Called after each page with the number of pages done. */
  onPage?(done: number, total: number): void
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('The page could not be encoded.'))
        else blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      },
      'image/jpeg',
      quality,
    )
  })
}

/** Turn the canvas grey in place (luma weights from BT.601, as JPEG uses). */
function makeGrey(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = y
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * Redraw every page of `pdf` as a JPEG picture at `attempt.dpi` and `attempt.quality`, and build
 * a new PDF of those pictures at the original page sizes. Pages are done one at a time and each
 * canvas is released before the next, so phones do not run out of memory.
 */
export async function compressPdf(pdf: PdfDocument, attempt: Attempt, options: CompressOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const total = pdf.numPages
  for (let i = 1; i <= total; i++) {
    if (options.signal?.aborted) throw new CompressCancelled()
    const page = await pdf.getPage(i)
    // The viewport includes the page's rotation, so the picture is upright and needs no /Rotate.
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: renderScale(base.width, base.height, attempt.dpi) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    try {
      await page.render({ canvas, viewport, intent: 'print', background: '#ffffff' }).promise
      if (options.greyscale) {
        const ctx = canvas.getContext('2d')
        if (ctx) makeGrey(ctx, canvas.width, canvas.height)
      }
      const jpeg = await toJpeg(canvas, attempt.quality)
      const image = await out.embedJpg(jpeg)
      const outPage = out.addPage([base.width, base.height])
      outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height })
    } finally {
      // Free the bitmap now rather than whenever the garbage collector gets to it.
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
    options.onPage?.(i, total)
  }
  if (options.signal?.aborted) throw new CompressCancelled()
  return out.save()
}
