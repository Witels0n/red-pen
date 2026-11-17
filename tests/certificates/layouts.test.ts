import { describe, expect, it } from 'vitest'
import {
  A4,
  LABEL_PRESETS,
  MM,
  labelCells,
  layoutProblems,
  placeItems,
  presetLayout,
  sheetCount,
  slipCells,
  tentCards,
} from '../../src/certificates/layouts'

describe('label sheets', () => {
  it('every preset fits A4 without overlapping', () => {
    for (const p of LABEL_PRESETS) expect(layoutProblems(p.layout), p.id).toEqual([])
  })

  it('places a 3 x 7 sheet across then down, in points from the top left', () => {
    const cells = labelCells(presetLayout('3x7')!)
    expect(cells).toHaveLength(21)
    expect(cells[0].x).toBeCloseTo(7.2 * MM)
    expect(cells[0].y).toBeCloseTo(15.15 * MM)
    expect(cells[1].x - cells[0].x).toBeCloseTo(66 * MM) // next label across
    expect(cells[3].y - cells[0].y).toBeCloseTo(38.1 * MM) // first label of row 2
    expect(cells[3].x).toBeCloseTo(cells[0].x)
    expect(cells[0].width).toBeCloseTo(63.5 * MM)
    const last = cells[20]
    expect(last.x + last.width).toBeLessThanOrEqual(A4.width)
    expect(last.y + last.height).toBeLessThanOrEqual(A4.height)
  })

  it('has the counts its name promises', () => {
    expect(labelCells(presetLayout('2x7')!)).toHaveLength(14)
    expect(labelCells(presetLayout('3x8')!)).toHaveLength(24)
  })

  it('reports labels that overlap or run off the sheet', () => {
    const l = presetLayout('3x7')!
    expect(layoutProblems({ ...l, pitchX: 60 })).toEqual([
      'The labels overlap across: the pitch across is less than the label width.',
    ])
    expect(layoutProblems({ ...l, columns: 4 })[0]).toMatch(/^The labels run 58\.7 mm off the right of the sheet\.$/)
    expect(layoutProblems({ ...l, rows: 8 })[0]).toMatch(/off the bottom of the sheet/)
    expect(layoutProblems({ ...l, columns: 0, width: 5 })).toEqual([
      'Columns must be a whole number from 1 to 20.',
      'Label width must be at least 10 mm.',
    ])
    // A single column or row may have any pitch: it is never used.
    expect(layoutProblems({ ...l, columns: 1, pitchX: 0 })).toEqual([])
  })

  it('skips labels already used on the first sheet only', () => {
    expect(placeItems(4, 21, 19)).toEqual([
      { page: 0, cell: 19 },
      { page: 0, cell: 20 },
      { page: 1, cell: 0 },
      { page: 1, cell: 1 },
    ])
    expect(sheetCount(21, 21)).toBe(1)
    expect(sheetCount(22, 21)).toBe(2)
    expect(sheetCount(2, 21, 20)).toBe(2)
    expect(sheetCount(0, 21)).toBe(0)
    // Skipping a whole sheet or more is clamped to leave one label.
    expect(placeItems(1, 21, 50)).toEqual([{ page: 0, cell: 20 }])
  })
})

describe('desk cards and slips', () => {
  it('puts two folded cards on a sheet, each folding across its middle', () => {
    const [a, b] = tentCards()
    expect(a.card.height).toBeCloseTo(A4.height / 2)
    expect(b.card.y).toBeCloseTo(A4.height / 2)
    expect(a.foldY).toBeCloseTo(A4.height / 4)
    expect(a.back.y + a.back.height).toBeCloseTo(a.foldY)
    expect(a.front.y).toBeCloseTo(a.foldY)
  })

  it('cuts a page into four slips', () => {
    const cells = slipCells()
    expect(cells).toHaveLength(4)
    expect(cells[3].y + cells[3].height).toBeCloseTo(A4.height)
  })
})
