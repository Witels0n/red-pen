// The main-thread side of the OMR worker: a small promise-based API.
import type { IdentifyResult, ReadOptions } from './read'
import type { SheetRead } from './types'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

export interface OmrReader {
  /**
   * Reads one page. The image is transferred to the worker, so an ImageData or ImageBitmap
   * passed in cannot be used again afterwards (pass a copy if you still need it).
   */
  read(image: ImageData | ImageBitmap, opts: Omit<ReadOptions, 'qrHints'>): Promise<SheetRead>
  /** Finds the sheet and decodes its QR only (Cover sheet or Answer sheet, and whose). */
  identify(image: ImageData | ImageBitmap): Promise<IdentifyResult>
  /** Stops the worker. Pending reads reject. */
  terminate(): void
}

interface Detector {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
type DetectorConstructor = new (opts: { formats: string[] }) => Detector

let detector: Detector | null | undefined
/** BarcodeDetector on the main thread, where the browser has it. Its texts are only hints. */
async function mainThreadHints(image: ImageData | ImageBitmap): Promise<string[] | undefined> {
  if (detector === undefined) {
    const Ctor = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
    try {
      detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null
    } catch {
      detector = null
    }
  }
  if (!detector) return undefined
  try {
    return (await detector.detect(image)).map((c) => c.rawValue)
  } catch {
    return undefined
  }
}

export function createOmrReader(): OmrReader {
  const worker = new Worker(new URL('./omr.worker.ts', import.meta.url), { type: 'module', name: 'omr' })
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  let next = 1

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error))
  }
  worker.onerror = (e) => {
    e.preventDefault()
    const error = new Error('The sheet reader stopped unexpectedly.')
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  const send = <T>(make: (id: number) => WorkerRequest): Promise<T> => {
    const id = next++
    const req = make(id)
    const transfer: Transferable[] = req.image instanceof ImageData ? [req.image.data.buffer] : [req.image]
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage(req, transfer)
    })
  }

  return {
    async read(image, opts) {
      const qrHints = await mainThreadHints(image)
      return send<SheetRead>((id) => ({ id, type: 'read', image, opts: { ...opts, ...(qrHints ? { qrHints } : {}) } }))
    },
    async identify(image) {
      const qrHints = await mainThreadHints(image)
      return send<IdentifyResult>((id) => ({ id, type: 'identify', image, opts: qrHints ? { qrHints } : undefined }))
    },
    terminate() {
      worker.terminate()
      const error = new Error('The sheet reader was stopped.')
      for (const p of pending.values()) p.reject(error)
      pending.clear()
    },
  }
}
