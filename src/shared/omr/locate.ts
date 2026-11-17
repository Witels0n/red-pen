// Finds the sheet in a photo or scan: the corner squares, which way up it is, the transform from
// layout space to image pixels, the sheet's own paper and ink levels, and the QR.
import { EXPECTED_ASPECT, findSquares, rankCornerSets, type CornerSet } from './fiducials'
import { applyHomography, homographyFrom, localScale, type Homography, type Point } from './homography'
import {
  adaptiveThreshold,
  darknessAt,
  downscale,
  paperAt,
  paperMap,
  toGray,
  WORKING_LONG_SIDE,
  type GrayImage,
  type PaperMap,
  type RgbaImage,
} from './image'
import { centreOf, fiducialRects, MM, ORIENTATION_MARK, rotated180 } from './layout'
import { decodeQrAnywhere, decodeQrCrop } from './qr-decode'
import { decodeSheetQr, type SheetQr } from './qr-payload'
import type { Rect } from './types'

const DETECTION_LONG_SIDE = 1100

export const NOT_FOUND =
  'All four corner squares must be in the photo. Take it again from straight above, with the whole page showing.'

export interface LocatedSheet {
  /** The working greyscale image (the input, perhaps downscaled by `scale`). */
  gray: GrayImage
  /** Input pixels per working pixel. */
  scale: number
  paper: PaperMap
  /** Layout points to working pixels. */
  h: Homography
  /** Mean darkness of the corner squares: the sheet's printed black. */
  ink: number
  rotation: 0 | 90 | 180 | 270
  corners: Point[]
  qr: SheetQr | null
  qrText?: string
  qrSource?: 'crop' | 'full' | 'hint'
  /** True when neither the orientation mark nor the QR settled which way up the sheet is. */
  orientationUnsure: boolean
}

export type LocateResult = { ok: true; sheet: LocatedSheet } | { ok: false; problem: string }

const LAYOUT_CENTRES = fiducialRects().map(centreOf)

/** Mean darkness over a grid of points inside a layout rectangle (inset by `inset` of its size). */
function rectDarkness(
  g: GrayImage,
  p: PaperMap,
  h: Homography,
  r: Rect,
  inset = 0.2,
  n = 6,
): { mean: number; min: number } {
  let sum = 0
  let min = 1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = r.x + r.w * (inset + ((1 - 2 * inset) * (i + 0.5)) / n)
      const y = r.y + r.h * (inset + ((1 - 2 * inset) * (j + 0.5)) / n)
      const q = applyHomography(h, x, y)
      const d = darknessAt(g, p, q.x, q.y)
      sum += d
      if (d < min) min = d
    }
  }
  return { mean: sum / (n * n), min }
}

/** Mean darkness on a square ring `gap` outside a layout rectangle. */
function ringDarkness(g: GrayImage, p: PaperMap, h: Homography, r: Rect, gap: number): number {
  const x0 = r.x - gap
  const y0 = r.y - gap
  const w = r.w + 2 * gap
  const hh = r.h + 2 * gap
  const steps = 10
  let sum = 0
  let n = 0
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    for (const [x, y] of [
      [x0 + t * w, y0],
      [x0 + t * w, y0 + hh],
      [x0, y0 + t * hh],
      [x0 + w, y0 + t * hh],
    ]) {
      const q = applyHomography(h, x, y)
      sum += darknessAt(g, p, q.x, q.y)
      n++
    }
  }
  return sum / n
}

