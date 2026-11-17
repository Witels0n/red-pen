// The OMR Web Worker: reads pages off the main thread so the page stays responsive.
// Talks to client.ts only. Imports nothing that touches the DOM.
import type { RgbaImage } from './image'
import { identifySheet, readSheet, type ReadOptions } from './read'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

interface Detector {
  detect(image: ImageData): Promise<{ rawValue: string }[]>
}
type DetectorConstructor = new (opts: { formats: string[] }) => Detector

/** Turns an ImageBitmap into pixels; ImageData passes straight through. */
function pixels(image: ImageData | ImageBitmap): ImageData {
  if (!(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)) return image as ImageData
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot read images in the background.')
  ctx.drawImage(image, 0, 0)
  image.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

let detector: Detector | null | undefined
/** BarcodeDetector inside the worker where the browser offers it (Chrome on Android and macOS). */
async function workerHints(image: ImageData): Promise<string[]> {
  if (detector === undefined) {
    const Ctor = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
    try {
      detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null
    } catch {
      detector = null
    }
  }
  if (!detector) return []
  try {
    return (await detector.detect(image)).map((c) => c.rawValue)
  } catch {
    return []
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  let res: WorkerResponse
  try {
    const image = pixels(req.image) as RgbaImage
    const hints = req.opts?.qrHints?.length ? req.opts.qrHints : await workerHints(image as ImageData)
    if (req.type === 'read') {
      const opts: ReadOptions = { ...req.opts!, qrHints: hints }
      res = { id: req.id, ok: true, result: readSheet(image, opts) }
    } else {
      res = { id: req.id, ok: true, result: identifySheet(image, hints) }
    }
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  ;(self as unknown as Worker).postMessage(res)
}
