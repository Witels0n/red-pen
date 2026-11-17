// Learner lists: needs support, top five, outliers, and who improved or dropped most between two
// assessments. Learners are matched across assessments by row; names are labels only.
import { learnerLabel, type MarkColumn } from './parse'
import { outlierSide, type Summary } from './stats'

export interface LearnerRef {
  /** Index of the learner row in the table. */
  row: number
  label: string
}

export interface RankedLearner extends LearnerRef {
  value: number
  /** Another learner in the list has the same value, to one decimal place. */
  joint: boolean
}

export interface Learners {
  names: readonly string[]
  rowNumbers: readonly number[]
}

function ref(learners: Learners, row: number): LearnerRef {
  return { row, label: learnerLabel(learners.names[row], learners.rowNumbers[row]) }
}

const key = (v: number) => Math.round(v * 10)

/** Sorts by value (ties keep row order) and marks ties against every value in `all`. */
function rank(entries: { row: number; value: number }[], dir: 1 | -1, learners: Learners): RankedLearner[] {
  const counts = new Map<number, number>()
  for (const e of entries) counts.set(key(e.value), (counts.get(key(e.value)) ?? 0) + 1)
  return entries
    .slice()
    .sort((a, b) => (a.value - b.value) * dir || a.row - b.row)
    .map((e) => ({ ...ref(learners, e.row), value: e.value, joint: (counts.get(key(e.value)) ?? 0) > 1 }))
}

function marks(column: MarkColumn): { row: number; value: number }[] {
  return column.cells.flatMap((c, row) => (c.percent === null ? [] : [{ row, value: c.percent }]))
}

/** Every learner below the pass mark, lowest first. */
export function needsSupport(column: MarkColumn, passMark: number, learners: Learners): RankedLearner[] {
  const all = marks(column)
  return rank(all, 1, learners).filter((l) => l.value < passMark)
}

/** The top `count` learners, highest first. Ties are broken by row order and marked joint. */
export function topLearners(column: MarkColumn, learners: Learners, count = 5): RankedLearner[] {
  return rank(marks(column), -1, learners).slice(0, count)
}

export interface OutlierLearner extends LearnerRef {
  value: number
  side: 'low' | 'high'
}

/** Learners whose mark is an outlier, lowest first. */
export function outlierLearners(column: MarkColumn, summary: Summary, learners: Learners): OutlierLearner[] {
  const outliers = new Set(summary.outliers)
  return rank(marks(column), 1, learners)
    .filter((l) => outliers.has(l.value))
    .map((l) => ({ row: l.row, label: l.label, value: l.value, side: outlierSide(summary, l.value) }))
}

export interface Change extends LearnerRef {
  from: number
  to: number
  /** Percentage points, to minus from. */
  change: number
  joint: boolean
}

export interface Changes {
  improved: Change[]
  dropped: Change[]
  /** Learners with both marks. */
  matched: number
  /** Learners with a mark in only one of the two, left out. */
  leftOut: number
}

/** Who improved and dropped most from `a` to `b`, only among learners with both marks. */
export function changes(a: MarkColumn, b: MarkColumn, learners: Learners, count = 5): Changes {
  const both: Change[] = []
  let leftOut = 0
  a.cells.forEach((ca, row) => {
    const cb = b.cells[row]
    const x = ca.percent
    const y = cb?.percent ?? null
    if (x !== null && y !== null) both.push({ ...ref(learners, row), from: x, to: y, change: y - x, joint: false })
    else if (x !== null || y !== null) leftOut++
  })
  const counts = new Map<number, number>()
  for (const c of both) counts.set(key(c.change), (counts.get(key(c.change)) ?? 0) + 1)
  const withJoint = both.map((c) => ({ ...c, joint: (counts.get(key(c.change)) ?? 0) > 1 }))
  const improved = withJoint
    .filter((c) => c.change > 0)
    .sort((p, q) => q.change - p.change || p.row - q.row)
    .slice(0, count)
  const dropped = withJoint
    .filter((c) => c.change < 0)
    .sort((p, q) => p.change - q.change || p.row - q.row)
    .slice(0, count)
  return { improved, dropped, matched: both.length, leftOut }
}

/**
 * The pair to compare by default: the last two assessments that are not calculated columns
 * (calculated columns are left out of improved and dropped). Indexes into `columns`; null when
 * there are not two such.
 */
export function defaultPair(columns: readonly Pick<MarkColumn, 'calculated'>[]): [number, number] | null {
  const plain = columns.flatMap((c, i) => (c.calculated ? [] : [i]))
  return plain.length >= 2 ? [plain[plain.length - 2], plain[plain.length - 1]] : null
}
