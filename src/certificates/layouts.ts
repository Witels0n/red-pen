// Sheet geometry for labels, desk cards and award slips on A4. Pure; see tests/certificates.
// Sizes the teacher types are in millimetres; everything returned is in PDF points, origin at the
// top left of the page, y down (the renderer flips it).

export const MM = 72 / 25.4
export const A4 = { width: 595.28, height: 841.89 }
export const A4_MM = { width: 210, height: 297 }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A grid of sticky labels on an A4 sheet, in millimetres. */
export interface LabelLayout {
  columns: number
  rows: number
  /** One label's size. */
  width: number
  height: number
  /** From the top and left edges of the sheet to the first label. */
  top: number
  left: number
  /** From the start of one label to the start of the next, across and down. */
  pitchX: number
  pitchY: number
}

export interface LabelPreset {
  id: string
  name: string
  layout: LabelLayout
}

/** Common label sheets. The sizes match the usual A4 label codes, so sheets from most brands line up. */
export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    id: '3x7',
    name: '3 × 7, 21 labels of 63.5 × 38.1 mm (L7160)',
    layout: { columns: 3, rows: 7, width: 63.5, height: 38.1, top: 15.15, left: 7.2, pitchX: 66, pitchY: 38.1 },
  },
  {
    id: '2x7',
    name: '2 × 7, 14 labels of 99.1 × 38.1 mm (L7163)',
    layout: { columns: 2, rows: 7, width: 99.1, height: 38.1, top: 15.15, left: 4.65, pitchX: 101.6, pitchY: 38.1 },
  },
  {
    id: '3x8',
    name: '3 × 8, 24 labels of 63.5 × 33.9 mm (L7159)',
    layout: { columns: 3, rows: 8, width: 63.5, height: 33.9, top: 12.9, left: 6.45, pitchX: 66.04, pitchY: 33.9 },
  },
  {
    id: '2x4',
    name: '2 × 4, 8 labels of 99.1 × 67.7 mm (L7165)',
    layout: { columns: 2, rows: 4, width: 99.1, height: 67.7, top: 13.1, left: 4.65, pitchX: 101.6, pitchY: 67.7 },
  },
  {
    id: '4x10',
    name: '4 × 10, 40 labels of 45.7 × 25.4 mm (L7654)',
    layout: { columns: 4, rows: 10, width: 45.7, height: 25.4, top: 21.5, left: 9.7, pitchX: 48.3, pitchY: 25.4 },
  },
]

export function presetLayout(id: string): LabelLayout | undefined {
  const p = LABEL_PRESETS.find((x) => x.id === id)
  return p ? { ...p.layout } : undefined
}

/** Why a layout cannot be printed, or an empty list when it can. */
export function layoutProblems(l: LabelLayout): string[] {
  const problems: string[] = []
  const whole = (n: number) => Number.isInteger(n) && n >= 1 && n <= 20
  if (!whole(l.columns)) problems.push('Columns must be a whole number from 1 to 20.')
  if (!whole(l.rows)) problems.push('Rows must be a whole number from 1 to 20.')
  for (const [name, v] of [
    ['Label width', l.width],
    ['Label height', l.height],
  ] as const)
    if (!(Number.isFinite(v) && v >= 10)) problems.push(`${name} must be at least 10 mm.`)
  for (const [name, v] of [
    ['Top margin', l.top],
    ['Left margin', l.left],
  ] as const)
    if (!(Number.isFinite(v) && v >= 0)) problems.push(`${name} cannot be negative.`)
  if (problems.length > 0) return problems
  if (l.columns > 1 && l.pitchX < l.width - 0.01)
    problems.push('The labels overlap across: the pitch across is less than the label width.')
  if (l.rows > 1 && l.pitchY < l.height - 0.01)
    problems.push('The labels overlap down: the pitch down is less than the label height.')
  const right = l.left + (l.columns - 1) * l.pitchX + l.width
  const bottom = l.top + (l.rows - 1) * l.pitchY + l.height
  if (right > A4_MM.width + 0.5)
    problems.push(`The labels run ${(right - A4_MM.width).toFixed(1)} mm off the right of the sheet.`)
  if (bottom > A4_MM.height + 0.5)
    problems.push(`The labels run ${(bottom - A4_MM.height).toFixed(1)} mm off the bottom of the sheet.`)
  return problems
}

/** Every label on one sheet, across then down, in points from the top left. */
export function labelCells(l: LabelLayout): Rect[] {
  const cells: Rect[] = []
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < l.columns; c++)
      cells.push({
        x: (l.left + c * l.pitchX) * MM,
        y: (l.top + r * l.pitchY) * MM,
        width: l.width * MM,
        height: l.height * MM,
      })
  return cells
}

/** Where each item goes: item i on sheet `page`, in cell `cell`, after `skip` used labels on the first sheet. */
export function placeItems(count: number, perSheet: number, skip = 0): { page: number; cell: number }[] {
  const start = Math.max(0, Math.min(Math.floor(skip), perSheet - 1))
  return Array.from({ length: count }, (_, i) => ({
    page: Math.floor((i + start) / perSheet),
    cell: (i + start) % perSheet,
  }))
}

/** How many sheets `count` items need. */
export function sheetCount(count: number, perSheet: number, skip = 0): number {
  const placed = placeItems(count, perSheet, skip)
  return placed.length === 0 ? 0 : placed[placed.length - 1].page + 1
}

/** A folded desk card: two panels either side of the fold. The back panel is drawn upside down. */
export interface TentCard {
  /** The whole card, cut out along its edges. */
  card: Rect
  /** Above the fold: printed upside down, so it reads the right way up from the other side. */
  back: Rect
  /** Below the fold: faces the teacher's side, or the class with "both sides". */
  front: Rect
  /** The fold, as a y position across the card. */
  foldY: number
}

/** Two desk cards per A4 portrait sheet, one in each half, folded across the middle. */
export function tentCards(): TentCard[] {
  const half = A4.height / 2
  return [0, 1].map((i) => {
    const top = i * half
    const panel = half / 2
    return {
      card: { x: 0, y: top, width: A4.width, height: half },
      back: { x: 0, y: top, width: A4.width, height: panel },
      front: { x: 0, y: top + panel, width: A4.width, height: panel },
      foldY: top + panel,
    }
  })
}

/** Four award slips per A4 portrait sheet, one above the other, to cut apart. */
export function slipCells(): Rect[] {
  const h = A4.height / 4
  return [0, 1, 2, 3].map((i) => ({ x: 0, y: i * h, width: A4.width, height: h }))
}
