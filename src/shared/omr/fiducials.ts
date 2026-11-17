// Finds the four solid corner squares in a thresholded image.
// Connected components are scored for squareness in a way that does not depend on rotation:
// a solid square fills its convex hull and the quadrilateral of its four extreme points, while a
// filled circle fills the hull but overflows that quadrilateral by about 57%.
import type { Point } from './homography'

export interface SquareCandidate {
  /** Centre: where the diagonals of the fitted quadrilateral cross (correct under perspective). */
  x: number
  y: number
  area: number
  /** Square root of the fitted quadrilateral's area. */
  side: number
  corners: Point[]
}

interface Component {
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Labels 4-connected components of the mask. Returns per-pixel labels and per-label stats. */
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; stats: Map<number, Component> } {
  const labels = new Int32Array(width * height)
  const parent: number[] = [0]
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      const up = y > 0 ? labels[i - width] : 0
      const left = x > 0 ? labels[i - 1] : 0
      if (up && left) {
        const a = find(up)
        const b = find(left)
        labels[i] = Math.min(a, b)
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
      } else if (up || left) {
        labels[i] = up || left
      } else {
        labels[i] = parent.length
        parent.push(parent.length)
      }
    }
  }
  const stats = new Map<number, Component>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!labels[i]) continue
      const root = find(labels[i])
      labels[i] = root
      const s = stats.get(root)
      if (s) {
        s.area++
        if (x < s.minX) s.minX = x
        if (x > s.maxX) s.maxX = x
        if (y > s.maxY) s.maxY = y
      } else {
        stats.set(root, { area: 1, minX: x, maxX: x, minY: y, maxY: y })
      }
    }
  }
  return { labels, stats }
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Andrew's monotone chain. */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lower: Point[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Point[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

export function polygonArea(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The quadrilateral of a convex hull's extreme points: the two farthest apart and the farthest from that line on each side. */
export function extremeQuad(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null
  let a = 0
  let b = 0
  let best = -1
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = dist(hull[i], hull[j])
      if (d > best) {
        best = d
        a = i
        b = j
      }
    }
  }
  let left = -1
  let right = -1
  let leftD = 0
  let rightD = 0
  for (let i = 0; i < hull.length; i++) {
    const c = cross(hull[a], hull[b], hull[i])
    if (c > leftD) {
      leftD = c
      left = i
    }
    if (-c > rightD) {
      rightD = -c
      right = i
    }
  }
  if (left < 0 || right < 0) return null
  return [hull[a], hull[left], hull[b], hull[right]]
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(d) < 1e-9) return null
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}

export interface SquareOptions {
  minArea: number
  maxArea: number
}

/** Every component that looks like a solid square, at any rotation and under moderate perspective. */
export function findSquares(mask: Uint8Array, width: number, height: number, opts: SquareOptions): SquareCandidate[] {
  const { labels, stats } = components(mask, width, height)
  const out: SquareCandidate[] = []
  for (const [label, s] of stats) {
    if (s.area < opts.minArea || s.area > opts.maxArea) continue
    const bw = s.maxX - s.minX + 1
    const bh = s.maxY - s.minY + 1
    if (bw < 4 || bh < 4 || bw > 3 * bh || bh > 3 * bw) continue
    if (s.area < 0.38 * bw * bh) continue
    if (s.minX === 0 || s.minY === 0 || s.maxX === width - 1 || s.maxY === height - 1) continue
    // Row extents give the outline; their corners give an exact pixel hull.
    const pts: Point[] = []
    for (let y = s.minY; y <= s.maxY; y++) {
      let l = -1
      let r = -1
      const row = y * width
      for (let x = s.minX; x <= s.maxX; x++) {
        if (labels[row + x] === label) {
          if (l < 0) l = x
          r = x
        }
      }
      if (l < 0) continue
      pts.push({ x: l, y }, { x: l, y: y + 1 }, { x: r + 1, y }, { x: r + 1, y: y + 1 })
    }
    const hull = convexHull(pts)
    const hullArea = polygonArea(hull)
    if (hullArea <= 0 || s.area / hullArea < 0.88) continue
    const quad = extremeQuad(hull)
    if (!quad) continue
    const quadArea = polygonArea(quad)
    const fill = s.area / quadArea
    if (fill < 0.85 || fill > 1.22) continue
    const sides = quad.map((p, i) => dist(p, quad[(i + 1) % 4]))
    if (Math.max(...sides) / Math.min(...sides) > 1.8) continue
    const d1 = dist(quad[0], quad[2])
    const d2 = dist(quad[1], quad[3])
    if (Math.max(d1, d2) / Math.min(d1, d2) > 1.45) continue
    const centre = lineIntersection(quad[0], quad[2], quad[1], quad[3])
    if (!centre) continue
    out.push({ x: centre.x, y: centre.y, area: s.area, side: Math.sqrt(quadArea), corners: quad })
  }
  return out
}

/** Sorts four points clockwise on screen (y down), starting from the one nearest the top left. */
export function orderClockwise(points: Point[]): Point[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
}

/** Expected (side of a corner square) / (square root of the area between the four centres). */
export const EXPECTED_SIDE_RATIO = 8 / Math.sqrt(184 * 271)
/** Expected short / long side of the quadrilateral between the centres. */
export const EXPECTED_ASPECT = 184 / 271

export interface CornerSet {
  /** Clockwise on screen. */
  squares: SquareCandidate[]
  score: number
}

function isConvex(p: Point[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const c = cross(p[i], p[(i + 1) % 4], p[(i + 2) % 4])
    if (Math.abs(c) < 1e-9) return false
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Ranks sets of four squares that could be the sheet's corners: a large convex quadrilateral,
 * squares of similar size, and squares the right size for the distance between them.
 */
export function rankCornerSets(candidates: SquareCandidate[], limit = 8): CornerSet[] {
  const pool = [...candidates].sort((a, b) => b.area - a.area).slice(0, 28)
  const sets: CornerSet[] = []
  const n = pool.length
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          const four = [pool[a], pool[b], pool[c], pool[d]]
          const sides = four.map((s) => s.side)
          const uniformity = Math.min(...sides) / Math.max(...sides)
          if (uniformity < 0.4) continue
          const ordered = orderClockwise(four) as SquareCandidate[]
          if (!isConvex(ordered)) continue
          const area = polygonArea(ordered)
          if (area <= 0) continue
          const e = ordered.map((p, i) => dist(p, ordered[(i + 1) % 4]))
          if (Math.min(e[0], e[2]) / Math.max(e[0], e[2]) < 0.45) continue
          if (Math.min(e[1], e[3]) / Math.max(e[1], e[3]) < 0.45) continue
          const pairA = e[0] + e[2]
          const pairB = e[1] + e[3]
          const aspect = Math.min(pairA, pairB) / Math.max(pairA, pairB)
          if (aspect < 0.4 || aspect > 0.97) continue
          const meanSide = sides.reduce((s, v) => s + v, 0) / 4
          const sizeRatio = meanSide / Math.sqrt(area)
          if (sizeRatio < EXPECTED_SIDE_RATIO * 0.5 || sizeRatio > EXPECTED_SIDE_RATIO * 2) continue
          const sizeFit = Math.exp(-(Math.log(sizeRatio / EXPECTED_SIDE_RATIO) ** 2) / 0.2)
          const aspectFit = Math.exp(-(Math.log(aspect / EXPECTED_ASPECT) ** 2) / 0.2)
          const score = area * uniformity * sizeFit * aspectFit
          sets.push({ squares: ordered, score })
        }
      }
    }
  }
  return sets.sort((x, y) => y.score - x.score).slice(0, limit)
}
