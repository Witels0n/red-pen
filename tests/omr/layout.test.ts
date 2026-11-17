import { describe, expect, it } from 'vitest'
import {
  A4_HEIGHT,
  A4_WIDTH,
  BUBBLE_RADIUS,
  layoutCoverSheet,
  layoutSheet,
  MM,
  ORIENTATION_MARK,
  pageCount,
  QUESTIONS_PER_PAGE,
  rotated180,
} from '../../src/shared/omr/layout'
import { decodeSheetQr } from '../../src/shared/omr/qr-payload'
import type { Bubble, IdentityMode, Rect, SheetGeometry, SheetSpec } from '../../src/shared/omr/types'

function spec(questions: number[], mode: IdentityMode = 'named-qr', extra: Partial<SheetSpec> = {}): SheetSpec {
  return {
    assessmentCode: 'K7QM2X',
    title: 'Test',
    version: 'A',
    identity: {
      mode,
      idDigits: 4,
      ...(mode === 'bubbled-id' ? {} : { learnerId: '0042', learnerName: 'Sipho Dlamini' }),
    },
    questions: questions.map((options) => ({ options })),
    ...extra,
  }
}

const bubbleRect = (b: Bubble): Rect => ({ x: b.cx - b.r, y: b.cy - b.r, w: 2 * b.r, h: 2 * b.r })
const inside = (r: Rect, outer: Rect) =>
  r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h
const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/** Everything the reader samples: bubbles, corner squares, orientation mark and QR (with its quiet zone). */
function readRegions(g: SheetGeometry): { name: string; rect: Rect }[] {
  const quiet = 4 * MM
  return [
    ...g.fiducials.map((rect, i) => ({ name: `fiducial ${i}`, rect })),
    { name: 'orientation mark', rect: g.orientationMark },
    { name: 'QR', rect: { x: g.qr.x - quiet, y: g.qr.y - quiet, w: g.qr.w + 2 * quiet, h: g.qr.h + 2 * quiet } },
    ...g.questions.flatMap((q) => q.bubbles.map((b) => ({ name: `Q${q.index + 1}${b.label}`, rect: bubbleRect(b) }))),
    ...g.idColumns.flatMap((c) => c.bubbles.map((b) => ({ name: `ID${c.digit}:${b.label}`, rect: bubbleRect(b) }))),
  ]
}

const layouts: [string, SheetSpec][] = [
  ['1 question', spec([4])],
  ['17 questions of 5 options', spec(Array(17).fill(5))],
  ['50 mixed', spec(Array.from({ length: 50 }, (_, i) => 2 + (i % 4)))],
  ['50 Bubbled ID, 4 digits', spec(Array(50).fill(5), 'bubbled-id')],
  ['Bubbled ID, 1 digit', spec(Array(20).fill(4), 'bubbled-id', { identity: { mode: 'bubbled-id', idDigits: 1 } })],
  ['ID-only QR', spec(Array(30).fill(3), 'id-qr')],
  ['200 questions', spec(Array(200).fill(5))],
]

describe.each(layouts)('layout: %s', (_name, s) => {
  const pages = layoutSheet(s)

  it('has one page per 50 questions, each question exactly once and in order', () => {
    expect(pages).toHaveLength(pageCount(s.questions.length))
    const indexes = pages.flatMap((p) => p.questions.map((q) => q.index))
    expect(indexes).toEqual(s.questions.map((_, i) => i))
    for (const p of pages) expect(p.questions.length).toBeLessThanOrEqual(QUESTIONS_PER_PAGE)
  })

  it('gives each question its own number of options, lettered from A', () => {
    for (const p of pages) {
      for (const q of p.questions) {
        expect(q.bubbles.map((b) => b.label).join('')).toBe('ABCDE'.slice(0, s.questions[q.index].options))
      }
    }
  })

  it('keeps everything the reader samples apart (at least 1.5 mm between bubbles)', () => {
    for (const p of pages) {
      const regions = readRegions(p)
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const gap = regions[i].name.startsWith('Q') || regions[i].name.startsWith('ID') ? 1.5 * MM : 0
          expect(overlaps(regions[i].rect, regions[j].rect, gap), `${regions[i].name} and ${regions[j].name}`).toBe(
            false,
          )
        }
      }
    }
  })

  it('keeps printed text clear of every bubble', () => {
    for (const p of pages) {
      for (const t of p.texts) {
        const box: Rect = {
          x: t.align === 'center' ? t.x - 100 : t.x,
          y: t.y - t.size,
          w: t.maxWidth ?? 200,
          h: t.size * 1.2,
        }
        for (const q of p.questions) for (const b of q.bubbles) expect(overlaps(box, bubbleRect(b)), t.text).toBe(false)
      }
    }
  })

  it('prints inside the printable area, with bubbles big enough for a pencil', () => {
    for (const p of pages) {
      for (const r of readRegions(p)) expect(inside(r.rect, p.printable), r.name).toBe(true)
      for (const q of p.questions) for (const b of q.bubbles) expect(b.r * 2).toBeGreaterThanOrEqual(4.4 * MM)
    }
  })

  it('carries a QR naming the page and the learner (never the name)', () => {
    pages.forEach((p, i) => {
      const qr = decodeSheetQr(p.qrPayload)
      expect(qr).toMatchObject({
        kind: 'answer-sheet',
        assessmentCode: 'K7QM2X',
        version: 'A',
        page: i + 1,
        pages: pages.length,
      })
      if (qr?.kind !== 'answer-sheet') throw new Error('expected an answer sheet')
      expect(qr.learnerId).toBe(s.identity.mode === 'bubbled-id' ? undefined : '0042')
      expect(p.qrPayload).not.toMatch(/Sipho/)
    })
  })

  it('has a Bubbled ID grid only in Bubbled ID mode, one column of 0 to 9 per digit', () => {
    for (const p of pages) {
      if (s.identity.mode !== 'bubbled-id') expect(p.idColumns).toEqual([])
      else {
        expect(p.idColumns).toHaveLength(s.identity.idDigits)
        for (const c of p.idColumns) expect(c.bubbles.map((b) => b.label).join('')).toBe('0123456789')
      }
    }
  })
})

