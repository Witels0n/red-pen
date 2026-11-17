import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import { formatDate } from '../src/sign/dates'
import { buildSignedPdf, signedFileName } from '../src/sign/export'
import {
  boxAt,
  displayedSize,
  fitImage,
  fitMark,
  fitText,
  fromPageSpace,
  placeUpright,
  toPageSpace,
} from '../src/sign/geometry'
import { inkBounds, smoothStroke, whiteToTransparent } from '../src/sign/image-utils'
import { createSignModel } from '../src/sign/model'
import { createSavedSignatures, STORAGE_KEYS } from '../src/sign/saved-signature'

// A CropBox with a non-zero origin, 500 wide and 800 high.
const BOX = { x: 40, y: 30, width: 500, height: 800 }

describe('page space mapping', () => {
  it('maps the displayed corners of an upright page, honouring the box origin', () => {
    expect(toPageSpace(BOX, 0, 0, 0)).toEqual({ x: 40, y: 830 })
    expect(toPageSpace(BOX, 0, 500, 800)).toEqual({ x: 540, y: 30 })
  })

  it('maps the displayed top-left corner of rotated pages to the right PDF corner', () => {
    // /Rotate 90 turns the page clockwise: the bottom-left of the PDF box is shown top-left.
    expect(toPageSpace(BOX, 90, 0, 0)).toEqual({ x: 40, y: 30 })
    expect(toPageSpace(BOX, 180, 0, 0)).toEqual({ x: 540, y: 30 })
    expect(toPageSpace(BOX, 270, 0, 0)).toEqual({ x: 540, y: 830 })
    expect(toPageSpace(BOX, -90, 0, 0)).toEqual(toPageSpace(BOX, 270, 0, 0))
  })

  it('round-trips through fromPageSpace for every rotation', () => {
    for (const r of [0, 90, 180, 270]) {
      const { width, height } = displayedSize(BOX, r)
      for (const [x, y] of [
        [0, 0],
        [width, height],
        [123.5, 45.25],
      ]) {
        const p = toPageSpace(BOX, r, x, y)
        expect(fromPageSpace(BOX, r, p.x, p.y)).toEqual({ x, y })
      }
    }
  })

  it('swaps the displayed size for quarter turns', () => {
    expect(displayedSize(BOX, 90)).toEqual({ width: 800, height: 500 })
    expect(displayedSize(BOX, 180)).toEqual({ width: 500, height: 800 })
  })

  it('turns upright content with the page', () => {
    expect([0, 90, 180, 270].map((r) => placeUpright(BOX, r, 10, 20).angle)).toEqual([0, 90, 180, 270])
  })
})

describe('fitting to detected boxes', () => {
  it('sits text on a line and inside a box', () => {
    const line = fitText({ kind: 'line', x: 100, y: 200, width: 150, height: 1 })
    expect(line.y).toBeLessThan(200)
    expect(line.y).toBeGreaterThan(195)
    const box = fitText({ kind: 'box', x: 100, y: 300, width: 200, height: 20 })
    expect(box.size).toBe(12)
    expect(box.x).toBeGreaterThan(100)
    expect(box.y).toBeGreaterThan(310)
    expect(box.y).toBeLessThan(320)
    expect(fitText({ kind: 'box', x: 0, y: 0, width: 200, height: 80 }).size).toBe(16)
  })

  it('centres a mark in a tick box', () => {
    const m = fitMark({ kind: 'tick', x: 10, y: 10, width: 10, height: 10 })
    expect(m.size).toBeCloseTo(9)
    expect(m.x).toBeCloseTo(10.5)
  })

  it('fits a signature onto a line or into a box, keeping its shape', () => {
    const onLine = fitImage(3, 150, { kind: 'line', x: 100, y: 500, width: 200, height: 1 })
    expect(onLine.y + onLine.height).toBeCloseTo(502)
    expect(onLine.width / onLine.height).toBeCloseTo(3)
    const inBox = fitImage(3, 150, { kind: 'box', x: 0, y: 0, width: 300, height: 30 })
    expect(inBox.height).toBeLessThanOrEqual(30)
    const free = fitImage(2, 150, { x: 200, y: 200 })
    expect(free).toEqual({ x: 125, y: 162.5, width: 150, height: 75 })
  })

  it('finds the smallest detected box under a point, including the space above a line', () => {
    const boxes = [
      { kind: 'box' as const, x: 0, y: 0, width: 300, height: 300 },
      { kind: 'tick' as const, x: 10, y: 10, width: 10, height: 10 },
      { kind: 'line' as const, x: 100, y: 400, width: 100, height: 1 },
    ]
    expect(boxAt(boxes, 15, 15)?.kind).toBe('tick')
    expect(boxAt(boxes, 150, 392)?.kind).toBe('line')
    expect(boxAt(boxes, 500, 500)).toBeUndefined()
  })
})

