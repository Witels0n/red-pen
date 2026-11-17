// Web Worker: finds detected boxes on one rendered page, off the main thread.
import { binarise, detectBoxes, type DetectedBox } from './detect'

export interface DetectRequest {
  id: number
  pixels: Uint8ClampedArray
  width: number
  height: number
  scale: number
}

export interface DetectResponse {
  id: number
  boxes: DetectedBox[]
  ms: number
}

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const { id, pixels, width, height, scale } = e.data
  const start = performance.now()
  const boxes = detectBoxes(binarise(pixels, width, height), width, height, scale)
  const reply: DetectResponse = { id, boxes, ms: performance.now() - start }
  self.postMessage(reply)
}
