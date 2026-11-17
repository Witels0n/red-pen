import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assessmentFileName,
  assessmentFromFile,
  assessmentToFile,
  FILE_FORMAT,
} from '../../src/mcq/core/assessment-file'
import {
  deleteAssessment,
  getAssessment,
  indexedDbAssessments,
  listAssessments,
  memoryAssessments,
  saveAssessment,
  setAssessmentStorage,
  type AssessmentStorage,
} from '../../src/mcq/storage'
import { assessment, memoAnswers, pagesFor } from './fixtures'

function withResults() {
  const a = assessment(60, 3)
  const answers = memoAnswers(a)
  answers[4] = 'multiple'
  const scans = pagesFor(a, '03', 'C', answers)
  scans[0].decisions = { '7': 'blank', '8': 2 }
  scans[0].learnerConfirmed = true
  return { ...a, scans, print: { ...a.print, classId: 'class-1' } }
}

describe('Assessment file', () => {
  it('round-trips questions, Versions, print settings and results', () => {
    const a = withResults()
    const text = assessmentToFile(a, 'Grade 7B', new Date('2026-11-17T08:00:00Z'))
    const parsed = JSON.parse(text)
    expect(parsed).toMatchObject({
      format: FILE_FORMAT,
      schema: 2,
      exportedAt: '2026-11-17T08:00:00.000Z',
      className: 'Grade 7B',
    })
    const back = assessmentFromFile(text)
    expect(back).toEqual({ ok: true, assessment: a })
  })

  it('names the file after the title', () => {
    expect(assessmentFileName({ title: 'Term 3: fractions / decimals' })).toBe(
      'Term 3 fractions decimals assessment.json',
    )
  })

  it('refuses files that are not Assessment files', () => {
    expect(assessmentFromFile('not json')).toEqual({
      ok: false,
      problems: ['This is not an Assessment file: it is not valid JSON.'],
    })
    expect(assessmentFromFile('{"format":"something-else"}')).toEqual({
      ok: false,
      problems: ['This is not a Red Pen Assessment file.'],
    })
    const newer = assessmentFromFile(JSON.stringify({ format: FILE_FORMAT, schema: 3, assessment: {} }))
    expect(newer).toEqual({ ok: false, problems: [expect.stringContaining('newer version of Red Pen')] })
  })

  it('lists what is wrong in words, with question numbers', () => {
    const a = withResults()
    const file = JSON.parse(assessmentToFile(a))
    file.assessment.questions[2].answer = 7
    file.assessment.questions[4].options = ['only one']
    file.assessment.versions.plans[1].questionOrder[0] = file.assessment.versions.plans[1].questionOrder[1]
    file.assessment.print.mode = 'telepathy'
    file.assessment.scans[0].read.learnerId = 'Thandi'
    const result = assessmentFromFile(JSON.stringify(file))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toEqual([
      'This Assessment file has problems:',
      'Question 3: answer must be a whole number from 0 to 3.',
      'Question 5: options must have 2 to 5 items, not 1.',
      'versions.plans[1].questionOrder must list each of the 60 questions once.',
      'print.mode must be one of named-qr, id-qr, bubbled-id.',
      'Scanned page 1: read.learnerId must be a Learner ID of 1 to 4 digits.',
    ])
  })
})

describe.each([
  ['IndexedDB', () => indexedDbAssessments(new IDBFactory())],
  ['memory', () => memoryAssessments()],
])('assessment storage in %s', (_, make: () => AssessmentStorage) => {
  beforeEach(() => setAssessmentStorage(make()))

  it('saves, lists newest first, gets and deletes', async () => {
    const a = assessment(5)
    const b = { ...assessment(6), id: 'other' }
    await saveAssessment(a, 2000)
    await saveAssessment(b, 3000)
    expect((await listAssessments()).map((x) => x.id)).toEqual(['other', a.id])
    expect(await getAssessment(a.id)).toEqual({ ...a, updatedAt: 2000 })
    await deleteAssessment('other')
    expect(await listAssessments()).toHaveLength(1)
  })
})
