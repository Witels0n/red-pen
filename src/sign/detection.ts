import { binarise, detectBoxes, type DetectedBox } from './detect'
import type { DetectRequest, DetectResponse } from './detect-worker'
import { pdfjs, type PdfPage } from '../shared/pdf/pdf-worker'

/** Pages are rendered this many pixels wide for detection (about 1.7 px per point on A4). */
const DETECT_WIDTH = 1000

export interface Detector {
  /** Detected boxes for a page, in displayed page units. */
  detect(page: PdfPage): Promise<DetectedBox[]>
  destroy(): void
}

/**
 * Renders each page to an off-screen canvas and finds detected boxes in a Web Worker.
 * Falls back to the main thread if the worker cannot start, because detection only helps.
 */
export function createDetector(): Detector {
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./detect-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  let nextId = 1
  const waiting = new Map<number, (boxes: DetectedBox[]) => void>()
  worker?.addEventListener('message', (e: MessageEvent<DetectResponse>) => {
    waiting.get(e.data.id)?.(e.data.boxes)
    waiting.delete(e.data.id)
  })
  worker?.addEventListener('error', () => {
    // A broken worker: finish everything still waiting on the main thread instead.
    worker = null
    for (const resolve of waiting.values()) resolve([])
    waiting.clear()
  })

  return {
    async detect(page) {
      const base = page.getViewport({ scale: 1 })
      const scale = DETECT_WIDTH / Math.max(base.width, 1)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return []
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (!worker) return detectBoxes(binarise(data, width, height), width, height, scale)
      const id = nextId++
      return new Promise<DetectedBox[]>((resolve) => {
        waiting.set(id, resolve)
        const request: DetectRequest = { id, pixels: data, width, height, scale }
        worker!.postMessage(request, [data.buffer])
      })
    },
    destroy() {
      worker?.terminate()
      worker = null
      waiting.clear()
    },
  }
}
