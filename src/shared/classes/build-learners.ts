import { formatLearnerId, learnerNumber, maxLearnerNumber, type Learner } from './types'

export interface BuildLearnersOptions {
  /** Whether the first row holds column titles rather than a learner. */
  headerRow: boolean
  /** Columns (counted from 0) joined, in this order, to make each name, e.g. [first name, surname]. */
  nameColumns: number[]
  /** A column of Learner IDs to keep. Leave out to number the learners 1, 2, 3... */
  idColumn?: number
  idDigits: number
  /** Put between the parts of a name. */
  joiner?: string
}

/** One row of the source that became (or failed to become) a learner. */
export interface BuiltRow {
  /** The row's number in the spreadsheet, counted from 1 as Excel shows it. */
  sourceRow: number
  /** The Learner ID as it will be saved, or as it was typed when it has a problem. */
  id: string
  name: string
  problems: string[]
}

export interface BuildLearnersResult {
  /** Only the rows without problems. */
  learners: Learner[]
  /** Every row that was not empty, for a preview. */
  rows: BuiltRow[]
  /** Every problem, each starting with its row number. Empty when the list can be saved. */
  problems: string[]
}

/** Trims and collapses runs of spaces, tabs and line breaks into single spaces. */
export function tidyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Turns spreadsheet rows into learners. Pure, so the preview and the save always agree.
 * Rows whose chosen cells are all empty are skipped. With an ID column, each ID must be a whole
 * number from 1 up, fit in `idDigits` digits and be unique; otherwise learners get 1, 2, 3...
 */
export function buildLearners(
  rows: readonly (readonly string[])[],
  options: BuildLearnersOptions,
): BuildLearnersResult {
  const { headerRow, nameColumns, idColumn, idDigits } = options
  const joiner = options.joiner ?? ' '
  const max = maxLearnerNumber(idDigits)
  const built: BuiltRow[] = []
  const seen = new Map<number, number>() // Learner ID -> the row that first used it
  let next = 1

  rows.forEach((cells, index) => {
    if (headerRow && index === 0) return
    const sourceRow = index + 1
    const name = nameColumns
      .map((c) => tidyName(cells[c] ?? ''))
      .filter((part) => part !== '')
      .join(joiner)
    const rawId = idColumn === undefined ? '' : (cells[idColumn] ?? '').trim()
    if (name === '' && rawId === '') return

    const problems: string[] = []
    let id: string
    if (idColumn === undefined) {
      const n = next++
      if (n > max) {
        problems.push(`Too many learners for ${idDigits}-digit IDs (the most is ${max}).`)
        id = String(n)
      } else {
        id = formatLearnerId(n, idDigits)
      }
    } else {
      const n = learnerNumber(rawId)
      id = rawId
      if (rawId === '') problems.push('No Learner ID.')
      else if (n === null) problems.push(`"${rawId}" is not a number.`)
      else if (n < 1) problems.push('A Learner ID must be 1 or more.')
      else if (n > max) problems.push(`${rawId} does not fit in ${idDigits} digit${idDigits === 1 ? '' : 's'}.`)
      else {
        id = formatLearnerId(n, idDigits)
        const first = seen.get(n)
        if (first !== undefined) problems.push(`Learner ID ${id} is also on row ${first}.`)
        else seen.set(n, sourceRow)
      }
    }
    built.push({ sourceRow, id, name, problems })
  })

  return {
    learners: built
      .filter((r) => r.problems.length === 0)
      .map((r) => (r.name ? { id: r.id, name: r.name } : { id: r.id })),
    rows: built,
    problems: built.flatMap((r) => r.problems.map((p) => `Row ${r.sourceRow}: ${p}`)),
  }
}

/**
 * Typed or pasted names, one per line, as rows for `buildLearners` (name column 0).
 * Cells pasted from a spreadsheet arrive separated by tabs; they are joined with a space.
 */
export function rowsFromNames(text: string): string[][] {
  return text.split(/\r\n|\r|\n/).map((line) => [
    line
      .split('\t')
      .map(tidyName)
      .filter((p) => p !== '')
      .join(' '),
  ])
}

/** A numbers-only class: `count` learners with IDs 1, 2, 3... and no names. */
export function numberedLearners(count: number, idDigits: number): Learner[] {
  return Array.from({ length: count }, (_, i) => ({ id: formatLearnerId(i + 1, idDigits) }))
}
