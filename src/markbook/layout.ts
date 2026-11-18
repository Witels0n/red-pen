// Where every column and row of the markbook goes, and the Excel formula in each calculated cell.
// Pure, so the page preview, the unit tests and the .xlsx always agree.
//
// Rows: 1 headings, 2 "Out of", 3 "Weight (%)", learners from row 4, then (after a gap) the class summary.
// A blank cell or any text (such as "a" for absent) is not a mark: ISNUMBER skips it and the weights
// of the marks that are there share its place. Type 0 for a learner who scored nothing.
// When nothing counts and at least one part is an absence, the average is itself "a", so an absent
// Category is left out of the weighted mark in the same way, and so on up to a year mark.

import { categoryGroups, orderedAssessments, type MarkbookDesign } from './design'

export const HEADER_ROW = 1
export const OUT_OF_ROW = 2
export const WEIGHT_ROW = 3
export const FIRST_LEARNER_ROW = 4

/** CAPS achievement levels: the lowest percentage of each level 1 to 7. */
export const LEVEL_FLOORS = [0, 30, 40, 50, 60, 70, 80] as const

export type ColumnKind = 'id' | 'name' | 'mark' | 'percent' | 'category' | 'term' | 'final' | 'level' | 'result'

export interface Column {
  kind: ColumnKind
  /** Excel column letter, for example "D". */
  letter: string
  header: string
  /** Row 2: the maximum mark of a mark column. */
  outOf?: number
  /** Row 3: an assessment's or a Category's weight. */
  weight?: number
  assessmentId?: string
  categoryId?: string
  /** Width in characters. */
  width: number
}

export type SummaryKind = 'average' | 'highest' | 'lowest' | 'count' | 'passRate'

export const SUMMARY_LABELS: Record<SummaryKind, string> = {
  average: 'Class average',
  highest: 'Highest',
  lowest: 'Lowest',
  count: 'Number of marks',
  passRate: 'Pass rate (%)',
}

export interface SummaryRow {
  kind: SummaryKind
  row: number
}

