import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { unzipSync } from 'fflate'
import { partFileName, planSplit, zipFileName } from '../src/split/plan'
import { describeRange, parseRanges } from '../src/split/ranges'
import { splitToZip } from '../src/split/split'

describe('parseRanges', () => {
  it('reads single pages and ranges separated by commas', () => {
    expect(parseRanges('1-3, 4-6, 7', 10)).toEqual({
      ok: true,
      ranges: [
        { start: 1, end: 3 },
        { start: 4, end: 6 },
        { start: 7, end: 7 },
      ],
    })
  })

  it('tolerates spaces, semicolons, a trailing comma and an en dash', () => {
    expect(parseRanges(' 2 - 3 ;5–6, ', 6)).toEqual({
      ok: true,
      ranges: [
        { start: 2, end: 3 },
        { start: 5, end: 6 },
      ],
    })
  })

  it('allows overlapping ranges', () => {
    expect(parseRanges('1-2, 2-3', 3).ok).toBe(true)
  })

  it('rejects empty input', () => {
    const r = parseRanges('  , ', 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least one/)
  })

  it.each(['abc', '1-', '-3', '1-2-3', '2.5', '1 2'])('rejects malformed "%s"', (text) => {
    const r = parseRanges(text, 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/is not a page or a range/)
  })

  it('rejects pages past the end and names the page count', () => {
    const r = parseRanges('1-3, 9-12', 10)
    expect(r).toEqual({ ok: false, error: '"9-12" goes past the end: this PDF has 10 pages.' })
    expect(parseRanges('2', 1)).toEqual({ ok: false, error: '"2" goes past the end: this PDF has only 1 page.' })
  })

  it('rejects page 0 and backwards ranges', () => {
    expect(parseRanges('0-2', 5)).toEqual({ ok: false, error: '"0-2": pages are numbered from 1.' })
    expect(parseRanges('5-3', 5)).toEqual({ ok: false, error: '"5-3" runs backwards. Write it as 3-5.' })
  })
})

describe('describeRange', () => {
  it('names one page or a run of pages', () => {
    expect(describeRange({ start: 7, end: 7 })).toBe('Page 7')
    expect(describeRange({ start: 4, end: 6 })).toBe('Pages 4-6')
  })
})

describe('planSplit', () => {
  it('makes one file per page', () => {
    const r = planSplit({ kind: 'each' }, 3, 'scan.pdf')
    expect(r).toEqual({
      ok: true,
      parts: [
        { start: 1, end: 1, fileName: 'scan-part-01.pdf' },
        { start: 2, end: 2, fileName: 'scan-part-02.pdf' },
        { start: 3, end: 3, fileName: 'scan-part-03.pdf' },
      ],
    })
  })

  it('makes a file every N pages, with a shorter last file when pages are left over', () => {
    const r = planSplit({ kind: 'every', size: 4 }, 10, 'Grade 8.PDF')
    expect(r.ok && r.parts).toEqual([
      { start: 1, end: 4, fileName: 'Grade 8-part-01.pdf' },
      { start: 5, end: 8, fileName: 'Grade 8-part-02.pdf' },
      { start: 9, end: 10, fileName: 'Grade 8-part-03.pdf' },
    ])
  })

  it('makes one file when N is at least the page count', () => {
    const r = planSplit({ kind: 'every', size: 50 }, 10, 'a.pdf')
    expect(r.ok && r.parts).toEqual([{ start: 1, end: 10, fileName: 'a-part-01.pdf' }])
  })

  it.each([0, -2, 1.5, NaN])('rejects %s pages per file', (size) => {
    const r = planSplit({ kind: 'every', size }, 10, 'a.pdf')
    expect(r).toEqual({ ok: false, error: 'Enter a whole number of pages per file, 1 or more.' })
  })

  it('uses custom ranges and passes on their errors', () => {
    const ok = planSplit({ kind: 'ranges', text: '1-3, 7' }, 8, 'a.pdf')
    expect(ok.ok && ok.parts.map((p) => [p.fileName, p.start, p.end])).toEqual([
      ['a-part-01.pdf', 1, 3],
      ['a-part-02.pdf', 7, 7],
    ])
    expect(planSplit({ kind: 'ranges', text: '9' }, 8, 'a.pdf').ok).toBe(false)
  })
})

describe('file names', () => {
  it('pads part numbers so the files sort in order', () => {
    expect(partFileName('a.pdf', 0, 9)).toBe('a-part-01.pdf')
    expect(partFileName('a.pdf', 4, 120)).toBe('a-part-005.pdf')
  })

  it('names the zip after the original', () => {
    expect(zipFileName('Class 8B.pdf')).toBe('Class 8B-split.zip')
  })
})

describe('splitToZip', () => {
  it('packs one PDF per part with the planned pages', async () => {
    const doc = await PDFDocument.create()
    for (let i = 1; i <= 5; i++) doc.addPage([100 + i, 200])
    const plan = planSplit({ kind: 'every', size: 2 }, 5, 'class.pdf')
    if (!plan.ok) throw new Error(plan.error)
    const files = unzipSync(await splitToZip(doc, plan.parts))
    expect(Object.keys(files)).toEqual(['class-part-01.pdf', 'class-part-02.pdf', 'class-part-03.pdf'])
    const widths = await Promise.all(
      Object.values(files).map(async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth())),
    )
    expect(widths).toEqual([[101, 102], [103, 104], [105]])
  })
})
