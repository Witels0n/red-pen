import { describe, expect, it } from 'vitest'
import { fromPageSpace } from '../src/shared/pdf/page-geometry'
import {
  boxToPixels,
  clientToFraction,
  displayRectToPdf,
  fractionToDisplay,
  moveRect,
  MIN_SIZE,
  pdfRectToPixels,
  rectFromDrag,
  renderScale,
  resizeRect,
} from '../src/redact/geometry'
import { boxesOnPage, createLayoutModel, parseLayout, redactedPages, type RedactionBox } from '../src/redact/model'
import { keyCsv, listOrder, planNames, shuffledOrder } from '../src/redact/names'

const box = (patch: Partial<RedactionBox> = {}): RedactionBox => ({
  id: 1,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.05,
  page: 1,
  everyPage: false,
  fill: 'black',
  label: false,
  ...patch,
})

describe('screen to page fractions', () => {
  const bounds = { left: 100, top: 50, width: 400, height: 800 }

  it('measures a pointer against the page overlay, kept on the page', () => {
    expect(clientToFraction(300, 250, bounds)).toEqual({ x: 0.5, y: 0.25 })
    expect(clientToFraction(0, 9999, bounds)).toEqual({ x: 0, y: 1 })
  })

  it('makes a box from a drag in any direction', () => {
    const r = rectFromDrag({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.1 })
    expect([r.x, r.y]).toEqual([0.2, 0.1])
    expect(r.w).toBeCloseTo(0.4)
    expect(r.h).toBeCloseTo(0.3)
    expect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 1.4, y: -1 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
  })

  it('moves a box but never off the page', () => {
    expect(moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.5, 0.1)).toEqual({ x: 0.6, y: 0.2, w: 0.2, h: 0.2 })
    expect(moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 5, -5)).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.2 })
  })

  it('resizes from a corner, keeping the opposite corner and a minimum size', () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 }
    const se = resizeRect(r, 'se', 0.1, 0.1)
    expect(se.x).toBe(0.2)
    expect(se.w).toBeCloseTo(0.5)
    expect(se.h).toBeCloseTo(0.3)
    const nw = resizeRect(r, 'nw', 1, 1)
    expect(nw.x + nw.w).toBeCloseTo(0.6)
    expect(nw.w).toBeCloseTo(MIN_SIZE)
    expect(nw.h).toBeCloseTo(MIN_SIZE)
  })
})

describe('displayed page to PDF space, with rotation', () => {
  it('flips y on an upright page', () => {
    const page = { x: 0, y: 0, width: 600, height: 800 }
    const d = fractionToDisplay({ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }, page, 0)
    expect(d).toEqual({ x: 60, y: 80, width: 300, height: 40 })
    expect(displayRectToPdf(page, 0, d)).toEqual({ x: 60, y: 680, width: 300, height: 40 })
  })

  it('handles a quarter turn and a visible box that does not start at 0,0', () => {
    const page = { x: 40, y: 30, width: 500, height: 800 }
    // Turned a quarter, the page shows 800 wide and 500 tall.
    const d = fractionToDisplay({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, page, 90)
    expect(d).toEqual({ x: 80, y: 50, width: 160, height: 100 })
    const pdf = displayRectToPdf(page, 90, d)
    expect(pdf).toEqual({ x: 90, y: 110, width: 100, height: 160 })
    expect(pdfRectToPixels(page, pdf, 2)).toEqual({ x: 100, y: 1120, width: 200, height: 320 })
    expect(boxToPixels({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, page, 90, 2)).toEqual({
      x: 100,
      y: 1120,
      width: 200,
      height: 320,
    })
  })

  it.each([0, 90, 180, 270, -90, 450])(
    'maps back to the same place on the displayed page at %i degrees',
    (rotation) => {
      const page = { x: 12, y: 20, width: 595, height: 842 }
      const d = fractionToDisplay({ x: 0.3, y: 0.6, w: 0.25, h: 0.1 }, page, rotation)
      const pdf = displayRectToPdf(page, rotation, d)
      expect(pdf.width * pdf.height).toBeCloseTo(d.width * d.height)
      const centre = fromPageSpace(page, rotation, pdf.x + pdf.width / 2, pdf.y + pdf.height / 2)
      expect(centre.x).toBeCloseTo(d.x + d.width / 2)
      expect(centre.y).toBeCloseTo(d.y + d.height / 2)
    },
  )

  it('rounds pixels outwards so nothing at the edge of a box survives', () => {
    const page = { x: 0, y: 0, width: 100, height: 100 }
    expect(pdfRectToPixels(page, { x: 10.2, y: 10.2, width: 5.1, height: 5.1 }, 1)).toEqual({
      x: 10,
      y: 84,
      width: 6,
      height: 6,
    })
  })

  it('renders at the chosen dpi unless the picture would be huge', () => {
    expect(renderScale({ x: 0, y: 0, width: 595, height: 842 }, 144)).toBe(2)
    const big = renderScale({ x: 0, y: 0, width: 3000, height: 2000 }, 300)
    expect(3000 * big).toBeCloseTo(5000)
  })
})

describe('layout', () => {
  it('finds the boxes and the pages to redact', () => {
    const boxes = [box({ id: 1, page: 1 }), box({ id: 2, page: 3 }), box({ id: 3, page: 9 })]
    expect(boxesOnPage(boxes, 3).map((b) => b.id)).toEqual([2])
    expect(redactedPages(boxes, 4)).toEqual([1, 3])
    const every = [...boxes, box({ id: 4, page: 2, everyPage: true })]
    expect(boxesOnPage(every, 2).map((b) => b.id)).toEqual([4])
    expect(redactedPages(every, 3)).toEqual([1, 2, 3])
  })

  it('undoes a whole drag in one step', () => {
    const model = createLayoutModel()
    const added = model.add({ x: 0, y: 0, w: 0.1, h: 0.1, page: 1, everyPage: false, fill: 'black', label: false })
    model.checkpoint()
    model.update(added.id, { x: 0.2 }, false)
    model.update(added.id, { x: 0.3 }, false)
    expect(model.get(added.id)?.x).toBe(0.3)
    model.undo()
    expect(model.get(added.id)?.x).toBe(0)
    model.redo()
    expect(model.get(added.id)?.x).toBe(0.3)
    model.undo()
    model.undo()
    expect(model.boxes()).toEqual([])
    expect(model.canUndo()).toBe(false)
  })

  it('reads a saved layout, dropping anything damaged', () => {
    expect(
      parseLayout([
        { x: 0.1, y: 0.1, w: 0.2, h: 0.1, page: 2, everyPage: true, fill: 'white', label: true },
        { x: 0.9, y: 0.1, w: 0.5, h: 0.1, page: 1 },
        { x: 'a' },
        null,
      ]),
    ).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.1, page: 2, everyPage: true, fill: 'white', label: true }])
    expect(parseLayout('nonsense')).toEqual([])
  })
})