describe('layout', () => {
  it('puts four corner squares at the page corners, the same on every sheet and Cover sheet', () => {
    const a = layoutSheet(spec([4]))[0]
    const b = layoutCoverSheet({ learnerId: '7' })
    expect(b.fiducials).toEqual(a.fiducials)
    expect(b.qr).toEqual(a.qr)
    const [tl, tr, br, bl] = a.fiducials
    expect(tl.x).toBeCloseTo(A4_WIDTH - tr.x - tr.w)
    expect(tl.y).toBeCloseTo(A4_HEIGHT - bl.y - bl.h)
    expect(br.x).toBe(tr.x)
    expect(br.y).toBe(bl.y)
  })

  it('keeps the spot where an upside-down orientation mark would be blank', () => {
    const blank = rotated180(ORIENTATION_MARK)
    for (const g of [
      ...layoutSheet(spec(Array(50).fill(5), 'bubbled-id')),
      layoutCoverSheet({ learnerId: '1234', title: 'x' }),
    ]) {
      for (const r of readRegions(g)) expect(overlaps(r.rect, blank, 2 * MM), r.name).toBe(false)
      for (const t of g.texts) {
        const w = t.text.length * t.size * 0.6
        const box: Rect = { x: t.align === 'center' ? t.x - w / 2 : t.x, y: t.y - t.size, w, h: t.size * 1.2 }
        expect(overlaps(box, blank, 2 * MM), t.text).toBe(false)
      }
    }
  })

  it('splits 51 questions as 50 on page 1 and 1 on page 2', () => {
    const pages = layoutSheet(spec(Array(51).fill(4)))
    expect(pages.map((p) => p.questions.length)).toEqual([50, 1])
    expect(pages.map((p) => p.qrPayload)).toEqual(['RP1|K7QM2X|A|0042|1/2', 'RP1|K7QM2X|A|0042|2/2'])
  })

  it('lays out a single page on request', () => {
    const pages = layoutSheet(spec(Array(120).fill(4), 'named-qr', { page: 3 }))
    expect(pages).toHaveLength(1)
    expect(pages[0].page).toBe(3)
    expect(pages[0].questions[0].index).toBe(100)
  })

  it('fills columns top to bottom, 17 rows at most', () => {
    const g = layoutSheet(spec(Array(50).fill(4)))[0]
    const columns = new Set(g.questions.map((q) => q.numberX))
    expect(columns.size).toBe(3)
    expect(g.questions[16].numberX).toBe(g.questions[0].numberX)
    expect(g.questions[17].numberX).toBeGreaterThan(g.questions[0].numberX)
    expect(g.questions[1].bubbles[0].cy - g.questions[0].bubbles[0].cy).toBeGreaterThanOrEqual(
      2 * BUBBLE_RADIUS + 1.5 * MM,
    )
  })

  it('names the learner only in named-qr mode', () => {
    const text = (s: SheetSpec) =>
      layoutSheet(s)[0]
        .texts.map((t) => t.text)
        .join(' ')
    expect(text(spec([4]))).toMatch(/Sipho Dlamini/)
    expect(text(spec([4], 'id-qr'))).not.toMatch(/Sipho/)
    expect(text(spec([4], 'id-qr'))).toMatch(/Learner ID: 0042/)
  })

  it('refuses specs it cannot print', () => {
    expect(() => layoutSheet(spec([]))).toThrow(/1 to 200 questions/)
    expect(() => layoutSheet(spec([1]))).toThrow(/2 to 5 options/)
    expect(() => layoutSheet(spec([6]))).toThrow(/2 to 5 options/)
    expect(() => layoutSheet(spec(Array(201).fill(4)))).toThrow()
    expect(() => layoutSheet(spec([4], 'named-qr', { page: 2 }))).toThrow(/Page 2/)
    expect(() => layoutSheet({ ...spec([4]), identity: { mode: 'id-qr', learnerId: '42', idDigits: 4 } })).toThrow(
      /4 digits/,
    )
    expect(() => layoutSheet({ ...spec([4]), identity: { mode: 'bubbled-id', idDigits: 5 } })).toThrow(/1 to 4 digits/)
    expect(() => layoutSheet({ ...spec([4]), assessmentCode: 'abc' })).toThrow(/Assessment code/)
  })
})
