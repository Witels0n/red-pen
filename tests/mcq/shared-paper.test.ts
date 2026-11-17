import { describe, expect, it } from 'vitest'
import { assessmentFromFile, assessmentToFile } from '../../src/mcq/core/assessment-file'
import { collate, markAll } from '../../src/mcq/core/marking'
import {
  newAssessment,
  upgradeAssessment,
  withQuestion,
  withQuestionCount,
  type Assessment,
} from '../../src/mcq/core/model'
import {
  balancedSeed,
  keepsOptionOrder,
  spreadScore,
  planVersions,
  printedMemo,
  refreshVersions,
  sharedShuffleActive,
  withVersionSettings,
} from '../../src/mcq/core/versions'
import { memoTable } from '../../src/mcq/pdf/booklet'
import type { ScannedPage } from '../../src/mcq/core/model'
import { assessment, memoAnswers, pagesFor } from './fixtures'

/** n questions with question text and option text, Memo cycling A, B, C, D as the teacher typed it. */
function withText(n = 12, seed = 42): Assessment {
  const a = assessment(n, 1, seed)
  return refreshVersions({
    ...a,
    questions: a.questions.map((q, i) => ({
      ...q,
      text: `Question ${i + 1}`,
      options: q.options.map((_, k) => `Option ${'ABCD'[k]} of ${i + 1}`),
    })),
  })
}

/** A learner's sheet read perfectly, given the letters filled in as printed (0 is A). */
function printedSheet(learnerId: string, printed: (number | null)[]): ScannedPage {
  return {
    id: `sheet-${learnerId}`,
    fileName: 'scan.pdf',
    filePage: 1,
    read: {
      ok: true,
      kind: 'answer-sheet',
      learnerId,
      idSource: 'qr',
      idConfidence: 1,
      version: 'A',
      page: 1,
      pages: 1,
      questionStart: 0,
      answers: printed,
      confidences: printed.map(() => 0.95),
      flags: printed.map(() => []),
      problems: [],
    },
    decisions: {},
    addedAt: 0,
  }
}

describe('the shared paper', () => {
  it('is the default for a new Assessment: one Version, four options, the shared shuffle on', () => {
    const a = newAssessment('Test', 10, 1000, 7)
    expect(a.versions.count).toBe(1)
    expect(a.versions.shuffleShared).toBe(true)
    expect(a.questions.every((q) => q.options.length === 4)).toBe(true)
  })

  it('shuffles each question’s options once, keeps the question order, and spreads the correct letters', () => {
    const a = withText(24)
    const [A] = a.versions.plans
    expect(a.versions.plans).toHaveLength(1)
    expect(A.questionOrder).toEqual([...Array(24).keys()])
    expect(A.optionOrder.every((o) => [...o].sort().join() === '0,1,2,3')).toBe(true)
    expect(keepsOptionOrder(A)).toBe(false)
    const memo = printedMemo(a, A)
    const entered = a.questions.map((q) => q.answer)
    expect(memo.filter((m, i) => m !== entered[i]).length).toBeGreaterThan(0)
    expect(new Set(memo).size).toBeGreaterThan(1)
  })

  it('is deterministic and stored: the same seed gives the same paper', () => {
    const a = withText(12)
    expect(planVersions(a.questions, a.versions)).toEqual(a.versions.plans)
    expect(refreshVersions(a)).toBe(a)
  })

  it('does not change how the other questions print when a question is added after marking began', () => {
    const a = withText(12)
    const marked = { ...a, scans: pagesFor(a, '01', 'A', memoAnswers(a)) }
    const more = refreshVersions(withQuestionCount(marked, 13))
    expect(more.versions.seed).toBe(a.versions.seed)
    expect(more.versions.plans[0].optionOrder.slice(0, 12)).toEqual(a.versions.plans[0].optionOrder)
  })

  it('spreads the correct answers evenly across the letters when the paper is planned', () => {
    // The teacher's Memo is all A: printed, the answers spread across A to D.
    const base = assessment(12, 1, 5)
    const allA = { ...base, questions: base.questions.map((q, i) => ({ ...q, answer: 0, text: `Q${i + 1}` })) }
    const a = refreshVersions({ ...allA, versions: { ...allA.versions, plans: [] } })
    const counts = [0, 0, 0, 0]
    for (const m of printedMemo(a, a.versions.plans[0])) counts[m!]++
    expect(counts).toEqual([3, 3, 3, 3])
    expect(spreadScore(a.questions, a.versions.plans[0])).toBe(0)
    expect(balancedSeed(a.questions, 123)).toBe(balancedSeed(a.questions, 123))
  })

  it('Shuffle again (a new seed) gives a different paper', () => {
    const a = withText(12)
    const again = withVersionSettings(a, { seed: 99 })
    expect(again.versions.plans[0].optionOrder).not.toEqual(a.versions.plans[0].optionOrder)
  })

  it('prints in the entered order when there is no question text or picture (answers only)', () => {
    const a = refreshVersions(assessment(12))
    expect(a.versions.shuffleShared).toBe(true)
    expect(sharedShuffleActive(a.questions, a.versions)).toBe(false)
    expect(keepsOptionOrder(a.versions.plans[0])).toBe(true)
    // The first question text turns the shuffle on; removing it turns it off again.
    const typed = refreshVersions(withQuestion(a, 0, { text: 'Which is biggest?' }))
    expect(keepsOptionOrder(typed.versions.plans[0])).toBe(false)
    const cleared = refreshVersions(withQuestion(typed, 0, { text: '' }))
    expect(keepsOptionOrder(cleared.versions.plans[0])).toBe(true)
  })

  it('prints in the entered order when the teacher turns the shuffle off', () => {
    const a = withVersionSettings(withText(12), { shuffleShared: false })
    expect(keepsOptionOrder(a.versions.plans[0])).toBe(true)
  })

  it('marks a shuffled shared paper against the Memo the teacher typed in their own order', () => {
    const a = withText(12)
    const plan = a.versions.plans[0]
    const memo = printedMemo(a, plan) as number[]
    // Thandi fills the printed letter of every correct answer.
    const thandi = printedSheet('01', memo)
    // Sipho fills the letters as the teacher typed them: wrong wherever the shuffle moved the answer.
    const entered = a.questions.map((q) => q.answer as number)
    const sipho = printedSheet('02', entered)
    const { learners, review } = collate({ ...a, scans: [thandi, sipho] })
    expect(review).toEqual([])
    const [t, s] = markAll(a, learners)
    expect([t.score, t.outOf]).toEqual([12, 12])
    // Responses are in the entered order: Thandi's equal the Memo as typed.
    expect(learners[0].responses).toEqual(entered)
    const moved = memo.filter((m, i) => m !== entered[i]).length
    expect(moved).toBeGreaterThan(0)
    expect(s.score).toBe(12 - moved)
    // The fixtures' helper (original answers in, printed letters out) agrees.
    const [f] = markAll(a, collate({ ...a, scans: pagesFor(a, '03', 'A', memoAnswers(a)) }).learners)
    expect(f.score).toBe(12)
  })

  it('shows the printed letter and the entered letter in the Memo', () => {
    const a = withText(8)
    const columns = memoTable(a, a.versions.plans[0])
    expect(columns.map((c) => c.title)).toEqual(['Q', 'Answer', 'Entered as', 'Marks', 'Topic'])
    const answer = columns.find((c) => c.key === 'answer')!.cells
    const entered = columns.find((c) => c.key === 'entered')!.cells
    expect(entered).toEqual(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])
    expect(answer).toEqual(printedMemo(a, a.versions.plans[0]).map((m) => 'ABCD'[m!]))
    expect(answer).not.toEqual(entered)
    // Unshuffled: no "Entered as" column.
    const plain = withVersionSettings(a, { shuffleShared: false })
    expect(memoTable(plain, plain.versions.plans[0]).map((c) => c.key)).not.toContain('entered')
  })

  it('also shuffles Version A when there are Versions, and leaves B unchanged by it', () => {
    const a = withVersionSettings(withText(12), { count: 2 })
    const off = withVersionSettings(a, { shuffleShared: false })
    expect(keepsOptionOrder(a.versions.plans[0])).toBe(false)
    expect(keepsOptionOrder(off.versions.plans[0])).toBe(true)
    expect(off.versions.plans[1]).toEqual(a.versions.plans[1])
  })
})

