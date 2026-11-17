import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import {
  bookletSheets,
  chooseLandscape,
  creepShift,
  cutLinesFor,
  DEFAULT_SETTINGS,
  describePair,
  fitInto,
  gridCells,
  gridFor,
  loadSettings,
  MM,
  paddedLength,
  paddedSequence,
  PAPER,
  planSheets,
  sanitiseSettings,
  STORAGE_KEY,
  type Settings,
  type SourcePage,
} from '../src/booklet/layout'
import { impose, sourcePages } from '../src/booklet/impose'

const A4: SourcePage = { width: 595.28, height: 841.89, rotation: 0 }
const a4s = (n: number) => Array.from({ length: n }, () => A4)
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

/** Fold a stack of booklet sheets and read the pages in order, as a reader would. */
function readFolded(sheets: ReturnType<typeof bookletSheets>): (number | null)[] {
  // Reading order: right half of each front from outside in, then the inner spread pages back out.
  const firstHalf: (number | null)[] = []
  const secondHalf: (number | null)[] = []
  for (const s of sheets) {
    firstHalf.push(s.front[1], s.back[0])
    secondHalf.unshift(s.back[1], s.front[0])
  }
  return [...firstHalf, ...secondHalf]
}

describe('booklet padding', () => {
  it('pads to a multiple of 4, at least 4', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 12, 13].map(paddedLength)).toEqual([4, 4, 4, 4, 8, 8, 12, 12, 16])
  })

  it('puts blanks at the end', () => {
    expect(paddedSequence(5)).toEqual([0, 1, 2, 3, 4, null, null, null])
    expect(paddedSequence(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('can keep the last page as the back cover', () => {
    expect(paddedSequence(6, true)).toEqual([0, 1, 2, 3, 4, null, null, 5])
    expect(paddedSequence(4, true)).toEqual([0, 1, 2, 3])
    expect(paddedSequence(1, true)).toEqual([0, null, null, null])
  })
})

describe('bookletSheets', () => {
  it('imposes 8 pages on 2 sheets', () => {
    expect(bookletSheets(8)).toEqual([
      { front: [7, 0], back: [1, 6] },
      { front: [5, 2], back: [3, 4] },
    ])
  })

  it('imposes 4 pages on 1 sheet', () => {
    expect(bookletSheets(4)).toEqual([{ front: [3, 0], back: [1, 2] }])
  })

  it('imposes a single page with three blanks', () => {
    expect(bookletSheets(1)).toEqual([{ front: [null, 0], back: [null, null] }])
  })

  it('pads 10 pages to 12 and places blanks at the end', () => {
    expect(bookletSheets(10)).toEqual([
      { front: [null, 0], back: [1, null] },
      { front: [9, 2], back: [3, 8] },
      { front: [7, 4], back: [5, 6] },
    ])
  })

  it('reads back in order once folded, for every length up to 64', () => {
    for (let n = 1; n <= 64; n++) {
      const sheets = bookletSheets(n)
      expect(sheets.length).toBe(paddedLength(n) / 4)
      expect(readFolded(sheets)).toEqual(paddedSequence(n))
      const used = sheets.flatMap((s) => [...s.front, ...s.back]).filter((p) => p !== null)
      expect([...used].sort((a, b) => a! - b!)).toEqual(Array.from({ length: n }, (_, i) => i))
    }
  })

  it('keeps the back cover on the outside sheet', () => {
    const [outer] = bookletSheets(6, true)
    expect(outer.front).toEqual([5, 0])
  })

  it('labels pairs for the sheet order list', () => {
    expect(describePair([7, 0])).toBe('8 | 1')
    expect(describePair([null, 0])).toBe('blank | 1')
  })
})

describe('grids', () => {
  it('chooses columns and rows for each count', () => {
    expect(gridFor(2, true)).toEqual({ cols: 2, rows: 1 })
    expect(gridFor(2, false)).toEqual({ cols: 1, rows: 2 })
    expect(gridFor(4, false)).toEqual({ cols: 2, rows: 2 })
    expect(gridFor(6, false)).toEqual({ cols: 2, rows: 3 })
    expect(gridFor(6, true)).toEqual({ cols: 3, rows: 2 })
    expect(gridFor(9, true)).toEqual({ cols: 3, rows: 3 })
    expect(() => gridFor(5, true)).toThrow()
  })

  it('orders cells across then down, inside the margin, with gaps', () => {
    const cells = gridCells({ width: 200, height: 300 }, { cols: 2, rows: 3 }, 10, 4)
    expect(cells).toHaveLength(6)
    // Width: (200 - 20 - 4) / 2 = 88. Height: (300 - 20 - 8) / 3 = 90.67.
    expect(cells[0].x).toBe(10)
    expect(cells[1].x).toBe(10 + 88 + 4)
    expect(cells[0].y).toBeCloseTo(300 - 10 - 272 / 3)
    expect(cells[2].x).toBe(10) // second row starts at the left again
    expect(cells[2].y).toBeLessThan(cells[0].y)
    expect(cells[5].y).toBeCloseTo(10)
    expect(cells[5].x + cells[5].width).toBeCloseTo(190)
  })

  it('puts cut lines in the middle of the gaps', () => {
    const sheet = { width: 200, height: 300 }
    const cells = gridCells(sheet, { cols: 2, rows: 2 }, 10, 10)
    const lines = cutLinesFor(sheet, cells, 2, 2)
    expect(lines).toEqual([
      { x1: 100, y1: 0, x2: 100, y2: 300 },
      { x1: 0, y1: 150, x2: 200, y2: 150 },
    ])
  })

  it('picks the orientation that shows pages largest', () => {
    expect(chooseLandscape('auto', 2, 'A4', A4, 0, 0)).toBe(true)
    expect(chooseLandscape('auto', 4, 'A4', A4, 0, 0)).toBe(false)
    expect(chooseLandscape('auto', 6, 'A4', A4, 0, 0)).toBe(true)
    expect(chooseLandscape('auto', 2, 'A4', { ...A4, rotation: 90 }, 0, 0)).toBe(false)
    expect(chooseLandscape('portrait', 2, 'A4', A4, 0, 0)).toBe(false)
  })
})

describe('fitInto', () => {
  const cell = { x: 100, y: 50, width: 200, height: 200 }
  const page: SourcePage = { width: 100, height: 200, rotation: 0 }

  it('scales to fit and centres', () => {
    const p = fitInto(cell, page)
    expect(p.scale).toBe(1)
    expect(p.box).toEqual({ x: 150, y: 50, width: 100, height: 200 })
    expect([p.x, p.y, p.rotation]).toEqual([150, 50, 0])
  })

  it('moves the origin so a rotated page lands in the cell', () => {
    // Shown 200 wide and 100 tall; scale 1, centred vertically.
    const r90 = fitInto(cell, { ...page, rotation: 90 })
    expect(r90.box).toEqual({ x: 100, y: 100, width: 200, height: 100 })
    expect([r90.x, r90.y]).toEqual([100, 200])
    const r180 = fitInto(cell, { ...page, rotation: 180 })
    expect([r180.x, r180.y]).toEqual([250, 250])
    const r270 = fitInto(cell, { ...page, rotation: 270 })
    expect([r270.x, r270.y]).toEqual([300, 100])
  })

  it('adds a turn to the page rotation', () => {
    expect(fitInto(cell, { ...page, rotation: 270 }, 180).rotation).toBe(90)
  })

  it('shifts sideways for creep', () => {
    expect(fitInto(cell, page, 0, 5).box.x).toBe(155)
  })
})

describe('planSheets', () => {
  it('booklet: two output pages per sheet, A4 landscape, halves meeting at the fold', () => {
    const out = planSheets(settings({ marginMm: 0 }), a4s(8))
    expect(out.map((s) => s.label)).toEqual(['Sheet 1, front', 'Sheet 1, back', 'Sheet 2, front', 'Sheet 2, back'])
    expect(out[0].width).toBeCloseTo(PAPER.A4.height)
    expect(out[0].slots.map((s) => s.source)).toEqual([7, 0])
    expect(out[1].slots.map((s) => s.source)).toEqual([1, 6])
    expect(out[0].slots[0].cell.x + out[0].slots[0].cell.width).toBeCloseTo(out[0].slots[1].cell.x)
    // An A4 page fills an A5 half exactly.
    const fit = fitInto(out[0].slots[1].cell, A4)
    expect(fit.scale).toBeCloseTo(Math.SQRT1_2, 3)
  })

  it('booklet: long-edge flip turns the backs upside down and swaps the halves', () => {
    const out = planSheets(settings({ flip: 'long', marginMm: 0 }), a4s(4))
    const back = out[1]
    expect(back.slots.map((s) => [s.source, s.turn])).toEqual([
      [1, 180],
      [2, 180],
    ])
    // Page 2 (index 1) is drawn on the right half, upside down.
    expect(back.slots[0].cell.x).toBeCloseTo(back.width / 2)
    expect(out[0].slots.every((s) => s.turn === 0)).toBe(true)
  })

  it('booklet: creep moves inner sheets towards the fold', () => {
    const out = planSheets(settings({ creepMm: 0.2 }), a4s(12))
    expect(out[0].slots.map((s) => s.shiftX)).toEqual([0, -0])
    expect(out[4].slots[0].shiftX).toBeCloseTo(2 * 0.2 * MM)
    expect(out[4].slots[1].shiftX).toBeCloseTo(-2 * 0.2 * MM)
    expect(creepShift(3, 0)).toBe(0)
  })

  it('booklet: A3 sheets make an A4 booklet', () => {
    const out = planSheets(settings({ sheet: 'A3', marginMm: 0 }), a4s(4))
    expect(fitInto(out[0].slots[0].cell, A4).scale).toBeCloseTo(1, 3)
  })

  it('n-up: fills sheets across then down and leaves the rest of the last sheet empty', () => {
    const out = planSheets(settings({ mode: 'nup', nup: 4 }), a4s(6))
    expect(out).toHaveLength(2)
    expect(out[0].slots.map((s) => s.source)).toEqual([0, 1, 2, 3])
    expect(out[1].slots.map((s) => s.source)).toEqual([4, 5, null, null])
    expect(out[0].width).toBeCloseTo(PAPER.A4.width) // auto: portrait for 4-up
    expect(out[0].cutLines).toEqual([])
  })

  it('n-up: 2 per sheet goes landscape, 9 per sheet gives 3 sheets for 19 pages', () => {
    const two = planSheets(settings({ mode: 'nup', nup: 2 }), a4s(3))
    expect(two[0].width).toBeCloseTo(PAPER.A4.height)
    expect(two).toHaveLength(2)
    expect(planSheets(settings({ mode: 'nup', nup: 9 }), a4s(19))).toHaveLength(3)
  })

  it('n-up: borders around each placed page only', () => {
    const out = planSheets(settings({ mode: 'nup', nup: 4, borders: true }), a4s(3))
    expect(out[0].borders).toHaveLength(3)
  })

  it('repeat: one sheet per page with copies of it and cut lines', () => {
    const out = planSheets(settings({ mode: 'repeat', repeat: 4 }), a4s(2))
    expect(out).toHaveLength(2)
    expect(out[1].slots.map((s) => s.source)).toEqual([1, 1, 1, 1])
    expect(out[0].cutLines).toHaveLength(2)
    expect(planSheets(settings({ mode: 'repeat', repeat: 2, cutLines: false }), a4s(1))[0].cutLines).toEqual([])
  })

  it('has nothing to plan for no pages', () => {
    expect(planSheets(DEFAULT_SETTINGS, [])).toEqual([])
  })
})

describe('settings', () => {
  it('fills in defaults and clamps', () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = sanitiseSettings({ mode: 'nup', nup: 5, marginMm: 99, creepMm: -1, borders: 'yes' })
    expect(s.mode).toBe('nup')
    expect(s.nup).toBe(DEFAULT_SETTINGS.nup)
    expect(s.marginMm).toBe(30)
    expect(s.creepMm).toBe(0)
    expect(s.borders).toBe(false)
  })

  it('survives broken or blocked storage', () => {
    expect(loadSettings({ getItem: () => '{not json' })).toEqual(DEFAULT_SETTINGS)
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings({ getItem: (k) => (k === STORAGE_KEY ? '{"mode":"repeat"}' : null) }).mode).toBe('repeat')
  })
})

describe('impose', () => {
  async function source(n: number, rotate = 0): Promise<PDFDocument> {
    const doc = await PDFDocument.create()
    for (let i = 0; i < n; i++) {
      const p = doc.addPage([595.28, 841.89])
      p.drawText(`Page ${i + 1}`, { x: 50, y: 700 })
      if (rotate) p.setRotation(degrees(rotate))
    }
    return doc
  }

  it('builds a vector booklet with one PDF page per sheet side', async () => {
    const { bytes, sheets } = await impose(await source(6), DEFAULT_SETTINGS)
    expect(sheets).toHaveLength(4)
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(4)
    expect(out.getPage(0).getWidth()).toBeCloseTo(841.89)
  })

  it('builds only the first sheets for a preview', async () => {
    const { bytes, sheets } = await impose(await source(9), settings({ mode: 'nup', nup: 2 }), 2)
    expect(sheets).toHaveLength(5)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
  })

  it('treats a page with no content as blank', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const { bytes } = await impose(doc, DEFAULT_SETTINGS)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
  })

  it('reads stored rotation from the source', async () => {
    expect(sourcePages(await source(1, 90))[0].rotation).toBe(90)
    expect(sourcePages(await source(1, -90))[0].rotation).toBe(270)
  })
})
