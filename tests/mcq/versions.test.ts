import { describe, expect, it } from 'vitest'
import { withOptionCount, withQuestionCount } from '../../src/mcq/core/model'
import {
  planFor,
  plansFit,
  planVersions,
  printedMemo,
  refreshVersions,
  seededRandom,
  shuffled,
  toOriginal,
  toPrinted,
  withVersionSettings,
} from '../../src/mcq/core/versions'
import { assessment } from './fixtures'

const isPermutation = (xs: number[], n: number) => [...xs].sort((a, b) => a - b).join() === [...Array(n).keys()].join()

describe('seeded shuffle', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const items = [...Array(20).keys()]
    expect(shuffled(items, seededRandom(7))).toEqual(shuffled(items, seededRandom(7)))
    expect(shuffled(items, seededRandom(7))).not.toEqual(shuffled(items, seededRandom(8)))
    expect(isPermutation(shuffled(items, seededRandom(7)), 20)).toBe(true)
  })
})

describe('planVersions', () => {
  const a = assessment(30, 4)

  it('keeps Version A in the original order and shuffles the others', () => {
    const [A, B, C, D] = a.versions.plans
    expect(A.version).toBe('A')
    expect(A.questionOrder).toEqual([...Array(30).keys()])
    expect(A.optionOrder.every((o) => o.join() === '0,1,2,3')).toBe(true)
    for (const p of [B, C, D]) {
      expect(isPermutation(p.questionOrder, 30)).toBe(true)
      expect(p.questionOrder).not.toEqual(A.questionOrder)
      p.optionOrder.forEach((o) => expect(isPermutation(o, 4)).toBe(true))
    }
    expect([B, C, D].map((p) => p.version)).toEqual(['B', 'C', 'D'])
  })

  it('gives the same plans for the same seed (so a reprint matches)', () => {
    expect(planVersions(a.questions, a.versions)).toEqual(a.versions.plans)
  })

  it('does not change Version B when Version C is added', () => {
    const two = assessment(30, 2)
    const three = withVersionSettings(two, { count: 3 })
    expect(three.versions.plans[1]).toEqual(two.versions.plans[1])
  })

  it('shuffles only what is asked', () => {
    const onlyQuestions = withVersionSettings(a, { shuffleOptions: false })
    expect(onlyQuestions.versions.plans[1].optionOrder.every((o) => o.join() === '0,1,2,3')).toBe(true)
    const onlyOptions = withVersionSettings(a, { shuffleQuestions: false })
    expect(onlyOptions.versions.plans[1].questionOrder).toEqual([...Array(30).keys()])
  })

  it('maps every printed answer back to the original question and option, and back again', () => {
    for (const plan of a.versions.plans) {
      plan.questionOrder.forEach((_, position) => {
        for (let k = 0; k < 4; k++) {
          const o = toOriginal(plan, position, k)
          expect(toPrinted(plan, o.question, o.option)).toEqual({ position, option: k })
        }
      })
    }
  })

  it('prints the Memo in each Version as the letter where the right option landed', () => {
    const plan = planFor(a, 'C')!
    printedMemo(a, plan).forEach((k, position) => {
      expect(toOriginal(plan, position, k!).option).toBe(a.questions[plan.questionOrder[position]].answer)
    })
  })

  it('re-plans only when the questions no longer fit the stored plans', () => {
    expect(plansFit(a)).toBe(true)
    expect(refreshVersions(a)).toBe(a)
    const fewer = withQuestionCount(a, 20)
    expect(plansFit(fewer)).toBe(false)
    expect(refreshVersions(fewer).versions.plans[1].questionOrder).toHaveLength(20)
    const fiveOptions = { ...a, questions: a.questions.map((q, i) => (i === 3 ? withOptionCount(q, 5) : q)) }
    expect(plansFit(fiveOptions)).toBe(false)
    const refreshed = refreshVersions(fiveOptions)
    expect(plansFit(refreshed)).toBe(true)
  })
})
