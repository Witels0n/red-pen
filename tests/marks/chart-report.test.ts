import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { analyse } from '../../src/marks/core/analysis'
import { DEFAULT_SETTINGS } from '../../src/marks/core/settings'
import { bandScheme, summarise } from '../../src/marks/core/stats'
import { bandAxisPosition, bandChart, boxPlot, countAxis, type Mark } from '../../src/marks/chart/model'
import { buildReport } from '../../src/marks/report/pdf'

const caps = bandScheme('caps')

describe('chart model', () => {
  const s = summarise([10, 35, 35, 55, 65, 65, 65, 85], caps, 50)!

  it('draws a bar per band with marks, below-pass bands in their own role', () => {
    const chart = bandChart(s, caps, { width: 300, height: 200 })
    const bars = chart.marks.filter((m): m is Extract<Mark, { kind: 'rect' }> => m.kind === 'rect')
    expect(bars).toHaveLength(5) // empty bands draw no bar
    expect(bars.map((b) => b.role)).toEqual(['bar-below', 'bar-below', 'bar', 'bar', 'bar'])
    // Heights are proportional to the counts (3 in Level 5, 1 in Level 1).
    expect(bars[3].h / bars[0].h).toBeCloseTo(3)
    expect(chart.label).toContain('Level 5 (60-69%): 3 learners')
  })

  it('puts the pass mark line at the band boundary', () => {
    expect(bandAxisPosition(caps, 50)).toBeCloseTo(3 / 7)
    expect(bandAxisPosition(caps, 15)).toBeCloseTo(0.5 / 7)
    expect(bandAxisPosition(caps, 100)).toBe(1)
    const chart = bandChart(s, caps, { width: 300, height: 200 })
    const pass = chart.marks.find((m) => m.kind === 'line' && m.role === 'pass')
    expect(pass).toMatchObject({ dashed: true })
  })

  it('shares a scale across small multiples', () => {
    const a = bandChart(s, caps, { maxCount: 10 })
    const top = a.marks.filter((m) => m.kind === 'text' && m.role === 'muted').map((m) => (m as { text: string }).text)
    expect(top).toContain('10')
    expect(countAxis(3)).toEqual({ top: 3, step: 1 })
    expect(countAxis(17)).toEqual({ top: 20, step: 5 })
  })

  it('draws a box, median, whiskers and outlier dots per row', () => {
    const t = summarise([5, 50, 52, 54, 56, 58, 60, 99], caps, 50)!
    const chart = boxPlot(
      [
        { label: 'Test 1', summary: s },
        { label: 'Test 2', summary: t },
      ],
      50,
    )
    expect(chart.marks.filter((m) => m.kind === 'rect')).toHaveLength(2)
    expect(chart.marks.filter((m) => m.kind === 'circle')).toHaveLength(2)
    expect(chart.marks.filter((m) => m.role === 'median')).toHaveLength(2)
    expect(chart.label).toContain('Test 2: lowest 5%')
  })
})

describe('report', () => {
  const rows = [
    ['Name', 'Test 1 (40)', 'Test 2 (50)'],
    ...Array.from({ length: 24 }, (_, i) => [`Learner ${i + 1}`, String((i * 7) % 41), String((i * 11) % 51)]),
  ]

  it('fits on one A4 page without names', async () => {
    const a = analyse(rows, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    const bytes = await buildReport(a, { className: 'Grade 9B', subject: 'Maths', comments: 'x '.repeat(400) })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 })
  })

  it('adds a page of learners below the pass mark when asked', async () => {
    const a = analyse(rows, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    const doc = await PDFDocument.load(await buildReport(a, { includeNames: true }))
    expect(doc.getPageCount()).toBe(2)
  })

  it('still fits one page with many assessments (no band charts)', async () => {
    const many = rows.map((r, i) => [
      r[0],
      ...Array.from({ length: 12 }, (_, j) => (i === 0 ? `T${j + 1}` : String((i * (j + 3)) % 101))),
    ])
    const a = analyse(many, { headerRow: true, namesColumn: true }, [], DEFAULT_SETTINGS)
    const doc = await PDFDocument.load(await buildReport(a))
    expect(doc.getPageCount()).toBe(1)
  })
})
