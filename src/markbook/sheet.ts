// The markbook as Excel sheets: real formulas, a frozen header, bold headings and column widths.
// buildMarkbook is pure (and unit tested); writeMarkbook loads the Excel writer on first use.

import type { CellObject, SheetData } from 'write-excel-file/browser'
import { formatNumber, type MarkbookDesign } from './design'
import {
  buildLayout,
  columnLetter,
  learnerFormula,
  numberFormat,
  OUT_OF_ROW,
  summaryFormula,
  SUMMARY_LABELS,
  WEIGHT_ROW,
  type Column,
  type Layout,
} from './layout'

export interface SheetLearner {
  id: string
  name: string
}

export interface MarkbookSheet {
  name: string
  data: SheetData
  widths: number[]
  stickyRows: number
  stickyColumns: number
  /** Rows and columns from 1, as Excel counts them. */
  failCells?: { from: { row: number; column: number }; to: { row: number; column: number } }
}

const CATEGORY_TINTS = ['#FDECEE', '#E8F0FB', '#EAF6EC', '#FFF4DC', '#F1EAFB', '#E6F6F6']
const CALC_TINT = '#F2F3F5'

/** Formulas are stored without the leading "=", as Excel itself writes them. */
function formula(f: string, format?: string): CellObject {
  return { type: 'Formula', value: f.replace(/^=/, ''), ...(format ? { format } : {}) }
}

function tintFor(design: MarkbookDesign, column: Column): string | undefined {
  if (column.kind === 'id' || column.kind === 'name') return undefined
  if (!design.useCategories) return column.kind === 'mark' ? undefined : CALC_TINT
  const categoryId =
    column.categoryId ?? design.assessments.find((a) => a.id === column.assessmentId)?.categoryId ?? undefined
  const index = design.categories.findIndex((c) => c.id === categoryId)
  return index >= 0 ? CATEGORY_TINTS[index % CATEGORY_TINTS.length] : CALC_TINT
}

/** A safe Excel sheet name: at most 31 characters, none of : \ / ? * [ ] */
export function sheetName(title: string): string {
  const clean = title
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim()
  return clean || 'Markbook'
}

