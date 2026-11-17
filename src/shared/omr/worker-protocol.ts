// Messages between client.ts and omr.worker.ts.
import type { IdentifyResult, ReadOptions } from './read'
import type { SheetRead } from './types'

export type WorkerRequest =
  | { id: number; type: 'read'; image: ImageData | ImageBitmap; opts: ReadOptions }
  | { id: number; type: 'identify'; image: ImageData | ImageBitmap; opts?: { qrHints?: string[] } }

export type WorkerResponse =
  { id: number; ok: true; result: SheetRead | IdentifyResult } | { id: number; ok: false; error: string }
