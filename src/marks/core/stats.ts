// Summary statistics and bands for one assessment's percentages. Pure and unit tested.

export type BandSchemeId = 'caps' | 'tens' | 'symbols' | 'custom'

export interface Band {
  /** For example "Level 1" or "A". */
  label: string
  /** Short form for chart axes, for example "1" or "A". */
  short: string
  /** The range as text, for example "0-29". */
  range: string
  /** The lowest percentage in the band (inclusive). */
  min: number
}

export interface BandScheme {
  id: BandSchemeId
  name: string
  /** Lowest band first; each runs up to the next band's min (exclusive), the last to 100. */
  bands: Band[]
}

export const SCHEME_NAMES: Record<BandSchemeId, string> = {
  caps: 'CAPS 7 levels',
  tens: '10% bands',
  symbols: 'Symbols (A to H)',
  custom: 'Custom cut-offs',
}

/** The default custom cut-offs: the CAPS levels. */
export const CAPS_CUTOFFS: readonly number[] = [30, 40, 50, 60, 70, 80]

function rangeText(min: number, next: number | undefined): string {
  if (next === undefined) return `${min}-100`
  return Number.isInteger(next) ? `${min}-${next - 1}` : `${min}-${next}`
}

function fromCutoffs(cutoffs: readonly number[], label: (i: number) => { label: string; short: string }): Band[] {
  const mins = [0, ...cutoffs]
  return mins.map((min, i) => ({ ...label(i), range: rangeText(min, mins[i + 1]), min }))
}

/**
 * IEB-style symbols, lowest first: H (0-9), G, FF, F, E, D, C, B, A (80-100).
 */
const SYMBOLS = ['H', 'G', 'FF', 'F', 'E', 'D', 'C', 'B', 'A']

export function bandScheme(id: BandSchemeId, customCutoffs: readonly number[] = CAPS_CUTOFFS): BandScheme {
  let bands: Band[]
  if (id === 'tens') {
    bands = fromCutoffs([10, 20, 30, 40, 50, 60, 70, 80, 90], (i) => ({ label: `${i * 10}s`, short: `${i * 10}` }))
    bands = bands.map((b) => ({ ...b, label: b.range }))
  } else if (id === 'symbols') {
    bands = fromCutoffs([10, 20, 30, 40, 50, 60, 70, 80], (i) => ({ label: SYMBOLS[i], short: SYMBOLS[i] }))
  } else if (id === 'custom') {
    bands = fromCutoffs(customCutoffs, (i) => ({ label: `Band ${i + 1}`, short: `${i + 1}` }))
    bands = bands.map((b) => ({ ...b, label: b.range, short: b.range }))
  } else {
    bands = fromCutoffs(CAPS_CUTOFFS, (i) => ({ label: `Level ${i + 1}`, short: `${i + 1}` }))
  }
  return { id, name: SCHEME_NAMES[id], bands }
}

/**
 * Reads custom cut-offs such as "30, 40, 50": whole numbers from 1 to 99, rising. Returns an error
 * message instead when they cannot be used.
 */
export function parseCutoffs(text: string): number[] | string {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'Type at least one cut-off, for example 30, 50, 70.'
  const values = parts.map(Number)
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 99))
    return 'Cut-offs are whole numbers from 1 to 99, separated by commas.'
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  if (sorted.length > 12) return 'Use at most 12 cut-offs.'
  return sorted
}

/** The band a percentage falls in, using the exact value: 29.6% is still in the 0-29 band. */
export function bandIndex(scheme: BandScheme, percent: number): number {
  let index = 0
  scheme.bands.forEach((b, i) => {
    if (percent >= b.min) index = i
  })
  return index
}

export interface Summary {
  count: number
  absent: number
  unreadable: number
  mean: number
  median: number
  /** Population standard deviation, in percentage points. */
  sd: number
  min: number
  max: number
  range: number
  q1: number
  q3: number
  iqr: number
  /** Marks beyond 1.5 x IQR from the box, lowest first. */
  outliers: number[]
  /** The ends of the whiskers: the lowest and highest marks that are not outliers. */
  whiskerLow: number
  whiskerHigh: number
  passMark: number
  passCount: number
  /** Percentage of learners with marks at or above the pass mark. */
  passRate: number
  bands: { count: number; share: number }[]
}

/** The value at fraction p of the sorted list, interpolating between neighbours (Excel's QUARTILE.INC). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export const OUTLIER_IQR = 1.5

/** Summarises percentages. Null when there are none. */
export function summarise(
  percents: readonly number[],
  scheme: BandScheme,
  passMark: number,
  absent = 0,
  unreadable = 0,
): Summary | null {
  const n = percents.length
  if (n === 0) return null
  const sorted = [...percents].sort((a, b) => a - b)
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - OUTLIER_IQR * iqr
  const highFence = q3 + OUTLIER_IQR * iqr
  // A tiny tolerance, so floating-point error never turns a mark on the fence into an outlier.
  const outliers = sorted.filter((v) => v < lowFence - 1e-9 || v > highFence + 1e-9)
  const inside = sorted.filter((v) => !outliers.includes(v))
  const counts = scheme.bands.map(() => 0)
  for (const v of sorted) counts[bandIndex(scheme, v)]++
  const passCount = sorted.filter((v) => v >= passMark).length
  return {
    count: n,
    absent,
    unreadable,
    mean,
    median: quantile(sorted, 0.5),
    sd,
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    q1,
    q3,
    iqr,
    outliers,
    whiskerLow: inside[0] ?? sorted[0],
    whiskerHigh: inside[inside.length - 1] ?? sorted[n - 1],
    passMark,
    passCount,
    passRate: (passCount / n) * 100,
    bands: counts.map((count) => ({ count, share: (count / n) * 100 })),
  }
}

/** A percentage to one decimal place, for example "54.3%". */
export function pct(value: number): string {
  return `${oneDp(value)}%`
}

/** A number to one decimal place, for example "12.0". */
export function oneDp(value: number): string {
  const r = Math.round(value * 10) / 10
  return (Object.is(r, -0) ? 0 : r).toFixed(1)
}

/** Whether an outlier is low or high. */
export function outlierSide(summary: Summary, value: number): 'low' | 'high' {
  return value < summary.median ? 'low' : 'high'
}
