import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  formatPageNumber,
  hexToRgb,
  placeSlot,
  placeWatermark,
  sanitiseSettings,
  selectPages,
  slotTexts,
  uniqueNames,
  watermarkFontSize,
  watermarkText,
  type StampSettings,
} from '../src/stamp/layout'
import { numbering, previewPage, stampPdf } from '../src/stamp/stamp'

const settings = (patch: Partial<StampSettings> = {}): StampSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...patch,
})

describe('formatPageNumber', () => {
  it('writes each style', () => {
    expect(formatPageNumber('n', 3, 9)).toBe('3')
    expect(formatPageNumber('page-n', 3, 9)).toBe('Page 3')
    expect(formatPageNumber('page-n-of', 3, 9)).toBe('Page 3 of 9')
    expect(formatPageNumber('n-of', 3, 9)).toBe('3/9')
  })
})

describe('selectPages', () => {
  it('chooses every, odd or even pages (counted from 1)', () => {
    expect(selectPages('all', '', 4)).toEqual({ ok: true, pages: [0, 1, 2, 3] })
    expect(selectPages('odd', '', 5)).toEqual({ ok: true, pages: [0, 2, 4] })
    expect(selectPages('even', '', 5)).toEqual({ ok: true, pages: [1, 3] })
  })

  it('reads custom ranges, ignoring pages past the end of a shorter PDF', () => {
    expect(selectPages('range', '2-4, 3, 9', 5)).toEqual({ ok: true, pages: [1, 2, 3] })
    expect(selectPages('range', '7-9', 5)).toEqual({ ok: true, pages: [] })
  })

  it('explains a range it cannot read', () => {
    const r = selectPages('range', 'four', 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('"four" is not a page or a range')
  })
})

describe('numbering', () => {
  it('counts only the stamped pages, from the start number', () => {
    const { numbers, total } = numbering(settings({ numbers: { ...DEFAULT_SETTINGS.numbers, start: 1 } }), [1, 2, 3])
    expect([...numbers]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
    expect(total).toBe(3)
    expect(numbering(settings({ numbers: { ...DEFAULT_SETTINGS.numbers, start: 5 } }), [0, 1]).total).toBe(6)
  })
})

describe('slotTexts', () => {
  const day = new Date(2026, 5, 3)
  it('gathers header, footer, date and page number, joining those that share a place', () => {
    const s = settings({
      header: { text: 'Sunnyside High', align: 'centre' },
      footer: { text: 'Grade 10 Term 2 Test', align: 'centre' },
      date: { slot: 'top-right', style: 'long' },
      numbers: { on: true, slot: 'bottom-centre', format: 'page-n-of', start: 1 },
    })
    expect(slotTexts(s, 2, 9, day)).toEqual({
      'top-centre': 'Sunnyside High',
      'top-right': '3 June 2026',
      'bottom-centre': 'Grade 10 Term 2 Test   |   Page 2 of 9',
    })
  })

  it('leaves out empty text and the number when it is off', () => {
    expect(slotTexts(settings({ header: { text: '   ', align: 'left' } }), null, 3, day)).toEqual({})
  })
})

describe('watermarkText', () => {
  it('uses the preset, or the teacher’s own words', () => {
    expect(watermarkText(DEFAULT_SETTINGS.watermark)).toBe('MEMO')
    expect(watermarkText({ ...DEFAULT_SETTINGS.watermark, preset: 'custom', custom: ' Moderation ' })).toBe(
      'Moderation',
    )
    expect(watermarkText({ ...DEFAULT_SETTINGS.watermark, on: false })).toBe('')
  })
})

describe('placement', () => {
  const page = { width: 600, height: 800 }

  it('puts slot text at the edges, clear of the margin and a logo', () => {
    expect(placeSlot('bottom-left', page, 100, 7, 20)).toEqual({ x: 20, y: 780, angle: 0 })
    expect(placeSlot('bottom-right', page, 100, 7, 20)).toEqual({ x: 480, y: 780, angle: 0 })
    expect(placeSlot('top-centre', page, 100, 7, 20).x).toBe(250)
    const beside = placeSlot('top-left', page, 100, 8, 20, { insetLeft: 50, bandHeight: 32 })
    expect(beside.x).toBe(70)
    expect(beside.y).toBe(20 + 16 + 4) // centred on the logo
  })

  it('centres a horizontal watermark on the page', () => {
    const at = placeWatermark(page, 200, 40, false)
    expect(at).toEqual({ x: 200, y: 420, angle: 0 })
  })

  it('runs a diagonal watermark corner to corner, its middle on the middle of the page', () => {
    const at = placeWatermark(page, 200, 40, true)
    expect(at.angle).toBeCloseTo((Math.atan2(800, 600) * 180) / Math.PI)
    const a = (at.angle * Math.PI) / 180
    // Middle of the text: half way along the baseline, then half the cap height up.
    const mx = at.x + 100 * Math.cos(a) - 20 * Math.sin(a)
    const my = at.y - 100 * Math.sin(a) - 20 * Math.cos(a)
    expect(mx).toBeCloseTo(300)
    expect(my).toBeCloseTo(400)
  })

  it('sizes a watermark to fill the page', () => {
    expect(watermarkFontSize('medium', page, 3, true)).toBe(72)
    expect(watermarkFontSize('fit', page, 4, false)).toBeCloseTo(112.5)
    expect(watermarkFontSize('fit', page, 0.5, false)).toBe(320) // capped at 40% of the height
  })
})

describe('helpers', () => {
  it('reads hex colours', () => {
    expect(hexToRgb('#ff0080')).toEqual({ r: 1, g: 0, b: 128 / 255 })
    expect(hexToRgb('nonsense')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('makes names unique within a zip', () => {
    expect(uniqueNames(['a-stamped.pdf', 'b-stamped.pdf', 'A-stamped.pdf'])).toEqual([
      'a-stamped.pdf',
      'b-stamped.pdf',
      'A-stamped (2).pdf',
    ])
  })

  it('repairs damaged saved settings', () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = sanitiseSettings({ scope: 'weird', watermark: { opacity: 7, colour: 'red' }, numbers: { start: -4 } })
    expect(s.scope).toBe('all')
    expect(s.watermark.opacity).toBe(1)
    expect(s.watermark.colour).toBe(DEFAULT_SETTINGS.watermark.colour)
    expect(s.numbers.start).toBe(0)
  })
})

async function sample(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([595, 842])
    if (rotate) p.setRotation(degrees(rotate))
  }
  return doc.save()
}

describe('stampPdf', () => {
  it('stamps the chosen pages and keeps the page count and sizes', async () => {
    const out = await stampPdf(await sample(90), settings({ scope: 'even' }), null)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    expect(doc.getPage(0).getWidth()).toBe(595)
  })

  it('refuses a range it cannot read', async () => {
    await expect(stampPdf(await sample(), settings({ scope: 'range', range: 'x' }), null)).rejects.toThrow(
      'is not a page or a range',
    )
  })

  it('previews one page, saying whether it is stamped', async () => {
    const source = await PDFDocument.load(await sample())
    expect((await previewPage(source, 0, settings({ scope: 'even' }), null)).stamped).toBe(false)
    const p = await previewPage(source, 1, settings({ scope: 'even' }), null)
    expect(p.stamped).toBe(true)
    expect((await PDFDocument.load(p.bytes)).getPageCount()).toBe(1)
  })
})