describe('formatDate', () => {
  const d = new Date(2026, 10, 17)
  it('writes the South African long form and ISO form', () => {
    expect(formatDate(d, 'long')).toBe('17 November 2026')
    expect(formatDate(d, 'iso')).toBe('2026-11-17')
    expect(formatDate(new Date(2027, 0, 5), 'iso')).toBe('2027-01-05')
    expect(formatDate(new Date(2027, 0, 5), 'long')).toBe('5 January 2027')
  })
})

describe('signature images', () => {
  it('makes white paper transparent, fades near-white and keeps ink', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 250, 248, 245, 255, 212, 212, 212, 255, 20, 30, 120, 255])
    whiteToTransparent(px)
    expect([px[3], px[7], px[15]]).toEqual([0, 0, 255])
    expect(px[11]).toBeGreaterThan(0)
    expect(px[11]).toBeLessThan(255)
  })

  it('finds the bounds of the ink', () => {
    const w = 4
    const data = new Uint8ClampedArray(w * 3 * 4)
    data[(1 * w + 2) * 4 + 3] = 255
    data[(2 * w + 1) * 4 + 3] = 255
    expect(inkBounds(data, w, 3)).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(inkBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })

  it('smooths a jittery stroke but keeps its ends', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: -5 },
      { x: 30, y: 0 },
    ]
    const s = smoothStroke(pts)
    expect(s[0]).toEqual(pts[0])
    expect(s[3]).toEqual(pts[3])
    expect(Math.abs(s[2].y)).toBeLessThan(5)
  })
})

describe('sign model', () => {
  it('adds, moves and deletes with undo and redo', () => {
    const m = createSignModel()
    const id = m.add({ type: 'tick', page: 1, x: 1, y: 2, size: 10, ink: 'black' })
    m.update(id, { x: 50 })
    expect(m.get(id)).toMatchObject({ x: 50 })
    m.remove(id)
    expect(m.items()).toHaveLength(0)
    m.undo()
    expect(m.get(id)).toMatchObject({ x: 50 })
    m.undo()
    expect(m.get(id)).toMatchObject({ x: 1 })
    m.redo()
    expect(m.get(id)).toMatchObject({ x: 50 })
    m.update(id, { x: 50 }) // no change, no history entry
    m.undo()
    expect(m.get(id)).toMatchObject({ x: 1 })
  })
})

describe('saved signatures', () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>()
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size
      },
    }
  }

  it('stores under red-pen.sign. keys and forgets on request', () => {
    const storage = memoryStorage()
    const saved = createSavedSignatures(() => storage)
    expect(saved.load('signature')).toBeNull()
    saved.save('signature', 'data:image/png;base64,AAAA')
    expect(storage.getItem(STORAGE_KEYS.signature)).toBe('data:image/png;base64,AAAA')
    expect(STORAGE_KEYS.initials.startsWith('red-pen.sign.')).toBe(true)
    expect(saved.load('signature')).toBe('data:image/png;base64,AAAA')
    saved.forget('signature')
    expect(saved.load('signature')).toBeNull()
  })

  it('survives blocked storage', () => {
    const saved = createSavedSignatures(() => {
      throw new Error('blocked')
    })
    expect(saved.load('initials')).toBeNull()
    expect(saved.save('initials', 'data:image/png;base64,AAAA')).toBe(false)
    expect(() => saved.forget('initials')).not.toThrow()
  })
})

describe('buildSignedPdf', () => {
  it('names the output <original>-signed.pdf', () => {
    expect(signedFileName('Trip slip.PDF')).toBe('Trip slip-signed.pdf')
  })

  it('fills and flattens form fields, and draws on rotated pages with an offset box', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 900])
    page.setCropBox(40, 30, 500, 800)
    page.setRotation(degrees(90))
    const form = doc.getForm()
    form.createTextField('learner.name').addToPage(page, { x: 100, y: 100, width: 200, height: 20 })
    form.createCheckBox('consent').addToPage(page, { x: 100, y: 200, width: 12, height: 12 })
    const bytes = await doc.save()

    const out = await buildSignedPdf(
      bytes,
      [
        { id: 'a', type: 'text', page: 1, x: 10, y: 20, size: 12, text: 'Thandi Mokoena', ink: 'blue' },
        { id: 'b', type: 'tick', page: 1, x: 100, y: 100, size: 12, ink: 'black' },
      ],
      new Map([
        ['learner.name', { kind: 'text', value: 'Sipho' }],
        ['consent', { kind: 'checkbox', checked: true }],
      ]),
    )
    const result = await PDFDocument.load(out)
    expect(result.getForm().getFields()).toHaveLength(0)
    expect(result.getPage(0).getRotation().angle).toBe(90)
  })
})
