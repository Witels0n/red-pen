// One analysis: the table read into assessment columns, summarised with the chosen bands and pass
// mark. Pure, so the screen, the report and the CSV exports all work from the same figures.
import { writeCsv } from '../../shared/classes/csv'
import type { Learners } from './compare'
import {
  learnerLabel,
  percentsOf,
  readColumn,
  splitTable,
  type ColumnOptions,
  type MarkColumn,
  type TableLayout,
} from './parse'
import { comparisonInsights, singleInsights, THRESHOLDS, type Insight } from './insights'
import { bandScheme, oneDp, pct, summarise, type BandScheme, type Summary } from './stats'
import type { MarksSettings } from './settings'

export interface ColumnChoice extends ColumnOptions {
  included?: boolean
}

export interface AnalysedColumn {
  /** Index among all columns (cards). */
  index: number
  column: MarkColumn
  included: boolean
  percents: number[]
  /** Null when the column has no marks to analyse (or is waiting for its "out of"). */
  summary: Summary | null
}

export interface Analysis extends Learners {
  scheme: BandScheme
  passMark: number
  columns: AnalysedColumn[]
}

export function analyse(
  rows: readonly (readonly string[])[],
  layout: TableLayout,
  choices: readonly (ColumnChoice | undefined)[],
  settings: MarksSettings,
): Analysis {
  const table = splitTable(rows, layout)
  const scheme = bandScheme(settings.scheme, settings.customCutoffs)
  const columns = table.columns.map((c, index): AnalysedColumn => {
    const choice = choices[index] ?? {}
    const column = readColumn(c.heading, c.cells, choice)
    const percents = percentsOf(column)
    return {
      index,
      column,
      included: choice.included ?? true,
      percents,
      summary: summarise(percents, scheme, settings.passMark, column.counts.absent, column.counts.unreadable),
    }
  })
  return { names: table.names, rowNumbers: table.rowNumbers, scheme, passMark: settings.passMark, columns }
}

/** The included columns that have something to show, in table order. */
export function shown(analysis: Analysis): (AnalysedColumn & { summary: Summary })[] {
  return analysis.columns.filter((c): c is AnalysedColumn & { summary: Summary } => c.included && c.summary !== null)
}

export function hasNames(analysis: Analysis): boolean {
  return analysis.names.some((n) => n !== '')
}

/** The summary of every shown assessment, one row each, as CSV. */
export function summaryCsv(analysis: Analysis): string {
  const bands = analysis.scheme.bands
  const header = [
    'Assessment',
    'Out of',
    'Marks',
    'Absent',
    'Unreadable',
    'Mean %',
    'Median %',
    'SD',
    'Lowest %',
    'Highest %',
    'Range',
    'Q1 %',
    'Q3 %',
    'Outliers',
    `Pass rate % (pass mark ${analysis.passMark}%)`,
    ...bands.flatMap((b) => [`${b.label} (${b.range}) count`, `${b.label} %`]),
  ]
  const rows = shown(analysis).map(({ column: c, summary: s }) => [
    c.name,
    c.outOf === null ? '%' : String(c.outOf),
    String(s.count),
    String(s.absent),
    String(s.unreadable),
    oneDp(s.mean),
    oneDp(s.median),
    oneDp(s.sd),
    oneDp(s.min),
    oneDp(s.max),
    oneDp(s.range),
    oneDp(s.q1),
    oneDp(s.q3),
    String(s.outliers.length),
    oneDp(s.passRate),
    ...s.bands.flatMap((b) => [String(b.count), oneDp(b.share)]),
  ])
  return writeCsv([header, ...rows])
}

/** The insights for one assessment, or for the overview of several. */
export function insightsFor(analysis: Analysis): Insight[] {
  const cols = shown(analysis)
  if (cols.length === 0) return []
  if (cols.length === 1) return singleInsights(cols[0].summary, cols[0].percents, analysis.scheme)
  const out = comparisonInsights(cols.map((c) => ({ name: c.column.name, summary: c.summary })))
  out.push({
    kind: 'pass-rate',
    priority: 3,
    text: `Pass rates (pass mark ${analysis.passMark}%): ${cols.map((c) => `${c.column.name} ${pct(c.summary.passRate)}`).join(', ')}.`,
  })
  const absent = cols.filter((c) => c.summary.absent > 0)
  if (absent.length)
    out.push({
      kind: 'absent',
      priority: 6,
      text: `Absent learners are left out: ${absent.map((c) => `${c.summary.absent} in ${c.column.name}`).join(', ')}.`,
    })
  if (!out.some((i) => i.kind === 'mean-change' || i.kind === 'spread-change'))
    out.push({
      kind: 'mean-change',
      priority: 4,
      text: `No big changes in the average or spread from one assessment to the next (under ${THRESHOLDS.meanChange} points).`,
    })
  return out.sort((a, b) => a.priority - b.priority)
}

/** Each learner's percentage per shown assessment (ABS for absent, blank when unreadable), as CSV. */
export function learnersCsv(analysis: Analysis): string {
  const cols = shown(analysis)
  const header = ['Row', 'Learner', ...cols.map((c) => `${c.column.name} %`)]
  const rows = analysis.names.map((name, r) => [
    String(analysis.rowNumbers[r]),
    learnerLabel(name, analysis.rowNumbers[r]),
    ...cols.map(({ column }) => {
      const cell = column.cells[r]
      if (cell.status === 'absent') return 'ABS'
      return cell.percent === null ? '' : oneDp(cell.percent)
    }),
  ])
  return writeCsv([header, ...rows])
}
