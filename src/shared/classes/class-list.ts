import { tidyName } from './build-learners'
import {
  formatLearnerId,
  isIdDigits,
  learnerNumber,
  maxLearnerNumber,
  type ClassList,
  type Learner,
} from './types'

/** A random id for a new Class list (not a Learner ID). */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A new, not yet saved Class list. */
export function newClassList(name: string, idDigits: number, learners: Learner[], now = Date.now()): ClassList {
  return { id: newId(), name: tidyName(name) || 'Untitled class', idDigits, learners, createdAt: now, updatedAt: now }
}

/** Problems that stop a Class list being saved. Empty when it is fine. */
export function classListProblems(list: ClassList): string[] {
  const problems: string[] = []
  if (!list.id) problems.push('The class has no id.')
  if (!tidyName(list.name ?? '')) problems.push('The class needs a name.')
  if (!isIdDigits(list.idDigits)) {
    problems.push('Learner IDs must have 1 to 4 digits.')
    return problems
  }
  const seen = new Set<string>()
  for (const l of list.learners) {
    const n = learnerNumber(l.id)
    if (n === null || l.id.length !== list.idDigits || n < 1) problems.push(`"${l.id}" is not a ${list.idDigits}-digit Learner ID.`)
    else if (seen.has(l.id)) problems.push(`Learner ID ${l.id} is used twice.`)
    seen.add(l.id)
  }
  return problems
}

/** The next free Learner ID: one more than the highest in use. Null when the digits are used up. */
export function nextLearnerId(list: ClassList): string | null {
  const highest = Math.max(0, ...list.learners.map((l) => learnerNumber(l.id) ?? 0))
  return highest + 1 > maxLearnerNumber(list.idDigits) ? null : formatLearnerId(highest + 1, list.idDigits)
}

function withLearners(list: ClassList, learners: Learner[]): ClassList {
  return { ...list, learners }
}

function learner(id: string, name: string): Learner {
  const tidy = tidyName(name)
  return tidy ? { id, name: tidy } : { id }
}

/** Adds a learner at the end with the next free Learner ID. Returns the list unchanged when none is free. */
export function addLearner(list: ClassList, name = ''): ClassList {
  const id = nextLearnerId(list)
  return id === null ? list : withLearners(list, [...list.learners, learner(id, name)])
}

export function removeLearner(list: ClassList, id: string): ClassList {
  return withLearners(
    list,
    list.learners.filter((l) => l.id !== id),
  )
}

/** Sets or clears (with an empty name) a learner's name. */
export function renameLearner(list: ClassList, id: string, name: string): ClassList {
  return withLearners(
    list,
    list.learners.map((l) => (l.id === id ? learner(id, name) : l)),
  )
}

/** Moves the learner at index `from` to index `to`. Learner IDs do not change. */
export function moveLearner(list: ClassList, from: number, to: number): ClassList {
  const learners = [...list.learners]
  if (from < 0 || from >= learners.length || to < 0 || to >= learners.length) return list
  const [moved] = learners.splice(from, 1)
  learners.splice(to, 0, moved)
  return withLearners(list, learners)
}

const collator = new Intl.Collator('en-ZA', { sensitivity: 'base', numeric: true })

/** Sorts by name (A to Z); learners without a name go last, by Learner ID. IDs do not change. */
export function sortByName(list: ClassList): ClassList {
  const learners = [...list.learners].sort((a, b) => {
    if (a.name && b.name) return collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
    if (a.name) return -1
    if (b.name) return 1
    return a.id.localeCompare(b.id)
  })
  return withLearners(list, learners)
}

export type ChangeDigitsResult =
  | { ok: true; list: ClassList }
  /** `tooLong` lists the Learner IDs that would not fit. */
  | { ok: false; tooLong: string[] }

/** Re-pads every Learner ID to a new digit count, for example "07" to "007" or "007" to "7". */
export function changeIdDigits(list: ClassList, idDigits: number): ChangeDigitsResult {
  if (!isIdDigits(idDigits)) return { ok: false, tooLong: [] }
  const max = maxLearnerNumber(idDigits)
  const tooLong = list.learners.filter((l) => (learnerNumber(l.id) ?? 0) > max).map((l) => l.id)
  if (tooLong.length > 0) return { ok: false, tooLong }
  return {
    ok: true,
    list: {
      ...list,
      idDigits,
      learners: list.learners.map((l) => ({ ...l, id: formatLearnerId(learnerNumber(l.id)!, idDigits) })),
    },
  }
}

/** A copy with a new id and "(copy)" after the name, ready to save. */
export function duplicateClassList(list: ClassList, now = Date.now()): ClassList {
  return {
    ...list,
    id: newId(),
    name: `${list.name} (copy)`,
    learners: list.learners.map((l) => ({ ...l })),
    createdAt: now,
    updatedAt: now,
  }
}

/** How many learners in the list have a name. */
export function namedCount(list: ClassList): number {
  return list.learners.filter((l) => l.name).length
}