describe('anonymised names', () => {
  const originals = ['Botha, Anna.pdf', 'Dlamini, Sipho.pdf', 'Naidoo, Priya.pdf']

  it('numbers files in list order, padded to two digits', () => {
    const plan = planNames(originals, { rename: true, prefix: 'Learner', start: 1, order: listOrder(3) })
    expect(plan.map((p) => p.output)).toEqual(['Learner 01.pdf', 'Learner 02.pdf', 'Learner 03.pdf'])
    expect(plan[1]).toEqual({ original: 'Dlamini, Sipho.pdf', label: 'Learner 02', output: 'Learner 02.pdf' })
  })

  it('gives out numbers in a shuffled order', () => {
    const plan = planNames(originals, { rename: true, prefix: 'Learner', start: 1, order: [2, 0, 1] })
    expect(plan.map((p) => p.label)).toEqual(['Learner 02', 'Learner 03', 'Learner 01'])
  })

  it('pads to the widest number and cleans the prefix', () => {
    const many = Array.from({ length: 120 }, (_, i) => `f${i}.pdf`)
    const plan = planNames(many, { rename: true, prefix: 'Sample/B', start: 1, order: listOrder(120) })
    expect(plan[0].output).toBe('Sample B 001.pdf')
    expect(planNames(['a.pdf'], { rename: true, prefix: '  ', start: 7, order: [0] })[0].output).toBe('Learner 07.pdf')
  })

  it('keeps the names, marked redacted, when not renaming', () => {
    const plan = planNames(['Test.pdf', 'test.pdf'], { rename: false, prefix: 'Learner', start: 1, order: [0, 1] })
    expect(plan.map((p) => p.output)).toEqual(['Test-redacted.pdf', 'test-redacted (2).pdf'])
    expect(plan[1].label).toBe('Learner 02')
  })

  it('ignores an order that is not a permutation of the files', () => {
    const plan = planNames(originals, { rename: true, prefix: 'Learner', start: 1, order: [0, 0, 1] })
    expect(plan.map((p) => p.label)).toEqual(['Learner 01', 'Learner 02', 'Learner 03'])
  })

  it('shuffles every file exactly once', () => {
    let seed = 0.37
    const random = () => (seed = (seed * 9301 + 0.49297) % 1)
    const order = shuffledOrder(30, random)
    expect([...order].sort((a, b) => a - b)).toEqual(listOrder(30))
    expect(order).not.toEqual(listOrder(30))
  })

  it('writes the key as CSV in number order, quoted where needed and safe to open in a spreadsheet', () => {
    const plan = planNames([...originals, '=cmd.pdf'], {
      rename: true,
      prefix: 'Learner',
      start: 1,
      order: [3, 1, 0, 2],
    })
    expect(keyCsv(plan)).toBe(
      [
        'Original file,Anonymised name,Anonymised file',
        "'=cmd.pdf,Learner 01,Learner 01.pdf",
        '"Dlamini, Sipho.pdf",Learner 02,Learner 02.pdf',
        '"Botha, Anna.pdf",Learner 03,Learner 03.pdf',
        '"Naidoo, Priya.pdf",Learner 04,Learner 04.pdf',
        '',
      ].join('\r\n'),
    )
  })
})
