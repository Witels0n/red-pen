import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { combinePdfs } from '../src/combine/combine'
import { moveItem } from '../src/shared/pdf/list-order'
import { parsePdf, PdfOpenError } from '../src/shared/pdf/open-pdf'

async function pdfWithWidths(...widths: number[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 300])
  return doc
}

describe('combinePdfs', () => {
  it('puts every page of each PDF in the order given', async () => {
    const a = await pdfWithWidths(101, 102)
    const b = await pdfWithWidths(201)
    const c = await pdfWithWidths(301, 302, 303)
    const order = moveItem([a, b, c], 2, 0) // the teacher dragged the last file to the top
    const out = await PDFDocument.load(await combinePdfs(order))
    expect(out.getPages().map((p) => p.getWidth())).toEqual([301, 302, 303, 101, 102, 201])
  })
})

describe('moveItem', () => {
  it('moves an item and clamps the target to the list', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('parsePdf', () => {
  it('opens a PDF and counts its pages', async () => {
    const bytes = await (await pdfWithWidths(100, 100, 100)).save()
    const opened = await parsePdf('three.pdf', bytes)
    expect(opened.pageCount).toBe(3)
  })

  it('refuses a file that is not a PDF', async () => {
    await expect(parsePdf('notes.txt', new TextEncoder().encode('hello'))).rejects.toThrow(
      new PdfOpenError('"notes.txt" is not a PDF file.'),
    )
  })

  it('refuses a damaged PDF', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nthis is not really a PDF\n%%EOF')
    await expect(parsePdf('broken.pdf', bytes)).rejects.toThrow(
      '"broken.pdf" could not be opened: it appears to be damaged.',
    )
  })

  it('refuses a password-protected PDF', async () => {
    const doc = await pdfWithWidths(100)
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2, R: 3 })
    await expect(parsePdf('locked.pdf', await doc.save())).rejects.toThrow(
      '"locked.pdf" could not be opened: it is password protected.',
    )
  })
})
