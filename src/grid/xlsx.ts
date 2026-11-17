// The grid as an Excel file: the questions, the summary per level and topic, and the matrix.
// The writer is loaded on first use, so the page stays light.
import type { SheetData } from 'write-excel-file/browser'
import { DIFFICULTY_NAMES, gridTitle, type Grid } from './core/model'
import { analyseNumbering, numberKey } from './core/numbering'
import { flagText, summarise, type Share } from './core/summary'
import { TAXONOMY_NAMES } from './core/taxonomy'

type Cell = string | number | null

interface Sheet {
  name: string
  rows: Cell[][]
  widths: number[]
  /** Rows (0-based) drawn in bold. */
  bold: Set<number>
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

function shareRows(shares: Share[], heading: string): Cell[][] {
  return [
    [heading, 'Marks', '%', 'Target %', 'Check'],
    ...shares.map((s) => [s.name, s.marks, round(s.percent), s.target, flagText(s) || null]),
  ]
}

/** The sheets of the workbook, as plain rows (tested without the writer). */
export function gridSheets(g: Grid): Sheet[] {
  const s = summarise(g)
  const levelName = (id: string) => {
    const i = g.taxonomy.levels.findIndex((l) => l.id === id)
    return i < 0 ? '' : `${i + 1}: ${g.taxonomy.levels[i].name}`
  }
  const headings = new Set(
    analyseNumbering(g.rows)
      .sections.filter((x) => x.headingRowId)
      .map((x) => x.headingRowId),
  )
  const sectionMarks = new Map(s.numbering.sections.map((x) => [x.key, x.marks]))

  const d = g.details
  const questions: Cell[][] = [
    ['Question paper grid', gridTitle(g)],
    ['Subject', d.subject],
    ['Grade', d.grade],
    ['Paper', d.paper],
    ['Date', d.date],
    ['Examiner', d.examiner],
    ['Moderator', d.moderator],
    ['Paper total', g.intendedTotal],
    ['Questions add up to', s.total],
    [],
    ['Number', 'Marks', 'Cognitive level', 'Topic', 'Content area', 'Difficulty', 'Notes', 'Subtotal'],
    ...g.rows.map((r) => [
      r.number,
      headings.has(r.id) ? null : r.marks,
      levelName(r.level),
      r.topic,
      r.area,
      r.difficulty ? DIFFICULTY_NAMES[r.difficulty] : '',
      r.notes,
      headings.has(r.id) ? (sectionMarks.get(numberKey(r.number)) ?? null) : null,
    ]),
  ]

  const summaryRows: Cell[][] = [
    ['Taxonomy', TAXONOMY_NAMES[g.taxonomy.id]],
    ['Tolerance (percentage points)', g.tolerance],
    [],
    ...shareRows(
      s.levels.map((l, i) => (l.key ? { ...l, name: `${i + 1}: ${l.name}` } : l)),
      'Cognitive level',
    ),
    [],
    ...shareRows(s.topics, 'Topic'),
  ]
  const levelHead = 3
  const topicHead = levelHead + s.levels.length + 2

  const m = s.matrix
  const matrix: Cell[][] = [
    ['Level', ...m.topics.map((t) => t || 'No topic'), 'Total'],
    ...m.levels.map((l, i) => [levelName(l) || 'No level', ...m.cells[i], m.levelTotals[i]]),
    ['Total', ...m.topicTotals, s.total],
  ]

  return [
    { name: 'Questions', rows: questions, widths: [12, 8, 26, 22, 22, 12, 30, 10], bold: new Set([0, 10]) },
    { name: 'Summary', rows: summaryRows, widths: [30, 10, 8, 10, 18], bold: new Set([levelHead, topicHead]) },
    {
      name: 'Matrix',
      rows: matrix,
      widths: [28, ...m.topics.map(() => 14), 10],
      bold: new Set([0, matrix.length - 1]),
    },
  ]
}

export async function gridXlsx(g: Grid): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const blob = await writeXlsxFile(
    gridSheets(g).map((sheet) => ({
      data: sheet.rows.map((row, r) =>
        row.map((value) =>
          value === null || value === ''
            ? null
            : sheet.bold.has(r)
              ? { value, fontWeight: 'bold' as const }
              : { value },
        ),
      ) as SheetData,
      sheet: sheet.name,
      columns: sheet.widths.map((width) => ({ width })),
    })),
  ).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
