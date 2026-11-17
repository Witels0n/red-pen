// Detected boxes: likely fill-in areas found on a rendered page with plain image processing
// (no OCR). Pure and DOM-free so it runs in a Web Worker and in unit tests.
//
// Steps: binarise the page, keep only the straight ink runs (horizontal and vertical), then
//  - enclosed blank regions inside those runs are rectangles, table cells or tick boxes;
//  - long thin horizontal runs with blank space above them are write-on-the-line fields.
// Every size is given in page units (points) and converted with `scale` (pixels per point).

export type DetectedKind = 'line' | 'box' | 'tick'

/**
 * A likely fill-in area, in page units (origin top-left, y down).
 * For a box or tick box: its blank interior. For a line: the line itself
 * (`y` is the top of the line, `height` its thickness).
 */
export interface DetectedBox {
  kind: DetectedKind
  x: number
  y: number
  width: number
  height: number
}

/** Tunables, all in points. */
export const DETECT = {
  /** Shortest straight run of ink that can be part of a box edge. */
  minEdgeRun: 5,
  /** Gaps up to this long inside a run are bridged (scan noise, dashed edges). */
  gap: 1,
  /** Shortest write-on-the-line field. */
  minLine: 36,
  /** Thicker than this is a filled bar, not a line. */
  maxLineThickness: 3,
  /** Height of the band above a line that must be blank for it to be a fill-in line. */
  lineClearance: 9,
  /** Tick boxes are near-square with sides in this range. */
  tickMin: 5,
  tickMax: 24,
  /** Text boxes and table cells are at least this big. */
  boxMinWidth: 12,
  boxMinHeight: 7,
} as const

/** Lines spanning more than this share of the page width are rules or borders. */
const MAX_LINE_SHARE = 0.85
/** Rectangles covering more than this share of the page are borders or frames. */
const MAX_BOX_AREA_SHARE = 0.25
/** An enclosed region must fill at least this share of its bounding box to be a rectangle. */
const MIN_FILL = 0.85
/** Above this ink density, the band above a line holds text, so the line is an underline. */
const MAX_INK_ABOVE_LINE = 0.04

/** Otsu's threshold for an 8-bit grey histogram. */
export function otsuThreshold(histogram: ArrayLike<number>, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]
  let sumB = 0
  let weightB = 0
  let best = 0
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t]
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += t * histogram[t]
    const meanB = sumB / weightB
    const meanF = (sum - sumB) / weightF
    const between = weightB * weightF * (meanB - meanF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * RGBA pixels to a binary image (1 = ink). The threshold is Otsu's, kept within sane bounds so
 * a blank or very dark page does not flip. Transparent pixels count as white paper.
 */
export function binarise(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const n = width * height
  const grey = new Uint8Array(n)
  const histogram = new Uint32Array(256)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3] / 255
    const g = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
    const v = Math.round(g * a + 255 * (1 - a))
    grey[i] = v
    histogram[v]++
  }
  const t = Math.min(200, Math.max(100, otsuThreshold(histogram, n)))
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = grey[i] < t ? 1 : 0
  return out
}

interface Run {
  y: number
  x1: number
  x2: number
}

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Find likely fill-in areas in a binary image (1 = ink) of a page rendered at `scale`
 * pixels per point. Returns them in page units, sorted top to bottom, then left to right.
 */
