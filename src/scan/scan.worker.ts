// The scan worker: decodes, straightens and filters photos off the main thread, so the page
// stays responsive on a phone. Talks to engine.ts only.
import { DecodeError, ingestPhoto, renderPage, renderThumb, sampleSize } from './pipeline'
import type { EngineRequest, EngineResponse } from './engine'

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const req = e.data
  let res: EngineResponse
  const transfer: Transferable[] = []
  try {
    switch (req.op) {
      case 'ingest':
        res = { id: req.id, ok: true, result: await ingestPhoto(req.file) }
        break
      case 'render':
        res = { id: req.id, ok: true, result: await renderPage(req.source, req.look, req.quality) }
        break
      case 'thumb': {
        const img = await renderThumb(req.preview, req.look, req.side)
        transfer.push(img.data.buffer)
        res = { id: req.id, ok: true, result: img }
        break
      }
      case 'sample':
        res = { id: req.id, ok: true, result: await sampleSize(req.preview, req.look, req.quality) }
        break
    }
  } catch (err) {
    res = {
      id: req.id,
      ok: false,
      error: err instanceof DecodeError ? 'decode' : err instanceof Error ? err.message : String(err),
    }
  }
  ;(self as unknown as Worker).postMessage(res, transfer)
}
