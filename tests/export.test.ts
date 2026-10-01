import { PDFArray, PDFDocument, PDFRawStream, PDFStream, decodePDFRawStream, degrees, type PDFPage } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createMarkingModel } from '../src/marking-model'
import { exportMarkedPdf, markedFileName, toPageSpace } from '../src/export'

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842])
    page.drawRectangle({ x: 50, y: 700, width: 300, height: 80 })
  }
  return doc.save()
}

/** All content stream bytes of a page, concatenated. */
function contentOf(page: PDFPage): Uint8Array {
  const contents = page.node.Contents()
  const streams: PDFStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(page.doc.context.lookup(contents.get(i), PDFStream))
  } else if (contents) {
    streams.push(contents as PDFStream)
  }
  const parts = streams.map((s) => decodePDFRawStream(s as PDFRawStream).decode())
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

describe('exportMarkedPdf', () => {
  it('keeps the page count, adds red vector content to annotated pages only', async () => {
    const original = await fixture()
    const model = createMarkingModel()
    model.placeTick(1, 100, 100)
    model.placeTick(1, 200, 150)
    model.placeTick(3, 300, 400)

    const marked = await exportMarkedPdf(original, model.getAnnotations())

    const before = await PDFDocument.load(original)
    const after = await PDFDocument.load(marked)
    expect(after.getPageCount()).toBe(3)
    const pages = [0, 1, 2].map((i) => [before.getPage(i), after.getPage(i)] as const)
    expect(contentOf(pages[0][1]).length).toBeGreaterThan(contentOf(pages[0][0]).length)
    expect(contentOf(pages[2][1]).length).toBeGreaterThan(contentOf(pages[2][0]).length)
    expect(text(contentOf(pages[0][1]))).toMatch(/0.85 0.1 0.1 RG/) // red stroke
    expect(contentOf(pages[1][1])).toEqual(contentOf(pages[1][0])) // unannotated page untouched
    expect(after.getPage(0).getSize()).toEqual(before.getPage(0).getSize())
  })

  it('draws a Cross as red vector strokes on its page only', async () => {
    const original = await fixture()
    const model = createMarkingModel()
    model.placeCross(2, 100, 100)

    const marked = await exportMarkedPdf(original, model.getAnnotations())

    const before = await PDFDocument.load(original)
    const after = await PDFDocument.load(marked)
    expect(after.getPageCount()).toBe(3)
    expect(contentOf(after.getPage(1)).length).toBeGreaterThan(contentOf(before.getPage(1)).length)
    expect(text(contentOf(after.getPage(1)))).toMatch(/0.85 0.1 0.1 RG/)
    expect(contentOf(after.getPage(0))).toEqual(contentOf(before.getPage(0)))
  })

  it('draws Subtotals, the Total and Text notes in red with text, on their pages only', async () => {
    const original = await fixture()
    const model = createMarkingModel()
    model.placeTick(1, 100, 100)
    model.placeSubtotal(1, 20, 120)
    model.placeTotal(2, 100, 100, 40)
    model.placeText(2, 100, 200, 'units ✓ -1')

    const marked = await exportMarkedPdf(original, model.getAnnotations())

    const before = await PDFDocument.load(original)
    const after = await PDFDocument.load(marked)
    expect(after.getPageCount()).toBe(3)
    for (const i of [0, 1]) {
      expect(contentOf(after.getPage(i)).length).toBeGreaterThan(contentOf(before.getPage(i)).length)
      expect(text(contentOf(after.getPage(i)))).toMatch(/Tj/)
      expect(text(contentOf(after.getPage(i)))).toMatch(/0.85 0.1 0.1 rg/)
    }
    expect(contentOf(after.getPage(2))).toEqual(contentOf(before.getPage(2)))
  })

  it('with no annotations still returns a valid PDF with the same pages', async () => {
    const marked = await exportMarkedPdf(await fixture(), [])
    expect((await PDFDocument.load(marked)).getPageCount()).toBe(3)
  })

  it('does not alter the original bytes', async () => {
    const original = await fixture()
    const copy = original.slice()
    await exportMarkedPdf(original, createMarkingModel().getAnnotations())
    expect(original).toEqual(copy)
  })

  it('ignores annotations on pages the Test does not have', async () => {
    const model = createMarkingModel()
    model.placeTick(9, 10, 10)
    const marked = await exportMarkedPdf(await fixture(), model.getAnnotations())
    expect((await PDFDocument.load(marked)).getPageCount()).toBe(3)
  })

  it('works on a rotated page with an offset MediaBox', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 600])
    page.setMediaBox(50, 70, 400, 600)
    page.setRotation(degrees(90))
    const model = createMarkingModel()
    model.placeTick(1, 20, 20)
    const marked = await exportMarkedPdf(await doc.save(), model.getAnnotations())
    expect((await PDFDocument.load(marked)).getPageCount()).toBe(1)
  })
})

describe('toPageSpace (top-left page units to PDF user space)', () => {
  const box = { x: 50, y: 70, width: 400, height: 600 }

  it('rotation 0: offsets by the box origin and flips y', () => {
    expect(toPageSpace(box, 0, 10, 20)).toEqual({ x: 60, y: 650 })
  })

  it('rotation 90 (clockwise): displayed top-left is the box bottom-left', () => {
    expect(toPageSpace(box, 90, 0, 0)).toEqual({ x: 50, y: 70 })
    // Moving right on screen moves up in user space.
    expect(toPageSpace(box, 90, 10, 0)).toEqual({ x: 50, y: 80 })
    expect(toPageSpace(box, 90, 0, 10)).toEqual({ x: 60, y: 70 })
  })

  it('rotation 180: displayed top-left is the box top-right', () => {
    expect(toPageSpace(box, 180, 0, 0)).toEqual({ x: 450, y: 70 })
    expect(toPageSpace(box, 180, 10, 10)).toEqual({ x: 440, y: 80 })
  })

  it('rotation 270: displayed top-left is the box top-right', () => {
    expect(toPageSpace(box, 270, 0, 0)).toEqual({ x: 450, y: 670 })
    expect(toPageSpace(box, 270, 10, 0)).toEqual({ x: 450, y: 660 })
    expect(toPageSpace(box, 270, 0, 10)).toEqual({ x: 440, y: 670 })
  })
})


describe('markedFileName', () => {
  it('replaces the .pdf extension with -marked.pdf', () => {
    expect(markedFileName('learner-12.pdf')).toBe('learner-12-marked.pdf')
    expect(markedFileName('Learner 12.PDF')).toBe('Learner 12-marked.pdf')
  })

  it('appends -marked.pdf when there is no .pdf extension', () => {
    expect(markedFileName('scan')).toBe('scan-marked.pdf')
  })
})
