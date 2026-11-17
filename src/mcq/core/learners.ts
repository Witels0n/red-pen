// Who is writing: a saved Class list, or a Learner list kept with the Assessment (pasted names,
// numbers only, or an imported spreadsheet). Pure, so the preview and what is stored always agree.
import { buildLearners, rowsFromNames, type BuiltRow } from '../../shared/classes/build-learners'
import {
  digitsNeeded,
  learnerNumber,
  MAX_ID_DIGITS,
  maxLearnerNumber,
  type ClassList,
  type Learner,
} from '../../shared/classes/types'
import type { Assessment, LearnerList, LearnerListSource } from './model'

/** The most learners a list can hold: every 4-digit Learner ID. */
export const MAX_LEARNERS = maxLearnerNumber(MAX_ID_DIGITS)

/** A Learner list being made, for a preview: the rows, the learners that can be used, and every problem. */
export interface LearnerListDraft {
  list: LearnerList | null
  rows: BuiltRow[]
  problems: string[]
}

function tooMany(n: number): string {
  return `${n} learners is more than a list can hold (the most is ${MAX_LEARNERS}).`
}

/** Names typed or pasted one per line, numbered 1, 2, 3... with as many digits as the count needs. */
export function listFromNames(text: string): LearnerListDraft {
  const rows = rowsFromNames(text)
  const count = rows.filter((r) => r[0] !== '').length
  if (count === 0) return { list: null, rows: [], problems: ['Type or paste the names, one per line.'] }
  if (count > MAX_LEARNERS) return { list: null, rows: [], problems: [tooMany(count)] }
  const idDigits = digitsNeeded(count)
  const built = buildLearners(rows, { headerRow: false, nameColumns: [0], idDigits })
  return { list: { source: 'pasted', idDigits, learners: built.learners }, rows: built.rows, problems: built.problems }
}

/** Numbers only: Learner IDs 1 to `count`, no names. */
export function listFromCount(count: number): LearnerListDraft {
  if (!Number.isInteger(count) || count < 1)
    return { list: null, rows: [], problems: ['Enter how many learners, 1 or more.'] }
  if (count > MAX_LEARNERS) return { list: null, rows: [], problems: [tooMany(count)] }
  const idDigits = digitsNeeded(count)
  const learners: Learner[] = Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(idDigits, '0') }))
  return {
    list: { source: 'numbers', idDigits, learners },
    rows: learners.map((l, i) => ({ sourceRow: i + 1, id: l.id, name: '', problems: [] })),
    problems: [],
  }
}

export interface ImportChoices {
  headerRow: boolean
  /** Columns joined, in this order, to make each name. */
  nameColumns: number[]
  /** A column of Learner IDs to keep; leave out to number the learners 1, 2, 3... */
  idColumn?: number
}

/**
 * Spreadsheet rows with the teacher's column choices. The digit count fits the largest Learner ID
 * in the ID column, or the number of learners when they are numbered here. Rows with a problem are
 * listed and left out; the list can only be used when there are none.
 */
export function listFromRows(
  rows: readonly (readonly string[])[],
  choices: ImportChoices,
  fileName = '',
): LearnerListDraft {
  if (choices.nameColumns.length === 0 && choices.idColumn === undefined) {
    return { list: null, rows: [], problems: ['Tick at least one name column, or choose an ID column.'] }
  }
  const body = rows.slice(choices.headerRow ? 1 : 0)
  let idDigits: number
  if (choices.idColumn !== undefined) {
    const numbers = body.map((r) => learnerNumber(r[choices.idColumn!] ?? '') ?? 0)
    idDigits = Math.min(MAX_ID_DIGITS, digitsNeeded(Math.max(1, ...numbers)))
  } else {
    const count = body.filter((r) => choices.nameColumns.some((c) => (r[c] ?? '').trim() !== '')).length
    if (count > MAX_LEARNERS) return { list: null, rows: [], problems: [tooMany(count)] }
    idDigits = digitsNeeded(Math.max(1, count))
  }
  const built = buildLearners(rows, { ...choices, idDigits })
  if (built.rows.length === 0) return { list: null, rows: [], problems: ['The chosen columns are empty.'] }
  return {
    list: { source: 'imported', idDigits, learners: built.learners, ...(fileName ? { fileName } : {}) },
    rows: built.rows,
    problems: built.problems,
  }
}

/** A Learner list as a Class list (not saved), so printing, marking and Review treat both the same. */
export function learnerListAsClass(
  a: Pick<Assessment, 'id' | 'title' | 'createdAt' | 'updatedAt'>,
  list: LearnerList,
): ClassList {
  return {
    id: `assessment:${a.id}`,
    name: SOURCE_NAMES[list.source],
    idDigits: list.idDigits,
    learners: list.learners,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

const SOURCE_NAMES: Record<LearnerListSource, string> = {
  pasted: 'the pasted names',
  numbers: 'the numbered learners',
  imported: 'the imported list',
}

/** The Learner list in use, when the learners come from one. */
export function activeLearnerList(a: Pick<Assessment, 'print' | 'learnerList'>): LearnerList | null {
  const source = a.print.learnerSource
  return a.learnerList && a.learnerList.source === source ? a.learnerList : null
}

/**
 * The learners the sheets are printed for and marked against: the saved Class list (when the source
 * is a Class list and it is on this device), the Assessment's Learner list, or none.
 */
export function rosterFor(
  a: Pick<Assessment, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'print' | 'learnerList'>,
  savedClass: ClassList | null,
): ClassList | null {
  if (a.print.learnerSource === 'class') return savedClass && savedClass.id === a.print.classId ? savedClass : null
  const list = activeLearnerList(a)
  return list ? learnerListAsClass(a, list) : null
}
