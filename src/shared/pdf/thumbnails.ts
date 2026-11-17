import { loadPdf, type PdfDocument } from './pdf-worker'

export interface ThumbnailRenderer {
  /** Render page `pageIndex` (0-based) into `canvas` once it scrolls near the viewport. */
  observe(canvas: HTMLCanvasElement, pageIndex: number): void
  destroy(): void
}

/**
 * Lazily renders page thumbnails with pdf.js, each at most `size` CSS pixels on its longer side.
 * A page renders only when its canvas comes near the viewport, so long scans open quickly.
 * Thumbnails show the page as stored (with its existing rotation).
 */
export async function createThumbnailRenderer(bytes: Uint8Array, size = 150): Promise<ThumbnailRenderer> {
  const pdf: PdfDocument = await loadPdf(bytes)
  const pending = new Map<Element, number>()
  let destroyed = false

  const render = async (canvas: HTMLCanvasElement, pageIndex: number) => {
    const page = await pdf.getPage(pageIndex + 1)
    if (destroyed) return
    const base = page.getViewport({ scale: 1 })
    const ratio = window.devicePixelRatio || 1
    const scale = size / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale: scale * ratio })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    canvas.style.width = `${Math.round(viewport.width / ratio)}px`
    canvas.style.height = `${Math.round(viewport.height / ratio)}px`
    await page.render({ canvas, viewport }).promise
    canvas.dataset.rendered = 'true'
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const pageIndex = pending.get(entry.target)
        observer.unobserve(entry.target)
        pending.delete(entry.target)
        if (pageIndex === undefined) continue
        render(entry.target as HTMLCanvasElement, pageIndex).catch(() => {
          entry.target.classList.add('thumbnail-failed')
        })
      }
    },
    { rootMargin: '300px' },
  )

  return {
    observe(canvas, pageIndex) {
      pending.set(canvas, pageIndex)
      observer.observe(canvas)
    },
    destroy() {
      destroyed = true
      observer.disconnect()
      pending.clear()
      void pdf.loadingTask.destroy()
    },
  }
}
