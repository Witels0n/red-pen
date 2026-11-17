import { describe, expect, it } from 'vitest'
import { comparisonInsights, singleInsights, tenBins, twoGroups, type InsightKind } from '../../src/marks/core/insights'
import { bandScheme, summarise } from '../../src/marks/core/stats'

const caps = bandScheme('caps')

function kinds(percents: number[], passMark = 50, absent = 0): InsightKind[] {
  return singleInsights(summarise(percents, caps, passMark, absent)!, percents, caps).map((i) => i.kind)
}

function textOf(percents: number[], kind: InsightKind): string | undefined {
  return singleInsights(summarise(percents, caps, 50)!, percents, caps).find((i) => i.kind === kind)?.text
}

describe('singleInsights', () => {
  it('always gives the pass rate first', () => {
    expect(textOf([40, 50, 60, 70], 'pass-rate')).toBe('3 of 4 learners (75.0%) reached the pass mark of 50%.')
  })

  it('spread: tight under 10, typical 10 to 18, wide over 18', () => {
    expect(textOf([50, 52, 54, 56, 58, 60], 'spread')).toMatch(/close together/)
    expect(textOf([35, 45, 55, 65, 75, 60], 'spread')).toMatch(/typical/)
    expect(textOf([10, 30, 50, 70, 90, 95], 'spread')).toMatch(/spread widely/)
  })

  it('skew when the mean and median are 5 or more apart', () => {
    expect(textOf([5, 10, 60, 62, 64, 66, 68], 'skew')).toMatch(/pulling it down/)
    expect(textOf([40, 42, 44, 46, 95, 98, 99], 'skew')).toMatch(/pulling it up/)
    expect(kinds([40, 45, 50, 55, 60])).not.toContain('skew')
  })

  it('two groups needs 15 marks and two clear peaks', () => {
    const groups = [21, 22, 23, 24, 25, 26, 27, 28, 71, 72, 73, 74, 75, 76, 77]
    expect(twoGroups(groups)).toEqual([2, 7])
    expect(kinds(groups)).toContain('two-groups')
    expect(twoGroups(groups.slice(1))).toBeNull() // 14 marks
    const one = [41, 42, 43, 44, 45, 51, 52, 53, 54, 55, 61, 62, 63, 64, 65]
    expect(twoGroups(one)).toBeNull()
  })

  it('ceiling and floor when over 30% are in the top or bottom band', () => {
    expect(kinds([85, 90, 95, 60, 55, 50])).toContain('ceiling')
    expect(kinds([85, 90, 60, 55, 50, 45, 66])).not.toContain('ceiling')
    expect(kinds([10, 20, 25, 60, 55, 50])).toContain('floor')
  })

  it('mentions absentees only when there are some', () => {
    expect(kinds([40, 50, 60, 70, 80], 50, 2)).toContain('absent')
    expect(kinds([40, 50, 60, 70, 80], 50, 0)).not.toContain('absent')
  })

  it('hides spread, skew and two groups with fewer than 5 marks', () => {
    const k = kinds([10, 50, 90, 95])
    expect(k).toContain('few')
    expect(k).not.toContain('spread')
    expect(k).not.toContain('skew')
  })

  it('says so when every learner got the same mark', () => {
    expect(kinds([60, 60, 60, 60, 60, 60])).toContain('same')
    expect(kinds([60, 60, 60, 60, 60, 60])).not.toContain('spread')
  })
})

describe('comparisonInsights', () => {
  const s = (values: number[]) => summarise(values, caps, 50)!
  it('mean and spread changes of 5 or more between consecutive assessments', () => {
    const out = comparisonInsights([
      { name: 'Test 1', summary: s([50, 52, 54, 56, 58]) },
      { name: 'Test 2', summary: s([20, 40, 60, 80, 100]) },
      { name: 'Test 3', summary: s([22, 42, 62, 82, 99]) },
    ])
    expect(out.map((i) => i.kind)).toEqual(['mean-change', 'spread-change'])
    expect(out[0].text).toBe('The average rose from 54.0% in Test 1 to 60.0% in Test 2.')
  })

  it('stays quiet about small changes', () => {
    expect(
      comparisonInsights([
        { name: 'A', summary: s([50, 60]) },
        { name: 'B', summary: s([52, 63]) },
      ]),
    ).toEqual([])
  })
})

describe('tenBins', () => {
  it('puts 100 in the top bin', () => {
    expect(tenBins([0, 9.9, 10, 100])).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 1])
  })
})
