import { describe, expect, it } from 'vitest'
import { analyse, insightsFor, learnersCsv, shown, summaryCsv } from '../../src/marks/core/analysis'
import { changes, defaultPair, needsSupport, outlierLearners, topLearners } from '../../src/marks/core/compare'
import { handoffRows, parseHandoff } from '../../src/marks/core/handoff'
import { readColumn } from '../../src/marks/core/parse'
import { DEFAULT_SETTINGS } from '../../src/marks/core/settings'

const learners = {
  names: ['Thandi Mokoena', 'Sipho Dlamini', '', 'Ayesha Patel', 'Lerato Khumalo', 'Pieter van Wyk'],
  rowNumbers: [2, 3, 4, 5, 6, 7],
}

describe('learner lists', () => {
  const test1 = readColumn('Test 1', ['45', '80', '62', '80', '30', 'ABS'])
  const test2 = readColumn('Test 2', ['60', '70', '62', '85', 'ABS', '40'])

  it('needs support: everyone below the pass mark, lowest first', () => {
    expect(needsSupport(test1, 50, learners).map((l) => [l.label, l.value])).toEqual([
      ['Lerato Khumalo', 30],
      ['Thandi Mokoena', 45],
    ])
  })

  it('top learners break ties by row order and mark them joint', () => {
    const top = topLearners(test1, learners, 3)
    expect(top.map((l) => [l.label, l.joint])).toEqual([
      ['Sipho Dlamini', true],
      ['Ayesha Patel', true],
      ['Row 4', false],
    ])
  })

  it('improved and dropped only among learners with both marks', () => {
    const c = changes(test1, test2, learners)
    expect(c.improved.map((x) => [x.label, x.change])).toEqual([
      ['Thandi Mokoena', 15],
      ['Ayesha Patel', 5],
    ])
    expect(c.dropped.map((x) => [x.label, x.change])).toEqual([['Sipho Dlamini', -10]])
    expect(c.matched).toBe(4)
    expect(c.leftOut).toBe(2)
  })

  it('default pair: the last two that are not calculated', () => {
    expect(
      defaultPair([{ calculated: false }, { calculated: false }, { calculated: false }, { calculated: true }]),
    ).toEqual([1, 2])
    expect(defaultPair([{ calculated: false }, { calculated: true }])).toBeNull()
  })
})

describe('outlierLearners', () => {
  it('names the low and high outliers', () => {
    const rows = [['Name', 'Test'], ...[5, 50, 52, 54, 56, 58, 60, 99].map((v, i) => [`Learner ${i + 1}`, String(v)])]
    const a = analyse(rows, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    const [col] = shown(a)
    expect(outlierLearners(col.column, col.summary, a).map((o) => [o.label, o.side])).toEqual([
      ['Learner 1', 'low'],
      ['Learner 8', 'high'],
    ])
  })
})

describe('analyse', () => {
  const rows = [
    ['Name', 'Test 1 (40)', 'Test 2 (%)', 'Average'],
    ['Thandi Mokoena', '20', '60%', '55'],
    ['Sipho Dlamini', 'ABS', '70', '70'],
    ['Ayesha Patel', '30', 'oops', '75'],
  ]

  it('reads, summarises and leaves out excluded columns', () => {
    const a = analyse(
      rows,
      { headerRow: true, namesColumn: true },
      [undefined, undefined, { included: false }],
      DEFAULT_SETTINGS,
    )
    expect(a.columns.map((c) => c.column.name)).toEqual(['Test 1', 'Test 2', 'Average'])
    expect(a.columns[2].column.calculated).toBe(true)
    expect(shown(a).map((c) => c.column.name)).toEqual(['Test 1', 'Test 2'])
    expect(shown(a)[0].summary.mean).toBe(62.5)
    expect(shown(a)[1].summary.unreadable).toBe(1)
  })

  it('exports the summary and per-learner percentages as CSV', () => {
    const a = analyse(rows, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    const summary = summaryCsv(a).trim().split('\r\n')
    expect(summary[0]).toMatch(/^Assessment,Out of,Marks,Absent,Unreadable,Mean %/)
    expect(summary[1]).toMatch(/^Test 1,40,2,1,0,62.5,62.5,/)
    const per = learnersCsv(a).trim().split('\r\n')
    expect(per[0]).toBe('Row,Learner,Test 1 %,Test 2 %,Average %')
    expect(per[2]).toBe('3,Sipho Dlamini,ABS,70.0,70.0')
    expect(per[3]).toBe('4,Ayesha Patel,75.0,,75.0')
  })

  it('gives overview insights for several assessments', () => {
    const a = analyse(rows, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    expect(insightsFor(a).some((i) => i.text.startsWith('Pass rates'))).toBe(true)
  })
})

describe('MCQ hand-off', () => {
  it('turns handed-over percentages into rows, never rounding up', () => {
    const h = parseHandoff(
      JSON.stringify({ title: 'Fractions', learners: [{ name: 'Thandi Mokoena', percent: 29.996 }, { name: 'x' }] }),
    )!
    expect(handoffRows(h)).toEqual([
      ['Name', 'Fractions'],
      ['Thandi Mokoena', '29.99%'],
    ])
    expect(parseHandoff('not json')).toBeNull()
    expect(parseHandoff(null)).toBeNull()
  })
})
