// What to print and what the reader expects: SheetSpecs for every Answer sheet, and one template
// per Version for reading them back.
import type { ClassList } from '../../shared/classes/types'
import { assessmentCodeFrom } from '../../shared/omr/qr-payload'
import type { SheetIdentity, SheetSpec, SheetVersion } from '../../shared/omr/types'
import type { Assessment, PrintSettings } from './model'
import { sheetQuestions, versionLetters } from './versions'

export function assessmentCode(a: Pick<Assessment, 'id'>): string {
  return assessmentCodeFrom(a.id)
}

/** The Learner ID digits the sheets use: the Class list's in the QR modes. */
export function idDigitsFor(print: PrintSettings, classList: ClassList | null): number {
  return print.mode !== 'bubbled-id' && classList ? classList.idDigits : print.idDigits
}

function spec(a: Assessment, version: SheetVersion, identity: SheetIdentity): SheetSpec {
  const plan = a.versions.plans.find((p) => p.version === version)
  if (!plan) throw new Error(`This assessment has no Version ${version}.`)
  return {
    assessmentCode: assessmentCode(a),
    title: a.title,
    version,
    identity,
    questions: sheetQuestions(a, plan),
  }
}

/** One template per Version, for the reader: the sheets as printed with the current print settings. */
export function readTemplates(a: Assessment, classList: ClassList | null): SheetSpec[] {
  const identity: SheetIdentity = { mode: a.print.mode, idDigits: idDigitsFor(a.print, classList) }
  return versionLetters(a).map((v) => spec(a, v, identity))
}

/** The Version for the n-th sheet printed (0-based). */
export function versionForSheet(a: Assessment, n: number): SheetVersion {
  const letters = versionLetters(a)
  if (a.print.assign === 'single') return letters.includes(a.print.singleVersion) ? a.print.singleVersion : 'A'
  return letters[n % letters.length]
}

export interface PrintRun {
  specs: SheetSpec[]
  /** Who gets which Version (QR modes), in Class list order. */
  learners: { learnerId: string; name?: string; version: SheetVersion }[]
  spares: number
  /** Sheets per Version. */
  perVersion: Partial<Record<SheetVersion, number>>
}

/** Every Answer sheet to print. Throws with a sentence for the teacher when the settings cannot print. */
export function printRun(a: Assessment, classList: ClassList | null): PrintRun {
  const p = a.print
  const specs: SheetSpec[] = []
  const learners: PrintRun['learners'] = []
  if (p.mode === 'bubbled-id') {
    if (p.copies < 1) throw new Error('Choose how many sheets to print.')
    for (let i = 0; i < p.copies; i++)
      specs.push(spec(a, versionForSheet(a, i), { mode: 'bubbled-id', idDigits: p.idDigits }))
  } else {
    if (!classList) throw new Error('Choose a Class list for sheets with a QR code per learner.')
    if (classList.learners.length === 0 && p.spares === 0) throw new Error('The Class list has no learners.')
    classList.learners.forEach((l, i) => {
      const version = versionForSheet(a, i)
      learners.push({ learnerId: l.id, ...(l.name ? { name: l.name } : {}), version })
      specs.push(
        spec(a, version, {
          mode: p.mode,
          learnerId: l.id,
          ...(p.mode === 'named-qr' && l.name ? { learnerName: l.name } : {}),
          idDigits: classList.idDigits,
        }),
      )
    })
    for (let i = 0; i < p.spares; i++) {
      specs.push(
        spec(a, versionForSheet(a, classList.learners.length + i), { mode: p.mode, idDigits: classList.idDigits }),
      )
    }
  }
  const perVersion: PrintRun['perVersion'] = {}
  for (const s of specs) perVersion[s.version] = (perVersion[s.version] ?? 0) + 1
  return { specs, learners, spares: p.mode === 'bubbled-id' ? 0 : p.spares, perVersion }
}
