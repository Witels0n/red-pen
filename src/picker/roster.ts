// The learners the Class picker works with: from a Class list, pasted names or numbers 1 to N.
import { tidyName } from '../shared/classes/build-learners'
import type { ClassList } from '../shared/classes/types'

/** One learner in the picker. `key` is stable for the session, so attendance and rules survive a reload. */
export interface PickerLearner {
  key: string
  name: string
  /** An optional second column, such as a level, used to balance groups. */
  tag?: string
}

export const MAX_LEARNERS = 200
export const MAX_NUMBERS = 99

const HEADER = /^(names?|learners?|full ?names?|learner names?)$/i

/**
 * Names, one per line. A second column after a tab, comma or semicolon (as pasted from a spreadsheet)
 * becomes the learner's tag, for example a level. A header row such as "Name, Level" is skipped.
 */
export function parsePastedNames(text: string): { learners: PickerLearner[]; tagTitle?: string; dropped: number } {
  const learners: PickerLearner[] = []
  let tagTitle: string | undefined
  let dropped = 0
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,;]/)).map(tidyName)
    const name = cells[0] ?? ''
    const tag = cells.slice(1).find((c) => c !== '')
    if (name === '') return
    if (learners.length === 0 && HEADER.test(name)) {
      tagTitle = tag
      return
    }
    if (learners.length >= MAX_LEARNERS) {
      dropped++
      return
    }
    learners.push(tag ? { key: `p${index + 1}`, name, tag } : { key: `p${index + 1}`, name })
  })
  return { learners, tagTitle, dropped }
}

/** Learners called 1, 2, 3 ... up to `count`. */
export function numberedLearners(count: number): PickerLearner[] {
  const n = Math.max(0, Math.min(MAX_NUMBERS, Math.trunc(count)))
  return Array.from({ length: n }, (_, i) => ({ key: `n${i + 1}`, name: String(i + 1) }))
}

/** A saved Class list's learners, by name, or "Learner 07" when the list has no name for them. */
export function classLearners(list: ClassList): PickerLearner[] {
  return list.learners.slice(0, MAX_LEARNERS).map((l) => ({ key: `c${l.id}`, name: l.name || `Learner ${l.id}` }))
}

/** The learners who are here today, in list order. */
export function presentLearners(learners: readonly PickerLearner[], absent: ReadonlySet<string>): PickerLearner[] {
  return learners.filter((l) => !absent.has(l.key))
}

/** The distinct tags in use, most common first. */
export function tagsInUse(learners: readonly PickerLearner[]): string[] {
  const counts = new Map<string, number>()
  for (const l of learners) if (l.tag) counts.set(l.tag, (counts.get(l.tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

/** Options for a custom wheel, one per line, blank lines and repeats of the same text dropped. */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const option = tidyName(line)
    if (option === '' || seen.has(option.toLowerCase())) continue
    seen.add(option.toLowerCase())
    out.push(option)
    if (out.length >= MAX_LEARNERS) break
  }
  return out
}
