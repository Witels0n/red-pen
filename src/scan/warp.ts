// Perspective correction, quarter turns and downscaling on raw RGBA pixels.
// No DOM: runs in a worker or in Node (tests/scan-warp.test.ts).
import { homographyFrom } from '../shared/omr/homography'
import type { Quad, Turns } from './geometry'

/** Anything shaped like ImageData (RGBA, 4 bytes per pixel). */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/**
 * Straightens the region inside `quad` (pixel corners of `src`, top left first, clockwise) into a
 * `width` x `height` rectangle. Each output pixel is mapped back into the photo with a homography
 * and sampled bilinearly; points outside the photo read as white.
 */
export function warpQuad(src: RgbaImage, quad: Quad, width: number, height: number): RgbaImage {
  const rect = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  // Maps an output pixel straight to a point in the photo, so nothing needs inverting.
  const h = homographyFrom(rect, quad)
  const out = blankImage(width, height)
  const o = out.data
  const s = src.data
  const sw = src.width
  const maxX = src.width - 1
  const maxY = src.height - 1
  let k = 0
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5
    // The three linear forms change by a constant from one pixel to the next along a row.
    let nx = h[0] * 0.5 + h[1] * cy + h[2]
    let ny = h[3] * 0.5 + h[4] * cy + h[5]
    let nw = h[6] * 0.5 + h[7] * cy + h[8]
    for (let x = 0; x < width; x++, k += 4) {
      const u = nx / nw - 0.5
      const v = ny / nw - 0.5
      nx += h[0]
      ny += h[3]
      nw += h[6]
      if (u < -1 || v < -1 || u > maxX + 1 || v > maxY + 1) {
        o[k] = o[k + 1] = o[k + 2] = o[k + 3] = 255
        continue
      }
      const uc = u < 0 ? 0 : u > maxX ? maxX : u
      const vc = v < 0 ? 0 : v > maxY ? maxY : v
      const x0 = Math.floor(uc)
      const y0 = Math.floor(vc)
      const x1 = x0 < maxX ? x0 + 1 : x0
      const y1 = y0 < maxY ? y0 + 1 : y0
      const fx = uc - x0
      const fy = vc - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx
        const bottom = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx
        o[k + c] = top + (bottom - top) * fy
      }
      o[k + 3] = 255
    }
  }
  return out
}

/** The image turned clockwise by `turns` quarter turns. */
export function turnImage(src: RgbaImage, turns: Turns): RgbaImage {
  if (turns === 0) return src
  const { width: w, height: h } = src
  const out = turns === 2 ? blankImage(w, h) : blankImage(h, w)
  const o = new Uint32Array(out.data.buffer)
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h)
  const ow = out.width
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = s[y * w + x]
      if (turns === 1) o[x * ow + (h - 1 - y)] = p
      else if (turns === 2) o[(h - 1 - y) * ow + (w - 1 - x)] = p
      else o[(w - 1 - x) * ow + y] = p
    }
  }
  return out
}