/** A file name for the download, for example "Grade 12 markbook.xlsx". */
export function markbookFileName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${clean || 'Markbook'}.xlsx`
}

/**
 * The markbook sheet and a notes sheet. With no learners, `blankRows` empty rows are left
 * for names; learner rows always number at least one.
 */
export function buildMarkbook(
  design: MarkbookDesign,
  learners: SheetLearner[],
  options: { blankRows?: number; idHeader?: string } = {},
): { layout: Layout; sheets: MarkbookSheet[] } {
  const rows = learners.length > 0 ? learners.length : Math.max(1, options.blankRows ?? 40)
  const layout = buildLayout(design, rows, options.idHeader)
  const cols = layout.columns
  const data: SheetData = []

  data.push(
    cols.map((c) => {
      const tint = tintFor(design, c)
      return {
        value: c.header,
        fontWeight: 'bold',
        wrap: true,
        alignVertical: 'bottom',
        bottomBorderStyle: 'thin',
        ...(tint ? { backgroundColor: tint } : {}),
      } satisfies CellObject
    }),
  )
  data.push(
    cols.map((c) =>
      c.kind === 'name'
        ? { value: 'Out of', fontWeight: 'bold', align: 'right' }
        : c.outOf !== undefined
          ? { value: c.outOf, fontWeight: 'bold' }
          : null,
    ),
  )
  data.push(
    cols.map((c) =>
      c.kind === 'name'
        ? { value: 'Weight (%)', fontWeight: 'bold', align: 'right', bottomBorderStyle: 'thin' }
        : c.weight !== undefined
          ? { value: c.weight, fontStyle: 'italic', bottomBorderStyle: 'thin' }
          : { value: null, bottomBorderStyle: 'thin' },
    ) as SheetData[number],
  )

  for (let i = 0; i < layout.learnerRows; i++) {
    const row = layout.firstRow + i
    const learner = learners[i]
    data.push(
      cols.map((c) => {
        if (c.kind === 'id') return learner ? { value: learner.id, type: String } : null
        if (c.kind === 'name') return learner?.name ? { value: learner.name } : null
        const f = learnerFormula(design, layout, c, row)
        return f ? formula(f, numberFormat(design, c)) : null
      }),
    )
  }

  if (layout.summary.length > 0) {
    data.push(cols.map(() => null))
    for (const s of layout.summary) {
      data.push(
        cols.map((c, i) => {
          if (c.kind === 'name') return { value: SUMMARY_LABELS[s.kind], fontWeight: 'bold' }
          if (i === 0) return null
          const f = summaryFormula(design, layout, c, s.kind)
          return f ? { ...formula(f, numberFormat(design, c, s.kind)), fontWeight: 'bold' } : null
        }),
      )
    }
  }

  const resultIndex = cols.findIndex((c) => c.kind === 'result')
  const sheet: MarkbookSheet = {
    name: sheetName(design.title),
    data,
    widths: cols.map((c) => c.width),
    stickyRows: WEIGHT_ROW,
    stickyColumns: 2,
    ...(resultIndex >= 0
      ? {
          failCells: {
            from: { row: layout.firstRow, column: resultIndex + 1 },
            to: { row: layout.lastRow, column: resultIndex + 1 },
          },
        }
      : {}),
  }
  const notesName = sheet.name === 'Notes' ? 'How it works' : 'Notes'
  return { layout, sheets: [sheet, notesSheet(design, layout, notesName)] }
}

function notesSheet(design: MarkbookDesign, layout: Layout, name: string): MarkbookSheet {
  const lines: string[] = [
    `${design.title.trim() || 'Markbook'}: how this markbook works`,
    '',
    `Type each learner's marks in the white columns, from row ${layout.firstRow}. Everything else is worked out by formulas.`,
    `Row ${OUT_OF_ROW} holds what each assessment is out of and row ${WEIGHT_ROW} the weights. Change them there and every formula follows.`,
    'Type a when a learner was absent, or leave the mark blank when there is no mark yet. It is left out and the other weights share its place.',
    'A learner who is absent for everything gets a instead of a mark. Carry that a into a year markbook and it is left out there too.',
    'Type 0 for a learner who wrote and scored nothing.',
  ]
  if (design.useCategories) {
    lines.push('Each Category average weighs its assessments by their weights in row 3.')
    for (const c of design.categories)
      lines.push(`  ${c.name.trim()}: ${formatNumber(c.weight)}% of the ${label(design)}.`)
  } else {
    lines.push(`The ${label(design)} weighs each assessment by its weight in row 3.`)
  }
  if (design.rounding !== 'none') {
    lines.push(
      `Rounded (%) is the ${label(design)} rounded to ${design.rounding === 'one' ? 'one decimal' : 'a whole number'}.`,
    )
  }
  if (design.showLevel) {
    lines.push(
      `Level is the CAPS achievement level of the unrounded ${label(design)}: 1 (0-29), 2 (30-39), 3 (40-49), 4 (50-59), 5 (60-69), 6 (70-79), 7 (80-100).`,
    )
  }
  if (design.showResult)
    lines.push(`Result is Pass from ${formatNumber(design.passMark)}% of the unrounded ${label(design)}.`)
  if (design.showSummary) lines.push('The class summary below the learners counts only cells with marks.')
  lines.push('', 'Made with Red Pen. Nothing was uploaded.')
  return {
    name,
    data: lines.map((line, i) => [
      line === '' ? null : i === 0 ? { value: line, fontWeight: 'bold' } : { value: line },
    ]),
    widths: [110],
    stickyRows: 0,
    stickyColumns: 0,
  }
}

function label(design: MarkbookDesign): string {
  return (design.markLabel.trim() || 'Term mark').toLowerCase()
}

export async function writeMarkbook(sheets: MarkbookSheet[]): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const blob = await writeXlsxFile(
    sheets.map((s) => ({
      data: s.data,
      sheet: s.name,
      columns: s.widths.map((width) => ({ width })),
      ...(s.stickyRows ? { stickyRowsCount: s.stickyRows } : {}),
      ...(s.stickyColumns ? { stickyColumnsCount: s.stickyColumns } : {}),
      ...(s.failCells
        ? {
            conditionalFormatting: [
              {
                cellRange: s.failCells,
                condition: { formula: `${cellAddress(s.failCells.from)}="Fail"` },
                style: { textColor: '#B3121D', fontWeight: 'bold' as const },
              },
            ],
          }
        : {}),
    })),
  ).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}

function cellAddress(cell: { row: number; column: number }): string {
  return `${columnLetter(cell.column - 1)}${cell.row}`
}
