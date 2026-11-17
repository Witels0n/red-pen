// Plain-language insights from the stats. Every threshold lives here, and the wording stays
// tentative: these are prompts for a teacher's judgement, not verdicts.
import { oneDp, pct, type BandScheme, type Summary } from './stats'

export const THRESHOLDS = {
  /** SD below this (percentage points) is a tight spread. */
  tightSd: 10,
  /** SD above this is a wide spread. Between the two is typical. */
  wideSd: 18,
  /** Mean minus median at or beyond this (either way) is a skew. */
  skew: 5,
  /** Fewest marks before "two groups" is looked for. */
  twoGroupsMin: 15,
  /** Each peak holds at least this share of the marks (and at least 3). */
  twoGroupsPeakShare: 0.2,
  /** The lowest bin between the peaks holds at most this fraction of the smaller peak. */
  twoGroupsGap: 0.5,
  /** Over this percentage of learners in the top or bottom band is a ceiling or floor. */
  edgeBandShare: 30,
  /** A mean difference at least this big between consecutive assessments is worth saying. */
  meanChange: 5,
  /** An SD difference at least this big between consecutive assessments is worth saying. */
  sdChange: 5,
  /** Fewer marks than this hides spread, skew and two groups. */
  fewMarks: 5,
} as const

export type InsightKind =
  | 'spread'
  | 'same'
  | 'skew'
  | 'two-groups'
  | 'ceiling'
  | 'floor'
  | 'pass-rate'
  | 'absent'
  | 'few'
  | 'mean-change'
  | 'spread-change'

export interface Insight {
  kind: InsightKind
  /** Lower comes first. */
  priority: number
  text: string
}

function learners(n: number): string {
  return `${n} ${n === 1 ? 'learner' : 'learners'}`
}

/** 10% bins (0-9, ..., 90-100) and their counts. */
export function tenBins(percents: readonly number[]): number[] {
  const bins = Array<number>(10).fill(0)
  for (const v of percents) bins[Math.min(9, Math.floor(v / 10))]++
  return bins
}

/**
 * Two peaks in the 10% bins with a clear gap between them: bins i < j at least two apart, each
 * holding enough marks, with a bin between them at most half the smaller peak. Returns the two
 * peak bins, or null.
 */
export function twoGroups(percents: readonly number[]): [number, number] | null {
  const n = percents.length
  if (n < THRESHOLDS.twoGroupsMin) return null
  const bins = tenBins(percents)
  const need = Math.max(3, THRESHOLDS.twoGroupsPeakShare * n)
  let best: [number, number] | null = null
  let bestSize = 0
  for (let i = 0; i < 10; i++) {
    for (let j = i + 2; j < 10; j++) {
      const smaller = Math.min(bins[i], bins[j])
      if (smaller < need) continue
      const valley = Math.min(...bins.slice(i + 1, j))
      if (valley <= THRESHOLDS.twoGroupsGap * smaller && smaller > bestSize) {
        best = [i, j]
        bestSize = smaller
      }
    }
  }
  return best
}

function binText(i: number): string {
  return i === 9 ? '90-100%' : `${i * 10}-${i * 10 + 9}%`
}

