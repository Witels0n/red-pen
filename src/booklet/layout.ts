// Page-order and placement maths for Booklet printing. Pure: no DOM, no pdf-lib.
// Units are PDF points (1/72 inch); the origin is the bottom-left corner of a sheet.

export const MM = 72 / 25.4

export type Mode = 'booklet' | 'nup' | 'repeat'
export type Orientation = 'auto' | 'portrait' | 'landscape'
export type SheetSize = 'A4' | 'A3'
/** Which edge a duplex printer turns the sheet over on. Booklets on landscape sheets need the short edge. */
export type Flip = 'short' | 'long'
export type Rotation = 0 | 90 | 180 | 270

export const PAPER: Record<SheetSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
}

export const NUP_COUNTS = [2, 4, 6, 9] as const
export type NupCount = (typeof NUP_COUNTS)[number]
export const REPEAT_COUNTS = [2, 4] as const
export type RepeatCount = (typeof REPEAT_COUNTS)[number]

export interface Settings {
  mode: Mode
  sheet: SheetSize
  /** Booklet: how the printer turns the sheet. */
  flip: Flip
  /** Booklet: put blank pages before the last page, so it stays the back cover. */
  keepBackCover: boolean
  /** Booklet: creep allowance in mm per sheet; 0 ignores creep. */
  creepMm: number
  nup: NupCount
  repeat: RepeatCount
  orientation: Orientation
  /** N-up and repeat: space around the edge of the sheet, in mm. */
  marginMm: number
  /** N-up and repeat: space between pages, in mm. */
  gapMm: number
  /** N-up: a thin border around each page. */
  borders: boolean
  /** Repeat: dashed lines to cut along. */
  cutLines: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'booklet',
  sheet: 'A4',
  flip: 'short',
  keepBackCover: false,
  creepMm: 0,
  nup: 4,
  repeat: 2,
  orientation: 'auto',
  marginMm: 5,
  gapMm: 3,
  borders: false,
  cutLines: true,
}

/** A source page's size as stored (its crop box) and the rotation it is shown with. */
export interface SourcePage {
  width: number
  height: number
  rotation: Rotation
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Where to draw one source page: the point to draw from, the scale and the clockwise rotation. */
export interface Placement {
  x: number
  y: number
  scale: number
  /** Clockwise, as a PDF /Rotate value. pdf-lib's drawPage rotates anticlockwise, so it gets -rotation. */
  rotation: Rotation
  /** The rectangle the page covers once drawn. */
  box: Rect
}

export interface Slot {
  /** 0-based source page, or null for a blank page. */
  source: number | null
  cell: Rect
  /** Extra clockwise turn for this slot (the back of a long-edge booklet sheet is upside down). */
  turn: Rotation
  /** Sideways shift for creep, in points (positive is to the right, before any turn). */
  shiftX: number
}

export interface OutputSheet {
  width: number
  height: number
  /** A label for the preview, e.g. "Sheet 1, front". */
  label: string
  slots: Slot[]
  borders: Rect[]
  cutLines: Line[]
}

/** Round up to a multiple of 4. */
export function paddedLength(pageCount: number): number {
  return Math.max(4, Math.ceil(pageCount / 4) * 4)
}

/**
 * The booklet's page sequence after padding with blanks (null) to a multiple of 4.
 * Blanks go at the end, or before the last page when it must stay the back cover.
 */
export function paddedSequence(pageCount: number, keepBackCover = false): (number | null)[] {
  const total = paddedLength(pageCount)
  const pages: (number | null)[] = Array.from({ length: pageCount }, (_, i) => i)
  const blanks: null[] = Array.from({ length: total - pageCount }, () => null)
  if (keepBackCover && pageCount >= 2 && blanks.length > 0) {
    return [...pages.slice(0, -1), ...blanks, pageCount - 1]
  }
  return [...pages, ...blanks]
}

/** One folded sheet of a saddle-stitched booklet: the two halves of each side, left then right. */
export interface BookletSheet {
  front: [number | null, number | null]
  back: [number | null, number | null]
}

/**
 * Imposition for a saddle-stitched booklet. With N padded pages (0-based), sheet i carries
 * front: N-1-2i | 2i, back: 2i+1 | N-2-2i. Sheet 0 is the outside sheet (covers);
 * stacking the printed sheets in order and folding gives pages in reading order.
 */
export function bookletSheets(pageCount: number, keepBackCover = false): BookletSheet[] {
  const seq = paddedSequence(pageCount, keepBackCover)
  const n = seq.length
  return Array.from({ length: n / 4 }, (_, i) => ({
    front: [seq[n - 1 - 2 * i], seq[2 * i]],
    back: [seq[2 * i + 1], seq[n - 2 - 2 * i]],
  }))
}

/** Columns and rows for N pages per sheet, reading across then down. */
export function gridFor(count: number, landscape: boolean): { cols: number; rows: number } {
  switch (count) {
    case 1:
      return { cols: 1, rows: 1 }
    case 2:
      return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 }
    case 4:
      return { cols: 2, rows: 2 }
    case 6:
      return landscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 }
    case 9:
      return { cols: 3, rows: 3 }
    default:
      throw new Error(`Unsupported pages per sheet: ${count}`)
  }
}