export function detectBoxes(bin: Uint8Array, width: number, height: number, scale: number): DetectedBox[] {
  const px = (pt: number) => Math.max(1, Math.round(pt * scale))
  const minEdge = px(DETECT.minEdgeRun)
  const gap = px(DETECT.gap)
  const minLine = px(DETECT.minLine)

  // 1. Straight runs. `mask` keeps only ink that lies on a horizontal or vertical run.
  const mask = new Uint8Array(width * height)
  const longRuns: Run[] = []
  for (let y = 0; y < height; y++) {
    const row = y * width
    let x = 0
    while (x < width) {
      if (!bin[row + x]) {
        x++
        continue
      }
      const start = x
      let end = x // last ink pixel of the run
      let blank = 0
      for (x = x + 1; x < width; x++) {
        if (bin[row + x]) {
          end = x
          blank = 0
        } else if (++blank > gap) break
      }
      const len = end - start + 1
      if (len >= minEdge) {
        mask.fill(1, row + start, row + end + 1)
        if (len >= minLine) longRuns.push({ y, x1: start, x2: end })
      }
      x = end + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let y = 0
    while (y < height) {
      if (!bin[y * width + x]) {
        y++
        continue
      }
      const start = y
      let end = y
      let blank = 0
      for (y = y + 1; y < height; y++) {
        if (bin[y * width + x]) {
          end = y
          blank = 0
        } else if (++blank > gap) break
      }
      if (end - start + 1 >= minEdge) for (let k = start; k <= end; k++) mask[k * width + x] = 1
      y = end + 1
    }
  }

  // 2. Enclosed blank regions of the edge mask (4-connected). Text inside a cell is not in the
  //    mask, so it does not split the cell. Regions touching the image edge are outside everything.
  const pageArea = width * height
  const boxes: (Rect & { kind: 'box' | 'tick' })[] = []
  const seen = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  for (let start = 0; start < pageArea; start++) {
    if (mask[start] || seen[start]) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let area = 0
    let x1 = width
    let y1 = height
    let x2 = -1
    let y2 = -1
    let touchesEdge = false
    while (top > 0) {
      const i = stack[--top]
      const x = i % width
      const y = (i - x) / width
      area++
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      if (x > 0 && !mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1)
      if (x < width - 1 && !mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1)
      if (y > 0 && !mask[i - width] && !seen[i - width]) (seen[i - width] = 1), (stack[top++] = i - width)
      if (y < height - 1 && !mask[i + width] && !seen[i + width]) (seen[i + width] = 1), (stack[top++] = i + width)
    }
    if (touchesEdge) continue
    const w = x2 - x1 + 1
    const h = y2 - y1 + 1
    if (w * h > pageArea * MAX_BOX_AREA_SHARE) continue
    if (area / (w * h) < MIN_FILL) continue
    if (!hasStraightEdges(bin, width, height, x1, y1, x2, y2)) continue
    if (inkedCorners(bin, width, x1, y1, x2, y2) >= 3) continue
    const aspect = w / h
    if (w >= px(DETECT.tickMin) && h >= px(DETECT.tickMin) && w <= px(DETECT.tickMax) && h <= px(DETECT.tickMax) && aspect >= 0.75 && aspect <= 1.33) {
      boxes.push({ kind: 'tick', x1, y1, x2, y2 })
    } else if (w >= px(DETECT.boxMinWidth) && h >= px(DETECT.boxMinHeight)) {
      boxes.push({ kind: 'box', x1, y1, x2, y2 })
    }
  }

  // 3. Long thin horizontal segments: group long runs in touching rows.
  const segments: Rect[] = []
  let open: Rect[] = []
  let openY = -2
  for (const run of longRuns) {
    if (run.y !== openY) {
      const next: Rect[] = []
      for (const s of open) {
        if (s.y2 >= run.y - 1) next.push(s)
        else segments.push(s)
      }
      open = next
      openY = run.y
    }
    const join = open.find((s) => s.y2 === run.y - 1 && overlap(s.x1, s.x2, run.x1, run.x2) >= 0.5 * Math.min(s.x2 - s.x1, run.x2 - run.x1))
    if (join) {
      join.x1 = Math.min(join.x1, run.x1)
      join.x2 = Math.max(join.x2, run.x2)
      join.y2 = run.y
    } else {
      open.push({ x1: run.x1, x2: run.x2, y1: run.y, y2: run.y })
    }
  }
  segments.push(...open)

  const lines: Rect[] = []
  const near = px(DETECT.maxLineThickness)
  for (const s of segments) {
    const len = s.x2 - s.x1 + 1
    if (s.y2 - s.y1 + 1 > px(DETECT.maxLineThickness)) continue
    if (len > width * MAX_LINE_SHARE) continue
    // An edge of a detected box or table cell, not a line to write on.
    let covered = 0
    for (const b of boxes) {
      const isEdge = Math.abs(b.y1 - 1 - s.y2) <= near || Math.abs(b.y2 + 1 - s.y1) <= near
      if (isEdge) covered += overlap(s.x1, s.x2, b.x1, b.x2)
    }
    if (covered >= 0.5 * len) continue
    // Text right above it means it underlines words.
    const bandTop = Math.max(0, s.y1 - px(DETECT.lineClearance))
    const bandBottom = s.y1 - px(1.5)
    if (bandBottom <= bandTop) continue
    let ink = 0
    for (let y = bandTop; y < bandBottom; y++) for (let x = s.x1; x <= s.x2; x++) ink += bin[y * width + x]
    if (ink / ((bandBottom - bandTop) * len) > MAX_INK_ABOVE_LINE) continue
    // A second stroke of the same line (double underline, scan ghost) is a duplicate.
    const twin = lines.find((l) => Math.abs(l.y1 - s.y1) <= near * 2 && overlap(l.x1, l.x2, s.x1, s.x2) >= 0.8 * Math.min(len, l.x2 - l.x1 + 1))
    if (twin) continue
    lines.push(s)
  }

  // 4. Merge duplicate boxes (the same box found twice, e.g. through a doubled edge).
  const kept: typeof boxes = []
  for (const b of boxes.sort((a, c) => area(c) - area(a))) {
    if (!kept.some((k) => k.kind === b.kind && iou(k, b) > 0.6)) kept.push(b)
  }

  const out: DetectedBox[] = [
    ...kept.map((b) => ({ kind: b.kind, x: b.x1 / scale, y: b.y1 / scale, width: (b.x2 - b.x1 + 1) / scale, height: (b.y2 - b.y1 + 1) / scale })),
    ...lines.map((l) => ({ kind: 'line' as const, x: l.x1 / scale, y: l.y1 / scale, width: (l.x2 - l.x1 + 1) / scale, height: (l.y2 - l.y1 + 1) / scale })),
  ]
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * A rectangle has ink right outside each side of its interior, corner to corner. The inside of
 * a letter such as "O" does not: its corners are open. The band allows for a slightly skewed scan.
 */
function hasStraightEdges(bin: Uint8Array, width: number, height: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const MIN_COVER = 0.9
  const side = (len: number) => 2 + Math.ceil(len * 0.02)
  const dh = side(x2 - x1 + 1)
  const dv = side(y2 - y1 + 1)
  const inkAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && bin[y * width + x] === 1
  let top = 0
  let bottom = 0
  for (let x = x1; x <= x2; x++) {
    for (let k = 1; k <= dh; k++) if (inkAt(x, y1 - k)) (top++, (k = dh + 1))
    for (let k = 1; k <= dh; k++) if (inkAt(x, y2 + k)) (bottom++, (k = dh + 1))
  }
  let left = 0
  let right = 0
  for (let y = y1; y <= y2; y++) {
    for (let k = 1; k <= dv; k++) if (inkAt(x1 - k, y)) (left++, (k = dv + 1))
    for (let k = 1; k <= dv; k++) if (inkAt(x2 + k, y)) (right++, (k = dv + 1))
  }
  const w = x2 - x1 + 1
  const h = y2 - y1 + 1
  return top >= w * MIN_COVER && bottom >= w * MIN_COVER && left >= h * MIN_COVER && right >= h * MIN_COVER
}

/**
 * How many corners of a region hold ink. A box's interior is blank in its corners; the inside of
 * a round letter is filled there by the curve of the stroke.
 */
function inkedCorners(bin: Uint8Array, width: number, x1: number, y1: number, x2: number, y2: number): number {
  const c = Math.max(1, Math.round(Math.min(x2 - x1 + 1, y2 - y1 + 1) * 0.18))
  let count = 0
  for (const [cx, cy] of [
    [x1, y1],
    [x2 - c + 1, y1],
    [x1, y2 - c + 1],
    [x2 - c + 1, y2 - c + 1],
  ]) {
    let ink = false
    for (let y = cy; y < cy + c && !ink; y++) for (let x = cx; x < cx + c && !ink; x++) ink = bin[y * width + x] === 1
    if (ink) count++
  }
  return count
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1) + 1)
}

function area(r: Rect): number {
  return (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1)
}

function iou(a: Rect, b: Rect): number {
  const inter = overlap(a.x1, a.x2, b.x1, b.x2) * overlap(a.y1, a.y2, b.y1, b.y2)
  return inter / (area(a) + area(b) - inter)
}

/** Detected boxes that a real form field already covers are left out. */
export function withoutCovered(boxes: readonly DetectedBox[], fields: readonly { x: number; y: number; width: number; height: number }[]): DetectedBox[] {
  return boxes.filter((b) => {
    const bh = b.kind === 'line' ? 14 : b.height
    const by = b.kind === 'line' ? b.y - bh : b.y
    return !fields.some((f) => {
      const ix = Math.max(0, Math.min(b.x + b.width, f.x + f.width) - Math.max(b.x, f.x))
      const iy = Math.max(0, Math.min(by + bh, f.y + f.height) - Math.max(by, f.y))
      return ix * iy >= 0.5 * Math.min(b.width * bh, f.width * f.height)
    })
  })
}
