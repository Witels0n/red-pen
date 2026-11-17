// Corner geometry for cropping a photo of a page. Pure, so it is unit tested (tests/scan-geometry.test.ts).
import type { Point } from '../shared/omr/homography'

export type { Point }

/** Four corners in the order top left, top right, bottom right, bottom left (image coordinates, y down). */
export type Quad = [Point, Point, Point, Point]

/** A quarter turn count: 0, 1, 2 or 3 turns clockwise. */
export type Turns = 0 | 1 | 2 | 3

/** The whole image, in coordinates from 0 to 1. */
export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

/**
 * Puts four points in the order top left, top right, bottom right, bottom left, whatever order
 * they came in. Points are sorted by angle around their centre (clockwise on screen), then the
 * list is turned so that the point nearest the top left (smallest x + y) comes first.
 */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error('A page has four corners.')
  const cx = points.reduce((s, p) => s + p.x, 0) / 4
  const cy = points.reduce((s, p) => s + p.y, 0) / 4
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let first = 0
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i
  }
  return [0, 1, 2, 3].map((i) => ({ ...sorted[(first + i) % 4] })) as Quad
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Whether the corners, in order, make a convex shape with some area (so the warp is well defined). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])
    if (Math.abs(c) < 1e-9) return false
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** The area enclosed by the points, in order (shoelace formula). */
export function polygonArea(points: readonly Point[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const n = points[(i + 1) % points.length]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

/** Scales corners, for example from 0 to 1 coordinates up to the pixels of an image. */
export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad
}

/** Keeps every corner inside the image (0 to 1 coordinates). */
export function clampQuad(q: Quad): Quad {
  const c = (v: number) => Math.max(0, Math.min(1, v))
  return q.map((p) => ({ x: c(p.x), y: c(p.y) })) as Quad
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The size in pixels of the straightened page: the average length of the opposite edges,
 * shrunk (keeping the shape) so the longer side is at most `maxSide`.
 */
export function straightenedSize(q: Quad, maxSide: number): { width: number; height: number } {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
  const scale = Math.min(1, maxSide / Math.max(w, h, 1))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** The width and height after `turns` quarter turns. */
export function turnedSize(width: number, height: number, turns: Turns): { width: number; height: number } {
  return turns % 2 === 0 ? { width, height } : { width: height, height: width }
}

/** One more quarter turn clockwise (`by` = 1) or anticlockwise (`by` = -1). */
export function addTurn(turns: Turns, by: 1 | -1): Turns {
  return ((((turns + by) % 4) + 4) % 4) as Turns
}
