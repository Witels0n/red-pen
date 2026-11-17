// Builds Assessments and fake scanned pages for the MCQ tests, without a scanner.
import type { Answer, SheetVersion } from '../../src/shared/omr/types'
import { newAssessment, type Assessment, type ScannedPage } from '../../src/mcq/core/model'
import { planFor, toPrinted, withVersionSettings } from '../../src/mcq/core/versions'

/** n questions with 4 options, Memo cycling A, B, C, D, Topics alternating "Fractions" and "Decimals". */
export function assessment(n = 12, versions = 1, seed = 42): Assessment {
  let a = newAssessment('Grade 7 test', n, 1000, seed)
  a = {
    ...a,
    questions: a.questions.map((q, i) => ({ ...q, answer: i % 4, topic: i % 2 ? 'Decimals' : 'Fractions' })),
  }
  return withVersionSettings(a, { count: versions })
}

let next = 1

/**
 * The pages a learner's sheet would produce, read perfectly. `answers` are in the original order
 * as original options (null blank, 'multiple' for two circles).
 */
export function pagesFor(
  a: Assessment,
  learnerId: string | undefined,
  version: SheetVersion,
  answers: Answer[],
  options: { confidence?: (position: number) => number; idSource?: 'qr' | 'bubbles' } = {},
): ScannedPage[] {
  const plan = planFor(a, version)!
  const n = a.questions.length
  const pages = Math.max(1, Math.ceil(n / 50))
  const printed: Answer[] = Array.from({ length: n }, () => null)
  answers.forEach((ans, q) => {
    const { position } = toPrinted(plan, q, 0)
    printed[position] = typeof ans === 'number' ? toPrinted(plan, q, ans).option : ans
  })
  return Array.from({ length: pages }, (_, p) => {
    const start = p * 50
    const onPage = printed.slice(start, start + 50)
    const confidences = onPage.map((ans, i) => options.confidence?.(start + i) ?? (ans === 'multiple' ? 0.3 : 0.95))
    return {
      id: `p${next++}`,
      fileName: 'scan.pdf',
      filePage: p + 1,
      read: {
        ok: true,
        kind: 'answer-sheet',
        ...(learnerId ? { learnerId } : {}),
        idSource: options.idSource ?? 'qr',
        idConfidence: 1,
        version,
        page: p + 1,
        pages,
        questionStart: start,
        answers: onPage,
        confidences,
        flags: onPage.map((ans) => (ans === 'multiple' ? ['multiple' as const] : [])),
        problems: [],
      },
      decisions: {},
      addedAt: 0,
    }
  })
}

/** The Memo as answers (everyone right). */
export function memoAnswers(a: Assessment): Answer[] {
  return a.questions.map((q) => q.answer)
}
