// The main-thread side of the scan worker: one job at a time, as promises.
// Without OffscreenCanvas (older Safari) the same steps run on the page, one at a time.
import * as pipeline from './pipeline'
import type { IngestedPhoto, PageLook, RenderedPage } from './pipeline'
import type { RgbaImage } from './warp'

export type EngineRequest =
  | { id: number; op: 'ingest'; file: Blob }
  | { id: number; op: 'render'; source: Blob; look: PageLook; quality: number }
  | { id: number; op: 'thumb'; preview: Blob; look: PageLook; side: number }
  | { id: number; op: 'sample'; preview: Blob; look: PageLook; quality: number }

export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

type Job = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

/** A photo that could not be opened. The message is written for the teacher. */
export class PhotoError extends Error {
  override name = 'PhotoError'
}

function decodeMessage(file: File): string {
  const heic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  return heic
    ? `"${file.name}" is a HEIC photo, which this browser cannot open. On an iPhone, choose Settings, Camera, Formats, Most Compatible, or share the photo as a JPG.`
    : `"${file.name}" could not be opened. Use a JPG or PNG photo.`
}

export interface ScanEngine {
  ingest(file: File): Promise<IngestedPhoto>
  render(source: Blob, look: PageLook, quality: number): Promise<RenderedPage>
  thumb(preview: Blob, look: PageLook, side: number): Promise<RgbaImage>
  sample(preview: Blob, look: PageLook, quality: number): Promise<{ bytes: number; pixels: number }>
}

/** Gives the browser a moment to paint between jobs on the main thread. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

async function runHere(job: Job): Promise<unknown> {
  await breathe()
  switch (job.op) {
    case 'ingest':
      return pipeline.ingestPhoto(job.file)
    case 'render':
      return pipeline.renderPage(job.source, job.look, job.quality)
    case 'thumb':
      return pipeline.renderThumb(job.preview, job.look, job.side)
    case 'sample':
      return pipeline.sampleSize(job.preview, job.look, job.quality)
  }
}

function startWorker(): ((job: Job) => Promise<unknown>) | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module', name: 'scan' })
  } catch {
    return null
  }
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  let next = 1
  worker.onmessage = (e: MessageEvent<EngineResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error))
  }
  worker.onerror = (e) => {
    e.preventDefault()
    for (const p of pending.values()) p.reject(new Error('worker'))
    pending.clear()
  }
  return (job) =>
    new Promise((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...job, id })
    })
}

export function createScanEngine(): ScanEngine {
  let inWorker = startWorker()
  let queue: Promise<unknown> = Promise.resolve()

  /** Runs jobs strictly one after another, so only one photo is in memory at full size. */
  const run = <T>(job: Job): Promise<T> => {
    const go = async (): Promise<unknown> => {
      if (inWorker) {
        try {
          return await inWorker(job)
        } catch (e) {
          // A worker that cannot decode (HEIC in some browsers) or that stopped: try on the page.
          if (!(e instanceof Error) || (e.message !== 'decode' && e.message !== 'worker')) throw e
          if (e.message === 'worker') inWorker = null
        }
      }
      return runHere(job)
    }
    const result = queue.then(go, go)
    queue = result.catch(() => undefined)
    return result as Promise<T>
  }

  return {
    async ingest(file) {
      try {
        return await run<IngestedPhoto>({ op: 'ingest', file })
      } catch (e) {
        if (e instanceof pipeline.DecodeError || (e instanceof Error && e.message === 'decode')) {
          throw new PhotoError(decodeMessage(file))
        }
        throw new PhotoError(`"${file.name}" could not be added.`)
      }
    },
    render: (source, look, quality) => run({ op: 'render', source, look, quality }),
    thumb: (preview, look, side) => run({ op: 'thumb', preview, look, side }),
    sample: (preview, look, quality) => run({ op: 'sample', preview, look, quality }),
  }
}
