import { describe, expect, it } from 'vitest'
import { collate, markAll, markLearner, reviewKey } from '../../src/mcq/core/marking'
import { withQuestion } from '../../src/mcq/core/model'
import { assessment, memoAnswers, pagesFor } from './fixtures'

describe('marking with Versions', () => {
  const a = assessment(12, 2)

  it('maps each Version back to the original order and marks against the Memo', () => {
    const perfect = memoAnswers(a)
    const wrongFirstTwo = perfect.map((x, i) => (i < 2 ? ((x as number) + 1) % 4 : x))
    const scans = [...pagesFor(a, '01', 'A', perfect), ...pagesFor(a, '02', 'B', wrongFirstTwo)]
    const { learners, review } = collate({ ...a, scans })
    expect(review).toEqual([])
    const marks = markAll(a, learners)
    expect(marks.map((m) => [m.learnerId, m.version, m.score, m.outOf])).toEqual([
      ['01', 'A', 12, 12],
      ['02', 'B', 10, 12],
    ])
    expect(marks[1].perQuestion.slice(0, 3).map((q) => q.outcome)).toEqual(['wrong', 'wrong', 'correct'])
    // The responses are original options, whatever letter they had on Version B.
    expect(learners[1].responses).toEqual(wrongFirstTwo)
  })

  it('marks blank and multiple answers as wrong, and weighs marks', () => {
    let b = withQuestion(a, 0, { marks: 3 })
    b = withQuestion(b, 1, { marks: 2 })
    const answers = memoAnswers(b)
    answers[0] = null
    answers[1] = 'multiple'
    const [m] = markAll(b, collate({ ...b, scans: pagesFor(b, '01', 'B', answers) }).learners)
    expect(m.perQuestion[0]).toMatchObject({ outcome: 'blank', earned: 0 })
    expect(m.perQuestion[1]).toMatchObject({ outcome: 'multiple', earned: 0 })
    expect([m.score, m.outOf]).toEqual([10, 15])
  })

  it('leaves questions without a Memo answer out of the total', () => {
    const b = withQuestion(a, 5, { answer: null })
    const [m] = markAll(b, collate({ ...b, scans: pagesFor(b, '01', 'A', memoAnswers(a)) }).learners)
    expect(m.perQuestion[5].outcome).toBe('unmarked')
    expect([m.score, m.outOf]).toEqual([11, 11])
  })
})

describe('long tests on two pages', () => {
  const a = assessment(72, 2)

  it('merges page 2 with page 1 of the same learner', () => {
    const answers = memoAnswers(a)
    answers[60] = ((answers[60] as number) + 1) % 4
    const pages = pagesFor(a, '07', 'B', answers)
    expect(pages.map((p) => [p.read.page, p.read.questionStart, p.read.answers.length])).toEqual([
      [1, 0, 50],
      [2, 50, 22],
    ])
    // Page 2 scanned first, in a different file: still one learner.
    const { learners, review } = collate({ ...a, scans: [pages[1], pages[0]] })
    expect(review).toEqual([])
    expect(learners).toHaveLength(1)
    const [m] = markAll(a, learners)
    expect([m.score, m.outOf]).toEqual([71, 72])
  })

  it('reports a missing page and counts its questions as not answered', () => {
    const [page1] = pagesFor(a, '07', 'A', memoAnswers(a))
    const [m] = markAll(a, collate({ ...a, scans: [page1] }).learners)
    expect(m.missingPages).toEqual([2])
    expect(m.perQuestion[60].outcome).toBe('missing')
    expect([m.score, m.outOf]).toEqual([50, 72])
  })
})

