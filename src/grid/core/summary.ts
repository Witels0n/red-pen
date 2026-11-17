// The live analysis of a grid: totals, the share of marks per level and per topic against their
// targets, the level by topic matrix and the over or under flags.
import type { Grid } from './model'
import { analyseNumbering, type Numbering } from './numbering'
import { targetSum } from './taxonomy'

export type Flag = 'ok' | 'over' | 'under' | 'none'

export interface Share {
  /** Level id, or topic name. '' is the "not set" bucket. */
  key: string
  name: string
  marks: number
  /** Percentage of the paper's total marks (0 when the paper has no marks yet). */
  percent: number
  target: number | null
  flag: Flag
}

export interface Matrix {
  /** Level ids, then '' when some marks have no level. */
  levels: string[]
  /** Topic names, then '' when some marks have no topic. */
  topics: string[]
  /** cells[level][topic] in marks. */
  cells: number[][]
  levelTotals: number[]
  topicTotals: number[]
}

export interface Summary {
  total: number
  intended: number | null
  /** total minus intended, or null when no intended total is set. */
  difference: number | null
  levels: Share[]
  topics: Share[]
  matrix: Matrix
  numbering: Numbering
  /** Counted questions with no marks typed yet. */
  missingMarks: number
  levelTargetSum: number
  topicTargetSum: number
  warnings: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Compares a share with its target: within `tolerance` percentage points either way is fine.
 * No target, or a paper with no marks yet, gives no flag.
 */
export function flagFor(percent: number, target: number | null, tolerance: number, total: number): Flag {
  if (target === null || !Number.isFinite(target) || total <= 0) return 'none'
  const diff = round2(percent - target)
  if (diff > tolerance) return 'over'
  if (diff < -tolerance) return 'under'
  return 'ok'
}

export function percentOf(marks: number, total: number): number {
  return total > 0 ? (marks / total) * 100 : 0
}

/** Every topic name the grid knows of: the topic list first, then any typed only on a question. */
export function topicNames(g: Pick<Grid, 'topics' | 'rows'>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (n: string) => {
    const name = n.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    names.push(name)
  }
  g.topics.forEach((t) => add(t.name))
  g.rows.forEach((r) => add(r.topic))
  return names
}

export function summarise(g: Grid): Summary {
  const numbering = analyseNumbering(g.rows)
  const counted = numbering.counted
  const total = round2(counted.reduce((sum, r) => sum + (r.marks ?? 0), 0))
  const levelIds = new Set(g.taxonomy.levels.map((l) => l.id))
  const topics = topicNames(g)
  const topicIndex = new Map(topics.map((t, i) => [t.toLowerCase(), i]))

  const levelKeys = [...g.taxonomy.levels.map((l) => l.id), '']
  const topicKeys = [...topics, '']
  const cells = levelKeys.map(() => topicKeys.map(() => 0))
  for (const r of counted) {
    const li = levelIds.has(r.level) ? levelKeys.indexOf(r.level) : levelKeys.length - 1
    const ti = topicIndex.get(r.topic.trim().toLowerCase()) ?? topicKeys.length - 1
    cells[li][ti] += r.marks ?? 0
  }
  const levelTotals = cells.map((row) => round2(row.reduce((a, b) => a + b, 0)))
  const topicTotals = topicKeys.map((_, t) => round2(cells.reduce((a, row) => a + row[t], 0)))

  const share = (key: string, name: string, marks: number, target: number | null): Share => {
    const percent = percentOf(marks, total)
    return { key, name, marks, percent, target, flag: flagFor(percent, target, g.tolerance, total) }
  }

  const levels = g.taxonomy.levels.map((l, i) => share(l.id, l.name, levelTotals[i], l.target))
  const noLevel = levelTotals[levelTotals.length - 1]
  if (noLevel > 0) levels.push(share('', 'No level', noLevel, null))

  const targets = new Map(g.topics.map((t) => [t.name.trim().toLowerCase(), t.target]))
  const topicShares = topics.map((t, i) => share(t, t, topicTotals[i], targets.get(t.toLowerCase()) ?? null))
  const noTopic = topicTotals[topicTotals.length - 1]
  if (noTopic > 0 || (topics.length === 0 && total > 0)) topicShares.push(share('', 'No topic', noTopic, null))

  // Leave out the "not set" row and column of the matrix when nothing is in them.
  const keepLevels = levelKeys.map((k, i) => k !== '' || levelTotals[i] > 0)
  const keepTopics = topicKeys.map((k, i) => k !== '' || topicTotals[i] > 0)
  const matrix: Matrix = {
    levels: levelKeys.filter((_, i) => keepLevels[i]),
    topics: topicKeys.filter((_, i) => keepTopics[i]),
    cells: cells.filter((_, i) => keepLevels[i]).map((row) => row.map(round2).filter((_, t) => keepTopics[t])),
    levelTotals: levelTotals.filter((_, i) => keepLevels[i]),
    topicTotals: topicTotals.filter((_, i) => keepTopics[i]),
  }

  const missingMarks = counted.filter((r) => r.marks === null && (r.number.trim() || r.topic || r.level)).length
  const intended = g.intendedTotal
  const difference = intended === null ? null : round2(total - intended)
  const levelTargetSum = targetSum(g.taxonomy.levels)
  const topicTargetSum = round2(g.topics.reduce((sum, t) => sum + (t.target ?? 0), 0))

  const warnings: string[] = []
  if (difference !== null && difference !== 0) {
    warnings.push(
      difference > 0
        ? `The questions add up to ${total}, which is ${difference} more than the paper total of ${intended}.`
        : `The questions add up to ${total}, which is ${-difference} short of the paper total of ${intended}.`,
    )
  }
  if (missingMarks > 0) warnings.push(`${missingMarks} question${missingMarks === 1 ? ' has' : 's have'} no marks yet.`)
  if (noLevel > 0) warnings.push(`${noLevel} mark${noLevel === 1 ? ' has' : 's have'} no cognitive level.`)
  if (levelTargetSum !== 100) warnings.push(`The level targets add up to ${levelTargetSum}%, not 100%.`)
  if (g.topics.some((t) => t.target !== null) && topicTargetSum !== 100) {
    warnings.push(`The topic targets add up to ${topicTargetSum}%, not 100%.`)
  }
  for (const d of numbering.duplicates) warnings.push(`Question ${d} appears more than once.`)
  for (const m of numbering.mismatches) {
    warnings.push(`Question ${m.label} has ${m.typed} marks typed, but its sub-questions add up to ${m.subtotal}.`)
  }

  return {
    total,
    intended,
    difference,
    levels,
    topics: topicShares,
    matrix,
    numbering,
    missingMarks,
    levelTargetSum,
    topicTargetSum,
    warnings,
  }
}

/** "4 over", "2.5 under" (percentage points), or "on target". */
export function flagText(s: Pick<Share, 'flag' | 'percent' | 'target'>): string {
  if (s.flag === 'none' || s.target === null) return ''
  const diff = Math.round(Math.abs(s.percent - s.target) * 10) / 10
  const pts = `${diff} pt${diff === 1 ? '' : 's'}`
  if (s.flag === 'over') return `Over by ${pts}`
  if (s.flag === 'under') return `Under by ${pts}`
  return 'On target'
}
