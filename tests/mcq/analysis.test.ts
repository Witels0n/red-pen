import { describe, expect, it } from 'vitest'
import { classSummary, itemAnalysis, thirds, topicSummaries, topicsToRevise } from '../../src/mcq/core/analysis'
import { collate, markAll } from '../../src/mcq/core/marking'
import { withQuestion } from '../../src/mcq/core/model'
import type { Answer } from '../../src/shared/omr/types'
import { assessment, memoAnswers, pagesFor } from './fixtures'

/** A class of six on 4 questions (Memo A, B, C, D; Topics Fractions, Decimals, Fractions, Decimals). */
function sixLearners() {
  let a = assessment(4, 1)
  a = withQuestion(a, 1, { misconceptions: ['', '', 'Adds the denominators', ''] })
  const rows: Answer[][] = [
    // Q1 right for all but one; Q2 most choose C; Q4 the strong learners get wrong.
    [0, 1, 2, 2],
    [0, 1, 2, 2],
    [0, 2, 2, 3],
    [0, 2, 2, 3],
    [0, 2, null, 3],
    [1, 2, 'multiple', 3],
  ]
  const scans = rows.flatMap((r, i) => pagesFor(a, String(i + 1).padStart(2, '0'), 'A', r))
  const marks = markAll(a, collate({ ...a, scans }).learners)
  return { a, marks }
}

describe('item analysis', () => {
  const { a, marks } = sixLearners()
  const stats = itemAnalysis(a, marks)

  it('counts the percentage correct and the spread across options', () => {
    expect(stats.map((s) => s.pCorrect)).toEqual([5 / 6, 2 / 6, 4 / 6, 4 / 6])
    expect(stats[1].counts).toEqual([0, 2, 4, 0])
    expect(stats[2]).toMatchObject({ blank: 1, multiple: 1, counts: [0, 0, 4, 0], answered: 6 })
  })

  it('names the most-chosen wrong option with its misconception note', () => {
    expect(stats[1].topWrong).toEqual({ option: 2, count: 4, misconception: 'Adds the denominators' })
    expect(stats[0].topWrong).toEqual({ option: 1, count: 1, misconception: '' })
    expect(stats[2].topWrong).toBeUndefined()
  })

  it('splits the class into top and bottom thirds by total', () => {
    const { top, bottom } = thirds(marks)
    // Totals: 01 and 02 score 3, 03 and 04 score 3, 05 scores 2, 06 scores 1.
    expect(top.map((m) => m.learnerId)).toEqual(['01', '02'])
    expect(bottom.map((m) => m.learnerId)).toEqual(['05', '06'])
  })

  it('computes discrimination and flags questions the top third got wrong more often', () => {
    // Q4: top third (01, 02) both wrong, bottom third (05, 06) both right.
    expect(stats[3].discrimination).toBe(-1)
    expect(stats[3].flags).toContain('negative-discrimination')
    // Q2: top right, bottom wrong.
    expect(stats[1].discrimination).toBe(1)
    expect(stats[1].flags).not.toContain('negative-discrimination')
  })

  it('flags too easy (over 90%) and too hard (under 30%)', () => {
    const a = assessment(2, 1)
    const scans = Array.from({ length: 10 }, (_, i) =>
      pagesFor(a, String(i + 1).padStart(2, '0'), 'A', [0, i < 2 ? 1 : 0]),
    ).flat()
    const s = itemAnalysis(a, markAll(a, collate({ ...a, scans }).learners))
    expect(s[0].flags).toContain('too-easy')
    expect(s[1].pCorrect).toBe(0.2)
    expect(s[1].flags).toContain('too-hard')
  })

  it('does not judge discrimination with fewer than three learners', () => {
    const a = assessment(2, 1)
    const scans = pagesFor(a, '01', 'A', memoAnswers(a))
    expect(itemAnalysis(a, markAll(a, collate({ ...a, scans }).learners))[0].discrimination).toBeNull()
  })
})

describe('Topics', () => {
  const { a, marks } = sixLearners()

  it('adds up each learner per Topic', () => {
    expect(marks[0].topics).toEqual([
      { topic: 'Fractions', earned: 2, possible: 2 },
      { topic: 'Decimals', earned: 1, possible: 2 },
    ])
    expect(topicsToRevise(marks[5])).toEqual(['Fractions'])
    expect(topicsToRevise(marks[4])).toEqual([])
    expect(topicsToRevise(marks[0])).toEqual([])
  })

  it('summarises the class per Topic and lists who should revise it', () => {
    const [fractions, decimals] = topicSummaries(a, marks)
    expect(fractions).toMatchObject({ topic: 'Fractions', questions: [0, 2], possible: 2 })
    expect(fractions.classFraction).toBeCloseTo(9 / 12)
    expect(fractions.learnersToRevise).toEqual(['06'])
    expect(decimals.classFraction).toBeCloseTo(6 / 12)
    expect(decimals.learnersToRevise).toEqual([])
  })

  it('treats Topics case-insensitively', () => {
    const b = withQuestion(a, 2, { topic: 'fractions' })
    expect(topicSummaries(b, marks).map((t) => t.topic)).toEqual(['Fractions', 'Decimals'])
  })

  it('summarises the class', () => {
    expect(classSummary(marks)).toEqual({ learners: 6, mean: 15 / 24, median: 0.75, highest: 0.75, lowest: 0.25 })
  })
})