/** The cells of a grid on a sheet, in reading order (across, then down), inside a margin and with gaps. */
export function gridCells(
  sheet: { width: number; height: number },
  grid: { cols: number; rows: number },
  margin: number,
  gap: number,
): Rect[] {
  const usableW = Math.max(1, sheet.width - 2 * margin - gap * (grid.cols - 1))
  const usableH = Math.max(1, sheet.height - 2 * margin - gap * (grid.rows - 1))
  const w = usableW / grid.cols
  const h = usableH / grid.rows
  const cells: Rect[] = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      cells.push({
        x: margin + c * (w + gap),
        // PDF y runs upwards, so the top row has the largest y.
        y: sheet.height - margin - (r + 1) * h - r * gap,
        width: w,
        height: h,
      })
    }
  }
  return cells
}

/** A page's shown size once its rotation is applied. */
export function shownSize(page: SourcePage, extra: Rotation = 0): { width: number; height: number } {
  const r = (page.rotation + extra) % 360
  return r === 90 || r === 270 ? { width: page.height, height: page.width } : { width: page.width, height: page.height }
}

export function addRotation(a: Rotation, b: Rotation): Rotation {
  return ((a + b) % 360) as Rotation
}

/** Fit a page (with its rotation plus `turn`) into a cell, as large as it goes, centred. */
export function fitInto(cell: Rect, page: SourcePage, turn: Rotation = 0, shiftX = 0): Placement {
  const rotation = addRotation(page.rotation, turn)
  const shown = shownSize(page, turn)
  const scale = Math.min(cell.width / shown.width, cell.height / shown.height)
  const w = shown.width * scale
  const h = shown.height * scale
  const x0 = cell.x + (cell.width - w) / 2 + shiftX
  const y0 = cell.y + (cell.height - h) / 2
  // drawPage translates to (x, y) and then rotates about that point, so move the origin to the
  // corner the unrotated page's bottom-left lands on.
  const origin: Record<Rotation, [number, number]> = {
    0: [x0, y0],
    90: [x0, y0 + h],
    180: [x0 + w, y0 + h],
    270: [x0 + w, y0],
  }
  const [x, y] = origin[rotation]
  return { x, y, scale, rotation, box: { x: x0, y: y0, width: w, height: h } }
}

/** The sheet size for an orientation. */
export function sheetDims(size: SheetSize, landscape: boolean): { width: number; height: number } {
  const p = PAPER[size]
  return landscape ? { width: p.height, height: p.width } : { width: p.width, height: p.height }
}

/**
 * For "auto", the orientation that shows the pages largest (judged on the first page).
 * Ties go to portrait.
 */
export function chooseLandscape(
  orientation: Orientation,
  count: number,
  size: SheetSize,
  page: SourcePage,
  margin: number,
  gap: number,
): boolean {
  if (orientation !== 'auto') return orientation === 'landscape'
  const scaleFor = (landscape: boolean) => {
    const cell = gridCells(sheetDims(size, landscape), gridFor(count, landscape), margin, gap)[0]
    return fitInto(cell, page).scale
  }
  return scaleFor(true) > scaleFor(false) + 1e-6
}

/** Turn the cell (and so the page drawn in it) half a turn about the sheet's centre. */
function upsideDown(slot: Slot, sheet: { width: number; height: number }): Slot {
  const { cell } = slot
  return {
    ...slot,
    cell: { ...cell, x: sheet.width - cell.x - cell.width, y: sheet.height - cell.y - cell.height },
    turn: addRotation(slot.turn, 180),
    shiftX: -slot.shiftX,
  }
}

/** Creep shift for sheet i (0 is the outside sheet): inner sheets move further towards the fold. */
export function creepShift(sheetIndex: number, creepMm: number): number {
  return sheetIndex * creepMm * MM
}

