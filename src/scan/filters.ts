// The look of a scanned page: original, greyscale, black and white, or enhanced colour.
// No DOM: runs in a worker or in Node (tests/scan-filters.test.ts).
import type { RgbaImage } from './warp'

export type ScanFilter = 'original' | 'grey' | 'bw' | 'colour'

export const FILTERS: readonly { value: ScanFilter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'grey', label: 'Greyscale' },
  { value: 'bw', label: 'Black and white' },
  { value: 'colour', label: 'Enhanced colour' },
]

export function isScanFilter(v: unknown): v is ScanFilter {
  return FILTERS.some((f) => f.value === v)
}

/** Rec. 601 luma, one byte per pixel. */
export function luma(img: RgbaImage): Uint8Array {
  const { data } = img
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  }
  return out
}

function fromGrey(grey: Uint8Array, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let j = 0, i = 0; j < grey.length; j++, i += 4) {
    data[i] = data[i + 1] = data[i + 2] = grey[j]
    data[i + 3] = 255
  }
  return { width, height, data }
}

export interface ThresholdOptions {
  /** Side of the square neighbourhood each pixel is compared with, in pixels. */
  window?: number
  /** How much darker than its neighbourhood a pixel must be to turn black (0.15 is 15%). */
  sensitivity?: number
  /** A pixel must also be at least this many levels darker, so flat paper does not speckle. */
  minDifference?: number
}

/**
 * Adaptive threshold (Bradley and Roth): a pixel turns black when it is clearly darker than the
 * average of the square around it, otherwise white. Uneven light and shadows across a photo
 * barely matter, because each pixel is judged against its own surroundings.
 * Returns one byte per pixel, 0 or 255.
 */
export function adaptiveThreshold(
  grey: Uint8Array,
  width: number,
  height: number,
  options: ThresholdOptions = {},
): Uint8Array {
  const half = Math.max(1, Math.floor((options.window ?? Math.max(15, Math.round(Math.max(width, height) / 24))) / 2))
  const t = options.sensitivity ?? 0.15
  const minDiff = options.minDifference ?? 12
  // Integral image with a zero row and column in front: sums of any rectangle in four lookups.
  const w1 = width + 1
  const integral = new Float64Array(w1 * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x]
      integral[(y + 1) * w1 + x + 1] = integral[y * w1 + x + 1] + row
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height, y + half + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width, x + half + 1)
      const sum = integral[y1 * w1 + x1] - integral[y0 * w1 + x1] - integral[y1 * w1 + x0] + integral[y0 * w1 + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = grey[y * width + x]
      out[y * width + x] = v < mean * (1 - t) && mean - v >= minDiff ? 0 : 255
    }
  }
  return out
}

/** The level below which `fraction` of the pixels lie. */
export function percentile(grey: Uint8Array, fraction: number): number {
  const hist = new Uint32Array(256)
  for (const v of grey) hist[v]++
  const target = fraction * grey.length
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += hist[v]
    if (seen > target) return v
  }
  return 255
}

/**
 * How bright the paper is around each pixel, ignoring the writing on it: the image is shrunk,
 * every pixel takes the brightest value near it (which removes thin dark strokes), and the
 * result is smoothed. Returned at full size, one byte per pixel.
 */
export function paperLight(grey: Uint8Array, width: number, height: number): Uint8Array {
  const f = Math.max(1, Math.round(Math.max(width, height) / 200))
  const sw = Math.max(1, Math.ceil(width / f))
  const sh = Math.max(1, Math.ceil(height / f))
  const small = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0
      let n = 0
      for (let yy = y * f; yy < Math.min(height, (y + 1) * f); yy++) {
        for (let xx = x * f; xx < Math.min(width, (x + 1) * f); xx++) {
          sum += grey[yy * width + xx]
          n++
        }
      }
      small[y * sw + x] = sum / n
    }
  }
  const pass = (src: Float32Array, r: number, pick: 'max' | 'mean') => {
    const out = new Float32Array(src.length)
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let acc = 0
        let n = 0
        for (let yy = Math.max(0, y - r); yy <= Math.min(sh - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(sw - 1, x + r); xx++) {
            const v = src[yy * sw + xx]
            if (pick === 'max') acc = v > acc ? v : acc
            else acc += v
            n++
          }
        }
        out[y * sw + x] = pick === 'max' ? acc : acc / n
      }
    }
    return out
  }
  const light = pass(pass(small, 3, 'max'), 4, 'mean')
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const top = light[y0 * sw + x0] + (light[y0 * sw + x1] - light[y0 * sw + x0]) * tx
      const bottom = light[y1 * sw + x0] + (light[y1 * sw + x1] - light[y1 * sw + x0]) * tx
      out[y * width + x] = top + (bottom - top) * ty
    }
  }
  return out
}

/**
 * Brighter paper and stronger ink, keeping the colours. Uneven light is evened out first (each
 * pixel is lifted by how dim the paper around it is, at most 2.5 times), then the levels are
 * stretched so the darkest 1% becomes black, the mid tones are lifted a little and colours are
 * made slightly richer.
 */
export function enhanceColour(source: RgbaImage): RgbaImage {
  const light = paperLight(luma(source), source.width, source.height)
  const lifted = new Uint8ClampedArray(source.data.length)
  for (let i = 0, j = 0; i < lifted.length; i += 4, j++) {
    const gain = Math.min(2.5, Math.max(1, 245 / Math.max(1, light[j])))
    lifted[i] = source.data[i] * gain
    lifted[i + 1] = source.data[i + 1] * gain
    lifted[i + 2] = source.data[i + 2] * gain
    lifted[i + 3] = 255
  }
  const img = { width: source.width, height: source.height, data: lifted }
  const grey = luma(img)
  // On a page that is mostly paper the darkest 1% can still be paper, so black stays below 60% of white.
  const paper = Math.max(32, percentile(grey, 0.9))
  const black = Math.min(percentile(grey, 0.01), Math.round(paper * 0.6))
  const white = Math.max(black + 32, paper)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    const n = Math.max(0, Math.min(1, (v - black) / (white - black)))
    lut[v] = Math.round(255 * Math.pow(n, 0.85))
  }
  const out = new Uint8ClampedArray(img.data.length)
  const d = img.data
  const saturation = 1.2
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const l = grey[j]
    for (let c = 0; c < 3; c++) {
      const v = l + (d[i + c] - l) * saturation
      out[i + c] = lut[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)]
    }
    out[i + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

/** The page with `filter` applied. "original" returns the image unchanged. */
export function applyFilter(img: RgbaImage, filter: ScanFilter): RgbaImage {
  switch (filter) {
    case 'original':
      return img
    case 'grey':
      return fromGrey(luma(img), img.width, img.height)
    case 'bw':
      return fromGrey(adaptiveThreshold(luma(img), img.width, img.height), img.width, img.height)
    case 'colour':
      return enhanceColour(img)
  }
}
