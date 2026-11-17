import { describe, expect, it } from 'vitest'
import { degrees, PDFDocument } from 'pdf-lib'
import { organisePdf } from '../src/organise/organise'
import {
  initialPages,
  movePage,
  normaliseRotation,
  removePage,
  rotateAll,
  rotatePage,
  savedRotation,
} from '../src/organise/page-order'

describe('page order and rotation model', () => {
  it('starts with every page in order, unturned', () => {
    expect(initialPages(3)).toEqual([
      { source: 0, turn: 0 },
      { source: 1, turn: 0 },
      { source: 2, turn: 0 },
    ])
  })

  it('turns one page right (clockwise) and left, wrapping round', () => {
    let pages = initialPages(2)
    pages = rotatePage(pages, 1, 'right')
    expect(pages[1].turn).toBe(90)
    pages = rotatePage(pages, 0, 'left')
    expect(pages[0].turn).toBe(270)
    for (let i = 0; i < 3; i++) pages = rotatePage(pages, 1, 'right')
    expect(pages[1].turn).toBe(0)
  })

  it('turns every page at once, keeping each page\'s own turn', () => {
    const pages = rotateAll(rotatePage(initialPages(2), 0, 'right'), 'right')
    expect(pages.map((p) => p.turn)).toEqual([180, 90])
  })

  it('removes and moves pages without changing the original', () => {
    const start = initialPages(4)
    expect(removePage(start, 1).map((p) => p.source)).toEqual([0, 2, 3])
    expect(movePage(start, 0, 3).map((p) => p.source)).toEqual([1, 2, 3, 0])
    expect(movePage(start, 3, 1).map((p) => p.source)).toEqual([0, 3, 1, 2])
    expect(movePage(start, 2, 99).map((p) => p.source)).toEqual([0, 1, 3, 2])
    expect(start.map((p) => p.source)).toEqual([0, 1, 2, 3])
  })

  it('adds the turn to the existing rotation', () => {
    expect(normaliseRotation(-90)).toBe(270)
    expect(normaliseRotation(450)).toBe(90)
    expect(savedRotation(90, 270)).toBe(0)
    expect(savedRotation(180, 90)).toBe(270)
  })
})

describe('organisePdf', () => {
  it('keeps the chosen pages in order and stores rotation in the PDF, added to existing rotation', async () => {
    const source = await PDFDocument.create()
    for (let i = 1; i <= 4; i++) source.addPage([100 * i, 500])
    source.getPage(2).setRotation(degrees(90))

    let pages = initialPages(4)
    pages = removePage(pages, 1) // drop the 200-wide page
    pages = movePage(pages, 2, 0) // the 400-wide page first
    pages = rotatePage(pages, 2, 'right') // the 300-wide page, already at 90
    pages = rotatePage(pages, 0, 'left')

    const out = await PDFDocument.load(await organisePdf(source, pages))
    expect(out.getPages().map((p) => p.getWidth())).toEqual([400, 100, 300])
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([270, 0, 180])
  })

  it('refuses to save a PDF with no pages', async () => {
    const source = await PDFDocument.create()
    source.addPage()
    await expect(organisePdf(source, [])).rejects.toThrow()
  })
})