describe('Review', () => {
  const a = assessment(12, 2)

  it('asks about uncertain answers, and a decision settles them', () => {
    const answers = memoAnswers(a)
    answers[3] = 'multiple'
    const [page] = pagesFor(a, '01', 'B', answers)
    const { review } = collate({ ...a, scans: [page] })
    expect(review).toHaveLength(1)
    const item = review[0]
    expect(item).toMatchObject({ kind: 'answer', read: 'multiple' })
    if (item.kind !== 'answer') return
    expect(reviewKey(item)).toBe(`answer:${page.id}:${item.index}`)

    // The teacher picks the letter on the sheet that is the right answer on Version B.
    const plan = a.versions.plans[1]
    const right = plan.optionOrder[item.index].indexOf(a.questions[plan.questionOrder[item.index]].answer!)
    const decided = { ...page, decisions: { [item.index]: right } }
    const after = collate({ ...a, scans: [decided] })
    expect(after.review).toEqual([])
    expect(markAll(a, after.learners)[0].score).toBe(12)

    const keptWrong = { ...page, decisions: { [item.index]: 'multiple' as const } }
    const kept = collate({ ...a, scans: [keptWrong] })
    expect(kept.review).toEqual([])
    expect(markAll(a, kept.learners)[0].score).toBe(11)
  })

  it('asks about low-confidence reads', () => {
    const [page] = pagesFor(a, '01', 'A', memoAnswers(a), { confidence: (p) => (p === 4 ? 0.5 : 0.95) })
    expect(collate({ ...a, scans: [page] }).review.map((r) => r.kind === 'answer' && r.index)).toEqual([4])
  })

  it('finds unknown learners, IDs not on the Class list, duplicates, and a missing Version', () => {
    const [unknown] = pagesFor(a, undefined, 'A', memoAnswers(a))
    const [stranger] = pagesFor(a, '99', 'A', memoAnswers(a))
    const [first] = pagesFor(a, '01', 'A', memoAnswers(a))
    const [again] = pagesFor(a, '01', 'A', memoAnswers(a))
    const [noVersion] = pagesFor(a, '02', 'A', memoAnswers(a))
    delete noVersion.read.version
    const roster = new Set(['01', '02', '03'])
    const { review, learners } = collate({ ...a, scans: [unknown, stranger, first, again, noVersion] }, roster)
    expect(review.map((r) => r.kind + (r.kind === 'identity' ? `:${r.reason}` : ''))).toEqual([
      'identity:unknown',
      'identity:not-on-list',
      'version',
      'duplicate',
    ])
    expect(review.find((r) => r.kind === 'duplicate')).toMatchObject({
      learnerId: '01',
      page: 1,
      pageIds: [first.id, again.id],
    })
    // The unknown sheet is not marked until it has a learner.
    expect(learners.map((l) => l.learnerId)).toEqual(['01', '02', '99'])

    // Assigning, setting the Version and setting a duplicate aside clears everything.
    const fixed = collate(
      {
        ...a,
        scans: [
          { ...unknown, learnerId: '03', learnerConfirmed: true },
          { ...stranger, learnerConfirmed: true, learnerId: '02', ignored: true },
          first,
          { ...again, ignored: true },
          { ...noVersion, version: 'A' as const },
        ],
      },
      roster,
    )
    expect(fixed.review).toEqual([])
    expect(fixed.learners.map((l) => l.learnerId)).toEqual(['01', '02', '03'])
  })

  it('asks to check a Bubbled ID that read with low confidence', () => {
    const [page] = pagesFor(a, '12', 'A', memoAnswers(a), { idSource: 'bubbles' })
    page.read.idConfidence = 0.4
    expect(collate({ ...a, scans: [page] }).review).toEqual([
      { kind: 'identity', pageId: page.id, reason: 'unsure', readId: '12' },
    ])
  })

  it('lists pages that could not be read', () => {
    const [page] = pagesFor(a, '01', 'A', memoAnswers(a))
    const bad = {
      ...page,
      read: { ...page.read, ok: false, problems: ['All four corner squares must be in the photo.'] },
    }
    const { unreadable, learners } = collate({ ...a, scans: [bad] })
    expect(unreadable).toEqual([bad])
    expect(learners).toEqual([])
  })
})

describe('Memo correction', () => {
  it('re-marks from the stored reads without a rescan', () => {
    const a = assessment(12, 2)
    const answers = memoAnswers(a)
    answers[2] = 0 // the Memo says C (2); the learner chose A
    const scans = pagesFor(a, '01', 'B', answers)
    const before = markLearner(a, collate({ ...a, scans }).learners[0])
    expect(before.score).toBe(11)
    const corrected = withQuestion(a, 2, { answer: 0 })
    const after = markLearner(corrected, collate({ ...corrected, scans }).learners[0])
    expect(after.score).toBe(12)
    expect(after.perQuestion[2].outcome).toBe('correct')
  })
})