/** Insights about one assessment, most useful first. */
export function singleInsights(summary: Summary, percents: readonly number[], scheme: BandScheme): Insight[] {
  const out: Insight[] = []
  const n = summary.count
  const few = n < THRESHOLDS.fewMarks

  out.push({
    kind: 'pass-rate',
    priority: 1,
    text: `${summary.passCount} of ${learners(n)} (${pct(summary.passRate)}) reached the pass mark of ${summary.passMark}%.`,
  })

  if (n > 1 && summary.sd === 0) {
    out.push({ kind: 'same', priority: 2, text: 'Every learner got the same mark.' })
  } else if (few) {
    out.push({
      kind: 'few',
      priority: 2,
      text: `Too few marks for reliable patterns (${n}). Spread, skew and groups are not shown.`,
    })
  } else {
    const sd = oneDp(summary.sd)
    if (summary.sd < THRESHOLDS.tightSd)
      out.push({
        kind: 'spread',
        priority: 3,
        text: `Marks are fairly close together (SD ${sd}). Most of the class seems to be working at a similar level.`,
      })
    else if (summary.sd > THRESHOLDS.wideSd)
      out.push({
        kind: 'spread',
        priority: 3,
        text: `Marks are spread widely (SD ${sd}). The class may need quite different levels of support.`,
      })
    else out.push({ kind: 'spread', priority: 5, text: `The spread of marks looks typical for a class (SD ${sd}).` })

    const skew = summary.mean - summary.median
    if (skew <= -THRESHOLDS.skew)
      out.push({
        kind: 'skew',
        priority: 4,
        text: `The average (${pct(summary.mean)}) is below the median (${pct(summary.median)}): a few low marks may be pulling it down.`,
      })
    else if (skew >= THRESHOLDS.skew)
      out.push({
        kind: 'skew',
        priority: 4,
        text: `The average (${pct(summary.mean)}) is above the median (${pct(summary.median)}): a few high marks may be pulling it up.`,
      })

    const groups = twoGroups(percents)
    if (groups)
      out.push({
        kind: 'two-groups',
        priority: 2,
        text: `There seem to be two groups, around ${binText(groups[0])} and ${binText(groups[1])}, with few marks in between. It may help to plan for each group.`,
      })
  }

  const top = summary.bands[summary.bands.length - 1]
  const bottom = summary.bands[0]
  const bands = scheme.bands
  if (top.share > THRESHOLDS.edgeBandShare)
    out.push({
      kind: 'ceiling',
      priority: 3,
      text: `${pct(top.share)} scored in the top band (${bands[bands.length - 1].range}%). The test may not have stretched the strongest learners.`,
    })
  if (bottom.share > THRESHOLDS.edgeBandShare)
    out.push({
      kind: 'floor',
      priority: 2,
      text: `${pct(bottom.share)} scored in the bottom band (${bands[0].range}%). The work may have been too hard for many, or a topic may need reteaching.`,
    })

  if (summary.absent > 0)
    out.push({
      kind: 'absent',
      priority: 6,
      text: `${learners(summary.absent)} ${summary.absent === 1 ? 'was' : 'were'} absent and ${summary.absent === 1 ? 'is' : 'are'} left out of these figures.`,
    })

  return out.sort((a, b) => a.priority - b.priority)
}

/** Insights across assessments in the order given (consecutive pairs). */
export function comparisonInsights(items: readonly { name: string; summary: Summary }[]): Insight[] {
  const out: Insight[] = []
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]
    const b = items[i]
    const meanDiff = b.summary.mean - a.summary.mean
    if (Math.abs(meanDiff) >= THRESHOLDS.meanChange)
      out.push({
        kind: 'mean-change',
        priority: 1,
        text: `The average ${meanDiff > 0 ? 'rose' : 'fell'} from ${pct(a.summary.mean)} in ${a.name} to ${pct(b.summary.mean)} in ${b.name}.`,
      })
    const sdDiff = b.summary.sd - a.summary.sd
    if (Math.abs(sdDiff) >= THRESHOLDS.sdChange)
      out.push({
        kind: 'spread-change',
        priority: 2,
        text:
          sdDiff > 0
            ? `Marks were more spread out in ${b.name} (SD ${oneDp(b.summary.sd)}) than in ${a.name} (SD ${oneDp(a.summary.sd)}). Some learners may have found it much harder than others.`
            : `Marks were closer together in ${b.name} (SD ${oneDp(b.summary.sd)}) than in ${a.name} (SD ${oneDp(a.summary.sd)}).`,
      })
  }
  return out.sort((a, b) => a.priority - b.priority)
}

/** At most six insights for the screen. */
export const MAX_INSIGHTS = 6