/** Moves an estimated corner-square centre to the centroid of the dark blob under it, at full resolution. */
function refineCentre(g: GrayImage, p: PaperMap, c: Point, side: number): Point {
  const cx = Math.round(c.x)
  const cy = Math.round(c.y)
  if (cx < 1 || cy < 1 || cx >= g.width - 1 || cy >= g.height - 1) return c
  const paper = paperAt(p, cx, cy)
  let core = 0
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) core += g.data[(cy + dy) * g.width + cx + dx]
  core /= 9
  if (paper - core < 20) return c
  const threshold = (paper + core) / 2
  const R = Math.max(3, Math.round(0.85 * side))
  const seen = new Uint8Array((2 * R + 1) * (2 * R + 1))
  const stack = [[cx, cy]]
  seen[R * (2 * R + 1) + R] = 1
  let sx = 0
  let sy = 0
  let n = 0
  while (stack.length) {
    const [x, y] = stack.pop()!
    sx += x
    sy += y
    n++
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      const lx = nx - cx + R
      const ly = ny - cy + R
      if (lx < 0 || ly < 0 || lx > 2 * R || ly > 2 * R) continue
      if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue
      const k = ly * (2 * R + 1) + lx
      if (seen[k]) continue
      seen[k] = 1
      if (g.data[ny * g.width + nx] < threshold) stack.push([nx, ny])
    }
  }
  if (n < 0.3 * side * side || n > 2.2 * side * side) return c
  return { x: sx / n + 0.5, y: sy / n + 0.5 }
}

/** Homography for orientation k: layout's top-left square goes to image corner k (corners clockwise). */
function homographyFor(corners: Point[], k: number): Homography {
  const dst = [0, 1, 2, 3].map((i) => corners[(i + k) % 4])
  return homographyFrom(LAYOUT_CENTRES, dst)
}

interface Verified {
  ink: number
}

/** Checks that each corner really is a solid square with bare paper round it. */
function verifyCorners(g: GrayImage, p: PaperMap, h: Homography): Verified | null {
  const rects = fiducialRects()
  const inner = rects.map((r) => rectDarkness(g, p, h, r, 0.22, 5))
  const ink = inner.reduce((s, v) => s + v.mean, 0) / 4
  if (ink < 0.2) return null
  for (let i = 0; i < 4; i++) {
    if (inner[i].mean < 0.6 * ink || inner[i].min < 0.35 * ink) return null
    if (ringDarkness(g, p, h, rects[i], 1.6 * MM) > 0.3 * ink) return null
  }
  return { ink }
}

function rotationOf(h: Homography): 0 | 90 | 180 | 270 {
  const a = applyHomography(h, LAYOUT_CENTRES[0].x, LAYOUT_CENTRES[0].y)
  const b = applyHomography(h, LAYOUT_CENTRES[1].x, LAYOUT_CENTRES[1].y)
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  const q = ((Math.round(deg / 90) % 4) + 4) % 4
  return ([0, 90, 180, 270] as const)[q]
}

function aspectMisfit(corners: Point[], k: number): number {
  const c = [0, 1, 2, 3].map((i) => corners[(i + k) % 4])
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const width = d(c[0], c[1]) + d(c[3], c[2])
  const height = d(c[0], c[3]) + d(c[1], c[2])
  return Math.abs(Math.log(width / height / EXPECTED_ASPECT))
}

export interface LocateOptions {
  /** QR texts already decoded elsewhere (for example by BarcodeDetector on the main thread). */
  qrHints?: string[]
  /** Where the QR is printed in layout space (every Red Pen sheet uses the same place). */
  qrRect: Rect
}

export function locateSheet(image: RgbaImage, opts: LocateOptions): LocateResult {
  if (image.width < 200 || image.height < 200) return { ok: false, problem: 'The image is too small to read.' }
  let gray = toGray(image)
  const long = Math.max(gray.width, gray.height)
  const scale = long > WORKING_LONG_SIDE ? Math.ceil(long / WORKING_LONG_SIDE) : 1
  gray = downscale(gray, scale)

  const f = Math.max(1, Math.round(Math.max(gray.width, gray.height) / DETECTION_LONG_SIDE))
  const det = downscale(gray, f)
  const radius = Math.max(8, Math.round(Math.min(det.width, det.height) / 14))
  const mask = adaptiveThreshold(det, radius, 0.8)
  const squares = findSquares(mask, det.width, det.height, { minArea: 16, maxArea: 0.02 * det.width * det.height })
  const sets = rankCornerSets(squares)
  if (sets.length === 0) return { ok: false, problem: NOT_FOUND }

  const block = Math.max(12, Math.round(Math.min(gray.width, gray.height) / 40))
  const paper = paperMap(gray, block)

  for (const set of sets) {
    const located = tryCornerSet(gray, paper, set, f, opts)
    if (located) return { ok: true, sheet: { ...located, scale } }
  }
  return { ok: false, problem: NOT_FOUND }
}