function bookletPlan(s: Settings, pageCount: number): OutputSheet[] {
  const sheet = sheetDims(s.sheet, true)
  const margin = Math.max(0, s.marginMm) * MM
  const half = sheet.width / 2
  const left: Rect = { x: margin, y: margin, width: half - margin, height: sheet.height - 2 * margin }
  const right: Rect = { x: half, y: margin, width: half - margin, height: sheet.height - 2 * margin }
  const out: OutputSheet[] = []
  bookletSheets(pageCount, s.keepBackCover).forEach((b, i) => {
    const shift = creepShift(i, Math.max(0, s.creepMm))
    // The fold is between the halves: the left page moves right and the right page moves left.
    const side = (pair: [number | null, number | null]): Slot[] => [
      { source: pair[0], cell: left, turn: 0, shiftX: shift },
      { source: pair[1], cell: right, turn: 0, shiftX: -shift },
    ]
    const back = side(b.back)
    out.push(
      { ...sheet, label: `Sheet ${i + 1}, front`, slots: side(b.front), borders: [], cutLines: [] },
      {
        ...sheet,
        label: `Sheet ${i + 1}, back`,
        slots: s.flip === 'long' ? back.map((slot) => upsideDown(slot, sheet)) : back,
        borders: [],
        cutLines: [],
      },
    )
  })
  return out
}

/** Lines between grid cells, through the middle of each gap, running edge to edge. */
export function cutLinesFor(
  sheet: { width: number; height: number },
  cells: Rect[],
  cols: number,
  rows: number,
): Line[] {
  const lines: Line[] = []
  for (let c = 1; c < cols; c++) {
    const a = cells[c - 1]
    const b = cells[c]
    const x = (a.x + a.width + b.x) / 2
    lines.push({ x1: x, y1: 0, x2: x, y2: sheet.height })
  }
  for (let r = 1; r < rows; r++) {
    const a = cells[(r - 1) * cols]
    const b = cells[r * cols]
    const y = (a.y + b.y + b.height) / 2
    lines.push({ x1: 0, y1: y, x2: sheet.width, y2: y })
  }
  return lines
}

function gridPlan(s: Settings, pages: readonly SourcePage[], repeat: boolean): OutputSheet[] {
  const count = repeat ? s.repeat : s.nup
  const margin = Math.max(0, s.marginMm) * MM
  const gap = Math.max(0, s.gapMm) * MM
  const landscape = chooseLandscape(s.orientation, count, s.sheet, pages[0], margin, gap)
  const sheet = sheetDims(s.sheet, landscape)
  const grid = gridFor(count, landscape)
  const cells = gridCells(sheet, grid, margin, gap)
  const out: OutputSheet[] = []
  const sheetCount = repeat ? pages.length : Math.ceil(pages.length / count)
  for (let i = 0; i < sheetCount; i++) {
    const slots: Slot[] = cells.map((cell, k) => {
      const index = repeat ? i : i * count + k
      return { source: index < pages.length ? index : null, cell, turn: 0, shiftX: 0 }
    })
    const used = slots.filter((slot) => slot.source !== null)
    out.push({
      ...sheet,
      label: `Sheet ${i + 1}`,
      slots,
      borders: s.borders && !repeat ? used.map((slot) => fitInto(slot.cell, pages[slot.source!], slot.turn).box) : [],
      cutLines: repeat && s.cutLines ? cutLinesFor(sheet, cells, grid.cols, grid.rows) : [],
    })
  }
  return out
}

/** Every output sheet (each side of a booklet sheet counts as one) for these settings and pages. */
export function planSheets(s: Settings, pages: readonly SourcePage[]): OutputSheet[] {
  if (pages.length === 0) return []
  if (s.mode === 'booklet') return bookletPlan(s, pages.length)
  return gridPlan(s, pages, s.mode === 'repeat')
}

/** "front 8 | 1, back 2 | 7" style labels (1-based, "blank" for padding) for the sheet order list. */
export function describePair(pair: [number | null, number | null]): string {
  const name = (p: number | null) => (p === null ? 'blank' : String(p + 1))
  return `${name(pair[0])} | ${name(pair[1])}`
}

/** Clamp and fill in saved settings. */
export function sanitiseSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const oneOf = <T>(v: unknown, options: readonly T[], fallback: T): T =>
    options.includes(v as T) ? (v as T) : fallback
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    mode: oneOf(s.mode, ['booklet', 'nup', 'repeat'] as const, d.mode),
    sheet: oneOf(s.sheet, ['A4', 'A3'] as const, d.sheet),
    flip: oneOf(s.flip, ['short', 'long'] as const, d.flip),
    keepBackCover: bool(s.keepBackCover, d.keepBackCover),
    creepMm: num(s.creepMm, 0, 2, d.creepMm),
    nup: oneOf(s.nup, NUP_COUNTS, d.nup),
    repeat: oneOf(s.repeat, REPEAT_COUNTS, d.repeat),
    orientation: oneOf(s.orientation, ['auto', 'portrait', 'landscape'] as const, d.orientation),
    marginMm: num(s.marginMm, 0, 30, d.marginMm),
    gapMm: num(s.gapMm, 0, 30, d.gapMm),
    borders: bool(s.borders, d.borders),
    cutLines: bool(s.cutLines, d.cutLines),
  }
}

export const STORAGE_KEY = 'red-pen.booklet.settings'

export function loadSettings(storage?: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)
    return sanitiseSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or full storage: the settings just are not remembered.
  }
}
