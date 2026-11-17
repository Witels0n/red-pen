// Cuts a region of the sheet out of the photo or scan as a straight, upright image.
import { applyHomography, type Homography } from './homography'
import { sample, type GrayImage, type RgbaImage } from './image'
import type { Rect } from './types'

/** Resamples a layout-space rectangle at `pxPerPt` pixels per point. */
export function rectifyGray(g: GrayImage, h: Homography, rect: Rect, pxPerPt: number): GrayImage {
  const width = Math.max(1, Math.round(rect.w * pxPerPt))
  const height = Math.max(1, Math.round(rect.h * pxPerPt))
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyHomography(h, rect.x + (x + 0.5) / pxPerPt, rect.y + (y + 0.5) / pxPerPt)
      out[y * width + x] = sample(g, p.x, p.y)
    }
  }
  return { width, height, data: out }
}

export function grayToRgba(g: GrayImage): RgbaImage {
  const data = new Uint8ClampedArray(g.width * g.height * 4)
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    data[j] = data[j + 1] = data[j + 2] = g.data[i]
    data[j + 3] = 255
  }
  return { width: g.width, height: g.height, data }
}

/**
 * A straightened crop of a colour image, for showing the teacher the bubbles under Review.
 * `homography` is SheetRead.homography (layout points to image pixels).
 */
export function rectifyRegion(image: RgbaImage, homography: Homography, rect: Rect, pxPerPt = 3): RgbaImage {
  const width = Math.max(1, Math.round(rect.w * pxPerPt))
  const height = Math.max(1, Math.round(rect.h * pxPerPt))
  const data = new Uint8ClampedArray(width * height * 4)
  const src = image.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyHomography(homography, rect.x + (x + 0.5) / pxPerPt, rect.y + (y + 0.5) / pxPerPt)
      const o = (y * width + x) * 4
      const sx = Math.round(p.x)
      const sy = Math.round(p.y)
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) {
        data[o] = data[o + 1] = data[o + 2] = 255
      } else {
        const i = (sy * image.width + sx) * 4
        data[o] = src[i]
        data[o + 1] = src[i + 1]
        data[o + 2] = src[i + 2]
      }
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}
