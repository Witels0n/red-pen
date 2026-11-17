// Rows pasted from Excel or Google Sheets (tab-separated), in the grid's column order:
// Number, Marks, Level, Topic, Content area, Difficulty, Notes.
import { emptyRow, parseNumber, type Difficulty, type QuestionRow } from './model'
import { matchLevel, type Level } from './taxonomy'

export const PASTE_COLUMNS = ['Number', 'Marks', 'Level', 'Topic', 'Content area', 'Difficulty', 'Notes'] as const

/** True when the text looks like spreadsheet cells rather than a single value. */
export function looksLikeCells(text: string): boolean {
  return text.includes('\t') || /\r?\n./.test(text.trim())
}

export function splitCells(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1')))
    .filter((cells) => cells.some((c) => c !== ''))
}

export function matchDifficulty(s: string): Difficulty {
  const t = s.trim().toLowerCase()
  if (!t) return ''
  if (t.startsWith('e') || t === '1') return 'easy'
  if (t.startsWith('m') || t === '2') return 'moderate'
  if (t.startsWith('d') || t.startsWith('h') || t === '3') return 'difficult'
  return ''
}

/** A header row: the marks cell is not a number but says something like "Marks". */
function isHeader(cells: string[]): boolean {
  return cells.length > 1 && parseNumber(cells[1] ?? '') === null && /mark|punt|total/i.test(cells[1] ?? '')
}

/**
 * Turns pasted cells into rows. `startColumn` is the column the paste lands in (0 is Number), so a
 * column of marks pasted into the Marks column fills marks only.
 */
export function rowsFromCells(
  grid: string[][],
  levels: readonly Level[],
  startColumn = 0,
): { rows: Partial<QuestionRow>[]; skippedHeader: boolean } {
  const skippedHeader = grid.length > 0 && startColumn === 0 && isHeader(grid[0])
  const body = skippedHeader ? grid.slice(1) : grid
  const rows = body.map((cells) => {
    const row: Partial<QuestionRow> = {}
    cells.forEach((value, i) => {
      const col = startColumn + i
      if (col === 0) row.number = value
      else if (col === 1) row.marks = parseNumber(value)
      else if (col === 2) row.level = matchLevel(levels, value)
      else if (col === 3) row.topic = value
      else if (col === 4) row.area = value
      else if (col === 5) row.difficulty = matchDifficulty(value)
      else if (col === 6) row.notes = value
    })
    return row
  })
  return { rows, skippedHeader }
}

/**
 * Applies pasted rows into the table from `atRow` down, overwriting the cells they cover and
 * adding rows at the end when needed. Returns the new row list.
 */
export function applyPaste(
  existing: readonly QuestionRow[],
  pasted: readonly Partial<QuestionRow>[],
  atRow: number,
): QuestionRow[] {
  const rows = existing.map((r) => ({ ...r }))
  pasted.forEach((p, i) => {
    const at = atRow + i
    if (at >= rows.length) rows.push({ ...emptyRow(), ...p })
    else rows[at] = { ...rows[at], ...p }
  })
  return rows
}
