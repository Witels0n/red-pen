import { buildLearners } from './build-learners'
import { parseCsv, writeCsv } from './csv'
import { MAX_ID_DIGITS, learnerNumber, digitsNeeded, type ClassList, type Learner } from './types'

/** The column titles of a class file, in order. */
export const CLASS_CSV_HEADER = ['Learner ID', 'Name'] as const

/**
 * A Class list as a class file: CSV with the columns `Learner ID,Name`.
 * Starts with a byte order mark so Excel reads names with accents correctly.
 */
export function classToCsv(list: ClassList): string {
  return '﻿' + writeCsv([[...CLASS_CSV_HEADER], ...list.learners.map((l) => [l.id, l.name ?? ''])])
}

/** "Grade 8A / Maths" -> "Grade 8A Maths.csv": safe on every system, still readable. */
export function classFileName(list: ClassList): string {
  const base = list.name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || 'class'}.csv`
}

export interface ClassCsvResult {
  learners: Learner[]
  idDigits: number
  problems: string[]
}

/**
 * Reads a class file made by `classToCsv` (or by hand in the same shape).
 * The digit count comes from the longest Learner ID, so "007" stays three digits even
 * though Excel may have shown it as 7.
 */
export function classFromCsv(text: string): ClassCsvResult {
  const rows = parseCsv(text)
  const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? []
  if (header[0] !== 'learner id') {
    return { learners: [], idDigits: 2, problems: ['This is not a class file: the first column must be "Learner ID".'] }
  }
  const nameColumn = header.indexOf('name')
  const ids = rows
    .slice(1)
    .map((r) => (r[0] ?? '').trim())
    .filter((id) => id !== '')
  const longest = Math.max(
    1,
    ...ids.map((id) => (learnerNumber(id) === null ? 1 : Math.max(id.length, digitsNeeded(learnerNumber(id)!)))),
  )
  const idDigits = Math.min(MAX_ID_DIGITS, longest)
  const built = buildLearners(rows, {
    headerRow: true,
    nameColumns: nameColumn >= 0 ? [nameColumn] : [],
    idColumn: 0,
    idDigits,
  })
  const problems = built.problems
  if (built.rows.length === 0) problems.push('The class file has no learners.')
  return { learners: built.learners, idDigits, problems }
}