export interface Layout {
  columns: Column[]
  learnerRows: number
  firstRow: number
  lastRow: number
  summary: SummaryRow[]
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function headerWidth(header: string, min: number): number {
  return Math.min(28, Math.max(min, header.length + 2))
}

export function buildLayout(design: MarkbookDesign, learnerRows: number, idHeader = 'Learner ID'): Layout {
  const columns: Omit<Column, 'letter'>[] = [
    { kind: 'id', header: idHeader, width: 11 },
    { kind: 'name', header: 'Learner', width: 28 },
  ]
  const markColumns = (ids: string[]) => {
    for (const a of orderedAssessments(design).filter((x) => ids.includes(x.id))) {
      columns.push({
        kind: 'mark',
        header: a.name.trim(),
        outOf: a.outOf,
        weight: a.weight,
        assessmentId: a.id,
        width: headerWidth(a.name.trim(), 9),
      })
      if (design.showPercentages) {
        const header = `${a.name.trim()} (%)`
        columns.push({ kind: 'percent', header, assessmentId: a.id, width: headerWidth(header, 9) })
      }
    }
  }
  if (design.useCategories) {
    for (const { category, assessments } of categoryGroups(design)) {
      markColumns(assessments.map((a) => a.id))
      // "Exam (%)" may already be the percentage of an assessment called Exam.
      const name = category.name.trim()
      const clash = design.assessments.some((a) => a.name.trim().toLowerCase() === name.toLowerCase())
      const header = clash ? `${name} average (%)` : `${name} (%)`
      columns.push({
        kind: 'category',
        header,
        weight: category.weight,
        categoryId: category.id,
        width: headerWidth(header, 10),
      })
    }
  } else {
    markColumns(design.assessments.map((a) => a.id))
  }
  const termHeader = `${design.markLabel.trim() || 'Term mark'} (%)`
  columns.push({ kind: 'term', header: termHeader, width: headerWidth(termHeader, 12) })
  if (design.rounding !== 'none') columns.push({ kind: 'final', header: 'Rounded (%)', width: 12 })
  if (design.showLevel) columns.push({ kind: 'level', header: 'Level', width: 8 })
  if (design.showResult) columns.push({ kind: 'result', header: 'Result', width: 9 })

  const rows = Math.max(1, Math.floor(learnerRows))
  const firstRow = FIRST_LEARNER_ROW
  const lastRow = firstRow + rows - 1
  const kinds: SummaryKind[] = ['average', 'highest', 'lowest', 'count', 'passRate']
  const summary = design.showSummary ? kinds.map((kind, i) => ({ kind, row: lastRow + 2 + i })) : []
  return {
    columns: columns.map((c, i) => ({ ...c, letter: columnLetter(i) })),
    learnerRows: rows,
    firstRow,
    lastRow,
    summary,
  }
}

function find(layout: Layout, kind: ColumnKind): Column | undefined {
  return layout.columns.find((c) => c.kind === kind)
}

/** What an average shows when every part of it is an absence. Typed by teachers too. */
export const ABSENT = 'a'

/**
 * The weighted average of `parts` in one row, skipping any part that is not a number. With no
 * numbers at all it is "a" when a part is an absence (any text), and empty when all are blank.
 */
function weightedAverage(parts: { value: string; weight: string; test: string }[], times100: boolean): string {
  const num = parts.map((p) => `IF(ISNUMBER(${p.test}),${p.value}*${p.weight},0)`).join('+')
  const den = parts.map((p) => `IF(ISNUMBER(${p.test}),${p.weight},0)`).join('+')
  // A formula's "" is text as well, so an absence is text that is not empty.
  const absences = parts.map((p) => `ISTEXT(${p.test})*(${p.test}<>"")`).join('+')
  return `=IFERROR((${num})/(${den})${times100 ? '*100' : ''},IF(${absences}>0,"${ABSENT}",""))`
}

/** The formula for a learner's cell, or null for a cell the teacher types into. */
export function learnerFormula(design: MarkbookDesign, layout: Layout, column: Column, row: number): string | null {
  const ref = (c: Column) => `${c.letter}${row}`
  switch (column.kind) {
    case 'id':
    case 'name':
    case 'mark':
      return null
    case 'percent': {
      const mark = layout.columns.find((c) => c.kind === 'mark' && c.assessmentId === column.assessmentId)!
      return `=IF(ISNUMBER(${ref(mark)}),${ref(mark)}/${mark.letter}$${OUT_OF_ROW}*100,"")`
    }
    case 'category': {
      const ids = new Set(design.assessments.filter((a) => a.categoryId === column.categoryId).map((a) => a.id))
      const marks = layout.columns.filter((c) => c.kind === 'mark' && ids.has(c.assessmentId!))
      if (marks.length === 0) return '=""'
      return weightedAverage(
        marks.map((m) => ({
          test: ref(m),
          value: `${ref(m)}/${m.letter}$${OUT_OF_ROW}`,
          weight: `${m.letter}$${WEIGHT_ROW}`,
        })),
        true,
      )
    }
    case 'term': {
      if (design.useCategories) {
        const cats = layout.columns.filter((c) => c.kind === 'category')
        if (cats.length === 0) return '=""'
        return weightedAverage(
          cats.map((c) => ({ test: ref(c), value: ref(c), weight: `${c.letter}$${WEIGHT_ROW}` })),
          false,
        )
      }
      const marks = layout.columns.filter((c) => c.kind === 'mark')
      if (marks.length === 0) return '=""'
      return weightedAverage(
        marks.map((m) => ({
          test: ref(m),
          value: `${ref(m)}/${m.letter}$${OUT_OF_ROW}`,
          weight: `${m.letter}$${WEIGHT_ROW}`,
        })),
        true,
      )
    }
    case 'final': {
      const term = ref(find(layout, 'term')!)
      const digits = design.rounding === 'one' ? 1 : 0
      return `=IF(ISNUMBER(${term}),ROUND(${term},${digits}),${term})`
    }
    case 'level': {
      // Banded on the unrounded mark, so 79.6 is still level 6.
      const term = ref(find(layout, 'term')!)
      return `=IFERROR(LOOKUP(${term},{${LEVEL_FLOORS.join(',')}},{1,2,3,4,5,6,7}),"")`
    }
    case 'result': {
      const term = ref(find(layout, 'term')!)
      return `=IF(ISNUMBER(${term}),IF(${term}>=${design.passMark},"Pass","Fail"),"")`
    }
  }
}

/** The formula in a class summary cell, or null when that summary means nothing for the column. */
export function summaryFormula(
  design: MarkbookDesign,
  layout: Layout,
  column: Column,
  kind: SummaryKind,
): string | null {
  if (column.kind === 'id' || column.kind === 'name') return null
  const range = `${column.letter}${layout.firstRow}:${column.letter}${layout.lastRow}`
  if (column.kind === 'result') {
    const pass = `COUNTIF(${range},"Pass")`
    const fail = `COUNTIF(${range},"Fail")`
    if (kind === 'count') return `=${pass}+${fail}`
    if (kind === 'passRate') return `=IFERROR(${pass}/(${pass}+${fail})*100,"")`
    return null
  }
  if (column.kind === 'level' && kind !== 'count') return null
  switch (kind) {
    case 'average':
      return `=IFERROR(AVERAGE(${range}),"")`
    case 'highest':
      return `=IF(COUNT(${range})=0,"",MAX(${range}))`
    case 'lowest':
      return `=IF(COUNT(${range})=0,"",MIN(${range}))`
    case 'count':
      return `=COUNT(${range})`
    case 'passRate': {
      const threshold =
        column.kind === 'mark' ? `">="&${column.letter}$${OUT_OF_ROW}*${design.passMark}/100` : `">=${design.passMark}"`
      return `=IFERROR(COUNTIF(${range},${threshold})/COUNT(${range})*100,"")`
    }
  }
}

/** The number format of a column's learner and summary cells in Excel. */
export function numberFormat(design: MarkbookDesign, column: Column, summary?: SummaryKind): string | undefined {
  if (summary === 'count') return '0'
  switch (column.kind) {
    case 'percent':
    case 'category':
    case 'term':
      return '0.0'
    case 'final':
      return summary ? '0.0' : design.rounding === 'one' ? '0.0' : '0'
    case 'mark':
    case 'level':
    case 'result':
      return summary && summary !== 'highest' && summary !== 'lowest' ? '0.0' : undefined
    default:
      return undefined
  }
}