function tryCornerSet(
  gray: GrayImage,
  paper: PaperMap,
  set: CornerSet,
  f: number,
  opts: LocateOptions,
): Omit<LocatedSheet, 'scale'> | null {
  const corners = set.squares.map((s) => refineCentre(gray, paper, { x: s.x * f, y: s.y * f }, s.side * f))
  const markInk = (h: Homography, ink: number) =>
    (rectDarkness(gray, paper, h, ORIENTATION_MARK).mean -
      rectDarkness(gray, paper, h, rotated180(ORIENTATION_MARK)).mean) /
    ink

  type Option = { k: number; h: Homography; ink: number; score: number }
  const options: Option[] = []
  for (let k = 0; k < 4; k++) {
    let h: Homography
    try {
      h = homographyFor(corners, k)
    } catch {
      continue
    }
    const v = verifyCorners(gray, paper, h)
    if (!v) continue
    options.push({ k, h, ink: v.ink, score: markInk(h, v.ink) - 0.6 * aspectMisfit(corners, k) })
  }
  if (options.length === 0) return null
  options.sort((a, b) => b.score - a.score)
  let chosen = options[0]
  // The mark is solid ink (about 1 relative to the corners) and its rotated spot is bare paper (0).
  let orientationUnsure = chosen.score < 0.45 || (options.length > 1 && chosen.score - options[1].score < 0.35)

  let found: { qr: SheetQr; text: string; source: NonNullable<LocatedSheet['qrSource']> } | null = null
  const parse = (text: string | null | undefined, source: NonNullable<LocatedSheet['qrSource']>) => {
    const qr = text ? decodeSheetQr(text) : null
    return qr && text ? { qr, text, source } : null
  }
  for (const o of options) {
    found = parse(decodeQrCrop(gray, o.h, opts.qrRect), 'crop')
    if (found) {
      chosen = o
      orientationUnsure = false
      break
    }
    if (!orientationUnsure) break // only try other orientations when the mark could not decide
  }
  if (!found) {
    const hit = decodeQrAnywhere(gray)
    found = parse(hit?.text, 'full')
    if (hit && found) {
      // The orientation whose QR area lands nearest the decoded code is the right one.
      const qc = centreOf(opts.qrRect)
      let best = chosen
      let bestD = Infinity
      for (const o of options) {
        const p = applyHomography(o.h, qc.x, qc.y)
        const d = Math.hypot(p.x - hit.centre.x, p.y - hit.centre.y) / localScale(o.h, qc.x, qc.y)
        if (d < bestD) {
          bestD = d
          best = o
        }
      }
      if (bestD < 40) {
        chosen = best
        orientationUnsure = false
      }
    }
  }
  for (const hint of opts.qrHints ?? []) {
    if (found) break
    found = parse(hint, 'hint')
  }
  return {
    gray,
    paper,
    h: chosen.h,
    ink: chosen.ink,
    rotation: rotationOf(chosen.h),
    corners,
    qr: found?.qr ?? null,
    qrText: found?.text,
    qrSource: found?.source,
    orientationUnsure,
  }
}

/** Darkness of one image point relative to paper, for callers that sample in layout space. */
export function darknessInLayout(s: LocatedSheet, x: number, y: number): number {
  const q = applyHomography(s.h, x, y)
  return darknessAt(s.gray, s.paper, q.x, q.y)
}
