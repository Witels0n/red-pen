// Reading marks: pasted or imported cells become assessment columns of percentages.
// Pure: no DOM, so every rule here is unit tested.
import { parseCsv, type CsvDelimiter } from '../../shared/classes/csv'
import { normaliseRows } from '../../shared/classes/spreadsheet'

/** Cell text that means the learner was absent (any case). A blank cell is absent too. */
export const ABSENT_WORDS: readonly string[] = ['abs', 'a', 'ab', '-', 'x']

const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`

/** A number written with a decimal point or a decimal comma. */
export function readNumber(s: string): number | null {
  const t = s.trim()
  if (!new RegExp(`^-?${NUM}$`).test(t)) return null
  return Number(t.replace(',', '.'))
}

/** What one cell holds, before its column's "out of" is applied. */
export type RawCell =
  | { kind: 'absent' }
  | { kind: 'number'; value: number }
  | { kind: 'fraction'; score: number; outOf: number }
  | { kind: 'percent'; value: number }
  | { kind: 'text' }

export function readCell(raw: string): RawCell {
  const t = raw.trim()
  if (t === '' || ABSENT_WORDS.includes(t.toLowerCase())) return { kind: 'absent' }
  const n = readNumber(t)
  if (n !== null) return { kind: 'number', value: n }
  const fraction = t.match(new RegExp(`^(-?${NUM})\\s*/\\s*${NUM}$`))
  if (fraction) return { kind: 'fraction', score: readNumber(fraction[1])!, outOf: readNumber(fraction[3])! }
  const percent = t.match(new RegExp(`^(-?${NUM})\\s*%$`))
  if (percent) return { kind: 'percent', value: readNumber(percent[1])! }
  return { kind: 'text' }
}

/** Average, Avg, Total or Term mark in a heading: a column worked out from others. */
const CALCULATED = /\b(average|avg|total|term mark)\b/i

export interface Heading {
  name: string
  outOf: number | null
  calculated: boolean
  /** The heading says the marks are percentages, as in `June exam (%)`. */
  percent: boolean
}

/**
 * Reads `Test 1 (40)`, `Test 1 /40`, `Test 1 - 40` or `Test 1 out of 40` as "Test 1", out of 40, and
 * `June exam (%)` or `June exam %` as percentages.
 */
export function parseHeading(heading: string): Heading {
  const h = heading.trim()
  const calculated = CALCULATED.test(h)
  const percent = h.match(/^(.*?)\s*(?:\(\s*%\s*\)|%)$/)
  if (percent && percent[1].trim()) return { name: percent[1].trim(), outOf: null, calculated, percent: true }
  const m = h.match(
    new RegExp(
      `^(.*?)(?:\\s*\\(\\s*(?:out of\\s*)?${NUM}\\s*\\)|\\s*/\\s*${NUM}|\\s+-\\s*${NUM}|\\s+out of\\s+${NUM})$`,
      'i',
    ),
  )
  const total = m ? readNumber(m[2] ?? m[3] ?? m[4] ?? m[5] ?? '') : null
  const name = m && m[1].trim() && total ? m[1].trim() : h
  return { name, outOf: total && total > 0 ? total : null, calculated, percent: false }
}

/**
 * Splits pasted text into rows. Excel pastes tab-separated cells; a semicolon or comma list works
 * too, but a lone decimal comma (`34,5`) stays one cell.
 */
export function parsePasted(text: string): string[][] {
  if (text.trim() === '') return []
  let delimiter: CsvDelimiter = '\t'
  if (!text.includes('\t')) {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
    if (text.includes(';')) delimiter = ';'
    else if (lines.some((l) => l.includes(',')) && !lines.every((l) => readNumber(l) !== null || !l.includes(',')))
      delimiter = ','
    else return normaliseRows(text.split(/\r\n|\r|\n/).map((l) => [l]))
  }
  return normaliseRows(parseCsv(text, { delimiter }))
}

/** Rows as tab-separated text, the way the paste box shows an imported file. */
export function toPasteText(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

export interface TableLayout {
  headerRow: boolean
  namesColumn: boolean
}

/** A cell that reads as a mark or an absence, not as a word. */
function isMarkLike(cell: string): boolean {
  return readCell(cell).kind !== 'text'
}

/**
 * Guesses whether the first row is headings and the first column is names. The names column is the
 * first column when it is mostly text; the first row is headings when any of its mark cells is text.
 */
export function detectLayout(rows: readonly (readonly string[])[]): TableLayout {
  if (rows.length === 0) return { headerRow: false, namesColumn: false }
  const body = rows.length > 1 ? rows.slice(1) : rows
  const firsts = body.map((r) => r[0] ?? '').filter((c) => c.trim() !== '')
  const namesColumn = (rows[0]?.length ?? 0) > 1 && firsts.filter((c) => !isMarkLike(c)).length > firsts.length / 2
  const headingCells = rows[0].slice(namesColumn ? 1 : 0)
  const headerRow =
    rows.length > 1 &&
    (headingCells.some((c) => c.trim() !== '' && !isMarkLike(c)) ||
      (headingCells.length === 0 && /name|learner/i.test(rows[0][0] ?? '')))
  return { headerRow, namesColumn }
}

export interface MarksTable {
  /** One per learner row: the name, or '' without a names column. */
  names: string[]
  /** The spreadsheet row number of each learner row (counted from 1, headings included). */
  rowNumbers: number[]
  columns: { heading: string; cells: string[] }[]
}

/** Splits rows into names and mark columns. Rows with no name and no marks are skipped. */
export function splitTable(rows: readonly (readonly string[])[], layout: TableLayout): MarksTable {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const first = layout.namesColumn ? 1 : 0
  const headings = layout.headerRow ? rows[0] : []
  const table: MarksTable = { names: [], rowNumbers: [], columns: [] }
  for (let c = first; c < width; c++) {
    table.columns.push({ heading: headings[c]?.trim() || `Assessment ${c - first + 1}`, cells: [] })
  }
  rows.forEach((row, r) => {
    if (layout.headerRow && r === 0) return
    if (row.every((cell) => cell.trim() === '')) return
    table.names.push(layout.namesColumn ? (row[0] ?? '').trim() : '')
    table.rowNumbers.push(r + 1)
    table.columns.forEach((col, i) => col.cells.push(row[first + i] ?? ''))
  })
  return table
}

/** Where a column's "out of" came from. */
export type OutOfSource = 'heading' | 'teacher' | 'assumed' | 'cells' | 'missing'

export type CellStatus = 'mark' | 'absent' | 'unreadable'

export interface ReadCell {
  status: CellStatus
  /** The exact percentage, before any rounding. Null unless the cell is a mark. */
  percent: number | null
  raw: string
  /** Why an unreadable cell could not be used. */
  reason?: string
}

export interface MarkColumn {
  name: string
  heading: string
  calculated: boolean
  /** Raw marks are out of this; null means the marks are percentages. */
  outOf: number | null
  outOfSource: OutOfSource
  /** False while a column with marks above 100 waits for its "out of". */
  analysed: boolean
  cells: ReadCell[]
  counts: { marks: number; absent: number; unreadable: number }
}

export interface ColumnOptions {
  /** The teacher's "out of": a number, null for percentages, or undefined to work it out. */
  outOf?: number | null
  /** The teacher's name for the assessment, if they renamed it. */
  name?: string
}

function cellPercent(cell: RawCell, outOf: number | null): { percent: number } | { reason: string } {
  switch (cell.kind) {
    case 'fraction':
      if (cell.score < 0) return { reason: 'negative' }
      if (cell.outOf <= 0) return { reason: 'not a mark' }
      if (cell.score > cell.outOf) return { reason: `more than ${cell.outOf}` }
      return { percent: (cell.score / cell.outOf) * 100 }
    case 'percent':
      if (cell.value < 0) return { reason: 'negative' }
      if (cell.value > 100) return { reason: 'more than 100%' }
      return { percent: cell.value }
    case 'number': {
      if (cell.value < 0) return { reason: 'negative' }
      const total = outOf ?? 100
      if (cell.value > total) return { reason: outOf === null ? 'more than 100%' : `more than ${total}` }
      return { percent: (cell.value / total) * 100 }
    }
    default:
      return { reason: 'not a mark' }
  }
}

/** Turns one column's cells into percentages, working out its "out of" when the teacher has not. */
export function readColumn(heading: string, cells: readonly string[], options: ColumnOptions = {}): MarkColumn {
  const parsed = parseHeading(heading)
  const raws = cells.map(readCell)
  const plain = raws.filter((c): c is { kind: 'number'; value: number } => c.kind === 'number')
  let outOf: number | null = null
  let source: OutOfSource
  if (options.outOf !== undefined) {
    outOf = options.outOf !== null && options.outOf > 0 ? options.outOf : null
    source = 'teacher'
  } else if (parsed.outOf !== null || parsed.percent) {
    outOf = parsed.outOf
    source = 'heading'
  } else if (plain.some((c) => c.value > 100)) source = 'missing'
  else source = plain.length > 0 ? 'assumed' : 'cells'

  const analysed = source !== 'missing'
  const read: ReadCell[] = raws.map((cell, i) => {
    const raw = cells[i]
    if (cell.kind === 'absent') return { status: 'absent', percent: null, raw }
    // Waiting for an "out of": plain numbers are not judged yet, but words still are.
    if (!analysed && cell.kind === 'number' && cell.value >= 0) return { status: 'mark', percent: null, raw }
    const result = cellPercent(cell, outOf)
    return 'percent' in result
      ? { status: 'mark', percent: result.percent, raw }
      : { status: 'unreadable', percent: null, raw, reason: result.reason }
  })
  const count = (s: CellStatus) => read.filter((c) => c.status === s).length
  return {
    name: options.name?.trim() || parsed.name,
    heading,
    calculated: parsed.calculated,
    outOf,
    outOfSource: source,
    analysed,
    cells: read,
    counts: { marks: count('mark'), absent: count('absent'), unreadable: count('unreadable') },
  }
}

/** The percentages a column contributes to the stats (marks only). */
export function percentsOf(column: MarkColumn): number[] {
  return column.analysed ? column.cells.flatMap((c) => (c.percent === null ? [] : [c.percent])) : []
}

/** How a learner row is named in lists: the name, or its spreadsheet row. */
export function learnerLabel(name: string, rowNumber: number): string {
  return name || `Row ${rowNumber}`
}
