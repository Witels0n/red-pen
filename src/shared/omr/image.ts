// Greyscale images and the low-level operations the reader needs. No DOM: runs in a worker or in Node.

/** Images are read at most this many pixels on the longer side (a little over 200 dpi for A4). */
export const WORKING_LONG_SIDE = 2600

/** Anything shaped like ImageData (RGBA, 4 bytes per pixel). */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** One byte per pixel, 0 black to 255 white. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

export function toGray(img: RgbaImage): GrayImage {
  const { width, height, data } = img
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    // Rec. 601 luma in integer maths; alpha is ignored (scans and photos are opaque).
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  }
  return { width, height, data: out }
}

/** Box-averages by an integer factor. */
export function downscale(g: GrayImage, factor: number): GrayImage {
  if (factor <= 1) return g
  const width = Math.floor(g.width / factor)
  const height = Math.floor(g.height / factor)
  const out = new Uint8Array(width * height)
  const area = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * g.width + x * factor
        for (let dx = 0; dx < factor; dx++) sum += g.data[row + dx]
      }
      out[y * width + x] = Math.round(sum / area)
    }
  }
  return { width, height, data: out }
}

/** Bilinear sample; points outside the image read as white paper. */
export function sample(g: GrayImage, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  if (x0 < 0 || y0 < 0 || x0 >= g.width - 1 || y0 >= g.height - 1) return 255
  const fx = x - x0
  const fy = y - y0
  const i = y0 * g.width + x0
  const d = g.data
  const top = d[i] + (d[i + 1] - d[i]) * fx
  const bottom = d[i + g.width] + (d[i + g.width + 1] - d[i + g.width]) * fx
  return top + (bottom - top) * fy
}

/** Summed-area table with one extra row and column of zeros. */
export function integral(g: GrayImage): Float64Array {
  const w = g.width + 1
  const out = new Float64Array(w * (g.height + 1))
  for (let y = 0; y < g.height; y++) {
    let row = 0
    for (let x = 0; x < g.width; x++) {
      row += g.data[y * g.width + x]
      out[(y + 1) * w + x + 1] = out[y * w + x + 1] + row
    }
  }
  return out
}

/**
 * Marks pixels clearly darker than their neighbourhood (mean over a square of side 2r+1).
 * Local means make the threshold follow shadows and uneven lighting.
 */
export function adaptiveThreshold(g: GrayImage, r: number, ratio: number): Uint8Array {
  const sat = integral(g)
  const w = g.width + 1
  const out = new Uint8Array(g.width * g.height)
  for (let y = 0; y < g.height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(g.height, y + r + 1)
    for (let x = 0; x < g.width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(g.width, x + r + 1)
      const sum = sat[y1 * w + x1] - sat[y0 * w + x1] - sat[y1 * w + x0] + sat[y0 * w + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = g.data[y * g.width + x]
      out[y * g.width + x] = v < mean * ratio && v < mean - 12 ? 1 : 0
    }
  }
  return out
}

/**
 * The brightness of bare paper across the image, so darkness can be measured relative to the
 * paper under the same light (a shadow darkens paper and pencil alike).
 * Built from a high percentile per block, spread over dark blocks (corner squares, the QR) and smoothed.
 */
export interface PaperMap {
  block: number
  cols: number
  rows: number
  values: Float32Array
}

export function paperMap(g: GrayImage, block: number): PaperMap {
  const cols = Math.ceil(g.width / block)
  const rows = Math.ceil(g.height / block)
  const raw = new Float32Array(cols * rows)
  const hist = new Uint32Array(64)
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      hist.fill(0)
      let n = 0
      const yEnd = Math.min(g.height, (by + 1) * block)
      const xEnd = Math.min(g.width, (bx + 1) * block)
      for (let y = by * block; y < yEnd; y += 2) {
        for (let x = bx * block; x < xEnd; x += 2) {
          hist[g.data[y * g.width + x] >> 2]++
          n++
        }
      }
      // 90th percentile: bare paper even where print or pencil covers most of the block.
      let target = n * 0.1
      let bin = 63
      while (bin > 0 && target > hist[bin]) target -= hist[bin--]
      raw[by * cols + bx] = bin * 4 + 2
    }
  }
  // Dilate (max over 3x3), then smooth (mean over 3x3).
  const grown = new Float32Array(raw.length)
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let m = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy
          const xx = bx + dx
          if (yy >= 0 && yy < rows && xx >= 0 && xx < cols) m = Math.max(m, raw[yy * cols + xx])
        }
      }
      grown[by * cols + bx] = m
    }
  }
  const values = new Float32Array(raw.length)
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let s = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy
          const xx = bx + dx
          if (yy >= 0 && yy < rows && xx >= 0 && xx < cols) {
            s += grown[yy * cols + xx]
            n++
          }
        }
      }
      values[by * cols + bx] = Math.max(16, s / n)
    }
  }
  return { block, cols, rows, values }
}

export function paperAt(p: PaperMap, x: number, y: number): number {
  const fx = Math.min(p.cols - 1, Math.max(0, x / p.block - 0.5))
  const fy = Math.min(p.rows - 1, Math.max(0, y / p.block - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(p.cols - 1, x0 + 1)
  const y1 = Math.min(p.rows - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const v = p.values
  const top = v[y0 * p.cols + x0] * (1 - tx) + v[y0 * p.cols + x1] * tx
  const bottom = v[y1 * p.cols + x0] * (1 - tx) + v[y1 * p.cols + x1] * tx
  return top * (1 - ty) + bottom * ty
}

/** Darkness at an image point relative to the paper there: 0 bare paper, 1 black. */
export function darknessAt(g: GrayImage, p: PaperMap, x: number, y: number): number {
  const d = 1 - sample(g, x, y) / paperAt(p, x, y)
  return d < 0 ? 0 : d > 1 ? 1 : d
}
