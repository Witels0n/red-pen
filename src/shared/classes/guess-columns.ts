/**
 * First guesses for the spreadsheet import, so a typical class list needs no clicks:
 * whether row 1 holds titles, which columns make the name, and which holds the Learner ID.
 * The teacher can change every guess.
 */

const FIRST = /^(first|given|preferred)?\s*names?$|^first\s*name|^given/i
const SURNAME = /^(sur|last|family)\s*name|^surname/i
const FULL = /^(learner|student|pupil|full)?\s*names?$/i
const ID = /^(learner\s*id|id|learner\s*(no|number)|no\.?|number|nr\.?)$/i

export interface ColumnGuess {
  headerRow: boolean
  nameColumns: number[]
  idColumn?: number
}

function looksLikeTitle(cell: string): boolean {
  return (
    FIRST.test(cell) || SURNAME.test(cell) || FULL.test(cell) || ID.test(cell) || /name|surname|class|grade/i.test(cell)
  )
}

export function guessColumns(rows: readonly (readonly string[])[]): ColumnGuess {
  const first = (rows[0] ?? []).map((c) => c.trim())
  const headerRow = first.some(looksLikeTitle)
  if (!headerRow) {
    // No titles: take the first column that is mostly not numbers as the name.
    const width = first.length
    const sample = rows.slice(0, 20)
    for (let c = 0; c < width; c++) {
      const texts = sample.filter((r) => (r[c] ?? '').trim() !== '' && !/^\d+$/.test(r[c].trim()))
      if (texts.length > 0) return { headerRow, nameColumns: [c] }
    }
    return { headerRow, nameColumns: width > 0 ? [0] : [] }
  }

  const find = (re: RegExp) => first.findIndex((c) => re.test(c))
  const firstName = find(FIRST)
  const surname = find(SURNAME)
  const full = find(FULL)
  const id = find(ID)
  const notId = first.findIndex((_, i) => i !== id)
  let nameColumns: number[]
  if (firstName >= 0 && surname >= 0) nameColumns = [firstName, surname]
  else if (full >= 0) nameColumns = [full]
  else if (firstName >= 0) nameColumns = [firstName]
  else if (surname >= 0) nameColumns = [surname]
  else nameColumns = notId >= 0 ? [notId] : []
  return id >= 0 && !nameColumns.includes(id) ? { headerRow, nameColumns, idColumn: id } : { headerRow, nameColumns }
}

/** "A", "B", ... "Z", "AA": the column letters a spreadsheet shows. */
export function columnLetter(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
