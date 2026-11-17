// What goes on each Cover sheet, from a Class list and the teacher's choices. Pure; see
// tests/covers.test.ts. Printing itself is renderCoverSheetsPdf in the sheet engine.
import type { ClassList } from '../shared/classes'
import type { CoverSpec } from '../shared/omr'
import { safeFileBase } from '../shared/pdf/file-names'

export interface CoverChoices {
  /** Printed on the test line; left blank for the learner to fill in when empty. */
  title: string
  /** Printed under the name with the class name, for example "Grade 8A · Natural Sciences". */
  subject: string
  /** Print each learner's name (true), or the Learner ID only. */
  includeNames: boolean
}

/** One Cover sheet per learner, in the Class list's order. */
export function coverSpecs(list: ClassList, choices: CoverChoices): CoverSpec[] {
  const title = choices.title.trim()
  const subject = choices.subject.trim()
  const className = [list.name.trim(), subject].filter((s) => s !== '').join(' · ')
  return list.learners.map((l) => {
    const name = choices.includeNames ? l.name?.trim() : undefined
    return {
      learnerId: l.id,
      ...(name ? { learnerName: name } : {}),
      ...(className ? { className } : {}),
      ...(title ? { title } : {}),
    }
  })
}

/** "Grade 8A cover sheets.pdf". */
export function coverFileName(list: ClassList): string {
  return `${safeFileBase(list.name, 'class')} cover sheets.pdf`
}