describe('Assessments saved before the shared paper', () => {
  /** As an earlier Red Pen stored it: no shuffleShared, learnerSource or learnerList. */
  function legacy(): Assessment {
    const a = withVersionSettings(withText(12), { shuffleShared: false })
    const { learnerList: _l, ...rest } = a
    const { shuffleShared: _s, ...versions } = a.versions
    const { learnerSource: _p, ...print } = a.print
    return { ...rest, versions, print: { ...print, classId: 'class-1' } } as unknown as Assessment
  }

  it('keep their behaviour: the shared shuffle is off, so the printed sheets still mark correctly', () => {
    const old = legacy()
    const up = refreshVersions(upgradeAssessment(old))
    expect(up.versions.shuffleShared).toBe(false)
    expect(up.versions.plans).toEqual(old.versions.plans)
    expect(keepsOptionOrder(up.versions.plans[0])).toBe(true)
    expect(up.print.learnerSource).toBe('class')
    expect(up.learnerList).toBeNull()
    // A sheet filled as printed (the entered order) still gets full marks.
    const entered = up.questions.map((q) => q.answer as number)
    const [m] = markAll(up, collate({ ...up, scans: [printedSheet('01', entered)] }).learners)
    expect(m.score).toBe(12)
  })

  it('uses no list for a Bubbled ID assessment without a Class list', () => {
    const old = legacy()
    const bubbled = { ...old, print: { ...old.print, mode: 'bubbled-id' as const, classId: null } }
    expect(upgradeAssessment(bubbled).print.learnerSource).toBe('none')
  })

  it('leaves a current Assessment alone', () => {
    const a = withText(4)
    expect(upgradeAssessment(a)).toBe(a)
  })

  it('reads a schema 1 Assessment file with the shared shuffle off and its Class list as the learners', () => {
    const old = legacy()
    const file = JSON.parse(assessmentToFile(old, 'Grade 7B'))
    file.schema = 1
    const back = assessmentFromFile(JSON.stringify(file))
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.assessment.versions.shuffleShared).toBe(false)
    expect(back.assessment.print.learnerSource).toBe('class')
    expect(back.assessment.learnerList).toBeNull()
    expect(back.assessment.versions.plans).toEqual(old.versions.plans)
    expect(refreshVersions(back.assessment).versions.plans).toEqual(old.versions.plans)
  })

  it('needs the new fields in a schema 2 file', () => {
    const file = JSON.parse(assessmentToFile(withText(3)))
    delete file.assessment.versions.shuffleShared
    delete file.assessment.print.learnerSource
    const back = assessmentFromFile(JSON.stringify(file))
    expect(back.ok).toBe(false)
    if (back.ok) return
    expect(back.problems).toContain('versions.shuffleShared must be true or false.')
    expect(back.problems.some((p) => p.startsWith('print.learnerSource must be one of'))).toBe(true)
  })
})
