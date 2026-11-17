// Finds the sheet of paper in a photo, to suggest where the four crop corners go.
// Simple and fast: paper is usually the largest bright region, so the photo is shrunk, split into
// bright and dark (Otsu), the largest bright region is taken, and the four-cornered shape that
// covers most of its outline becomes the suggestion. When the photo does not look like that,
// nothing is suggested and the crop starts at the whole photo.
// No DOM: runs in a worker or in Node (tests/scan-detect.test.ts).
import { orderCorners, polygonArea, type Point, type Quad } from './geometry'
import { luma } from './filters'
import type { RgbaImage } from './warp'

/** The photo is analysed at most this many pixels on its longer side. */
const ANALYSIS_SIDE = 240

/** Box-averaged greyscale copy, at most `maxSide` on the longer side. */
function smallGrey(img: RgbaImage, maxSide: number): { g: Float32Array; w: number; h: number } {
  const grey = luma(img)
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide))
  const w = Math.max(1, Math.floor(img.width / factor))
  const h = Math.max(1, Math.floor(img.height / factor))
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * img.width + x * factor
        for (let dx = 0; dx < factor; dx++) sum += grey[row + dx]
      }
      g[y * w + x] = sum / (factor * factor)
    }
  }
  return { g, w, h }
}

function blur(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(g.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += g[yy * w + xx]
          n++
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return out
}

/** Otsu's threshold, with the mean level on each side of it. */
export function otsu(values: ArrayLike<number>): { threshold: number; darkMean: number; brightMean: number } {
  const hist = new Float64Array(256)
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.round(values[i])))]++
  const total = values.length
  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]
  let best = 0
  let threshold = 127
  let wDark = 0
  let sumDark = 0
  for (let t = 0; t < 256; t++) {
    wDark += hist[t]
    if (wDark === 0) continue
    const wBright = total - wDark
    if (wBright === 0) break
    sumDark += t * hist[t]
    const mDark = sumDark / wDark
    const mBright = (sumAll - sumDark) / wBright
    const between = wDark * wBright * (mDark - mBright) ** 2
    if (between > best) [best, threshold] = [between, t]
  }
  let dSum = 0
  let dN = 0
  for (let v = 0; v <= threshold; v++) [dSum, dN] = [dSum + v * hist[v], dN + hist[v]]
  const bN = total - dN
  return {
    threshold,
    darkMean: dN ? dSum / dN : 0,
    brightMean: bN ? (sumAll - dSum) / bN : 255,
  }
}

/** Convex hull (Andrew's monotone chain), anticlockwise in maths axes. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const triangle = (a: Point, b: Point, c: Point) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2

/** The four hull points that enclose the largest area (the hull is first thinned to at most 64 points). */
export function largestQuad(hull: readonly Point[]): Point[] | null {
  if (hull.length < 4) return null
  const step = Math.max(1, hull.length / 64)
  const pts: Point[] = []
  for (let i = 0; i < hull.length; i += step) pts.push(hull[Math.floor(i)])
  const n = pts.length
  if (n < 4) return null
  let best = -1
  let bestQuad: Point[] | null = null
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      let left = 0
      let leftK = -1
      for (let k = i + 1; k < j; k++) {
        const a = triangle(pts[i], pts[k], pts[j])
        if (a > left) [left, leftK] = [a, k]
      }
      let right = 0
      let rightK = -1
      for (let k = j + 1; k < n + i; k++) {
        const a = triangle(pts[i], pts[j], pts[k % n])
        if (a > right) [right, rightK] = [a, k % n]
      }
      if (leftK < 0 || rightK < 0) continue
      if (left + right > best) {
        best = left + right
        bestQuad = [pts[i], pts[leftK], pts[j], pts[rightK]]
      }
    }
  }
  return bestQuad
}

/**
 * Suggests the corners of the sheet of paper in a photo, in 0 to 1 coordinates
 * (top left first, clockwise), or null when no clear sheet stands out from the background.
 */
export function detectPaper(img: RgbaImage): Quad | null {
  if (img.width < 8 || img.height < 8) return null
  const { g: raw, w, h } = smallGrey(img, ANALYSIS_SIDE)
  const g = blur(blur(raw, w, h), w, h)
  const { threshold, darkMean, brightMean } = otsu(g)
  // Too little difference between paper and background to tell them apart.
  if (brightMean - darkMean < 40) return null

  // Largest 4-connected bright region.
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  let bestLabel = -1
  let bestSize = 0
  let next = 0
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || g[start] <= threshold) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = next
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p - x) / w
      const visit = (q: number) => {
        if (label[q] === -1 && g[q] > threshold) {
          label[q] = next
          queue[tail++] = q
        }
      }
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (y > 0) visit(p - w)
      if (y < h - 1) visit(p + w)
    }
    if (tail > bestSize) [bestSize, bestLabel] = [tail, next]
    next++
  }
  const fraction = bestSize / (w * h)
  // Too small to be the page, or the page already fills the photo.
  if (fraction < 0.12 || fraction > 0.95) return null

  const edge: Point[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (label[p] !== bestLabel) continue
      const outline =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        label[p - 1] !== bestLabel ||
        label[p + 1] !== bestLabel ||
        label[p - w] !== bestLabel ||
        label[p + w] !== bestLabel
      if (outline) edge.push({ x: x + 0.5, y: y + 0.5 })
    }
  }
  const hull = convexHull(edge)
  const quad = largestQuad(hull)
  if (!quad) return null
  // Not shaped like a sheet: the four corners leave out too much of the bright region.
  if (polygonArea(orderCorners(quad)) < 0.85 * polygonArea(hull)) return null
  // Pull each corner one analysis pixel towards the middle, so no sliver of desk shows at the edges.
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4
  return orderCorners(
    quad.map((p) => {
      const d = Math.hypot(cx - p.x, cy - p.y) || 1
      const x = p.x + ((cx - p.x) / d) * 1.5
      const y = p.y + ((cy - p.y) / d) * 1.5
      return { x: Math.max(0, Math.min(1, x / w)), y: Math.max(0, Math.min(1, y / h)) }
    }),
  )
}
