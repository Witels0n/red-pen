import { describe, expect, it } from 'vitest'
import { classifyQuestion, deriveThresholds, needsReview, REVIEW_THRESHOLD } from '../../src/shared/omr/classify'
import { convexHull, extremeQuad, findSquares, orderClockwise, polygonArea } from '../../src/shared/omr/fiducials'
import { applyHomography, homographyFrom, invertHomography } from '../../src/shared/omr/homography'
import {
  assessmentCodeFrom,
  CODE_ALPHABET,
  decodeSheetQr,
  encodeSheetQr,
  isAssessmentCode,
  type SheetQr,
} from '../../src/shared/omr/qr-payload'

describe('sheet QR payload', () => {
  const round: SheetQr[] = [
    { kind: 'answer-sheet', assessmentCode: 'K7QM2X', version: 'A', learnerId: '0042', page: 1, pages: 1 },
    { kind: 'answer-sheet', assessmentCode: 'ZZZZZZ', version: 'D', learnerId: '7', page: 2, pages: 2 },
    { kind: 'answer-sheet', assessmentCode: 'P3HW9C', version: 'B', page: 1, pages: 3 },
    { kind: 'cover', learnerId: '0315' },
  ]
  it.each(round)('round-trips %o', (qr) => {
    expect(decodeSheetQr(encodeSheetQr(qr))).toEqual(qr)
  })

  it('has the documented format', () => {
    expect(encodeSheetQr(round[0])).toBe('RP1|K7QM2X|A|0042|1/1')
    expect(encodeSheetQr(round[2])).toBe('RP1|P3HW9C|B|-|1/3')
    expect(encodeSheetQr(round[3])).toBe('RP1|COVER|-|0315|1/1')
  })

  it.each([
    '',
    'hello',
    'https://example.com',
    'RP1|K7QM2X|A|0042|1/1|extra',
    'RP2|K7QM2X|A|0042|1/1',
    'rp1|K7QM2X|A|0042|1/1',
    'RP1|K7QM2|A|0042|1/1',
    'RP1|K7QM2O|A|0042|1/1', // O is not in the alphabet
    'RP1|k7qm2x|A|0042|1/1',
    'RP1|K7QM2X|E|0042|1/1',
    'RP1|K7QM2X||0042|1/1',
    'RP1|K7QM2X|A|12345|1/1',
    'RP1|K7QM2X|A|12a|1/1',
    'RP1|K7QM2X|A||1/1',
    'RP1|K7QM2X|A|0042|2/1',
    'RP1|K7QM2X|A|0042|0/1',
    'RP1|K7QM2X|A|0042|1',
    'RP1|K7QM2X|A|0042|01/1',
    'RP1|COVER|A|0042|1/1',
    'RP1|COVER|-|-|1/1',
    'RP1|COVER|-|0042|1/2',
  ])('rejects %j', (text) => {
    expect(decodeSheetQr(text)).toBeNull()
  })

  it('refuses to encode anything it could not decode', () => {
    expect(() =>
      encodeSheetQr({ ...(round[0] as Extract<SheetQr, { kind: 'answer-sheet' }>), learnerId: 'Sipho' }),
    ).toThrow()
    expect(() =>
      encodeSheetQr({ ...(round[0] as Extract<SheetQr, { kind: 'answer-sheet' }>), assessmentCode: 'COVER' }),
    ).toThrow()
    expect(() => encodeSheetQr({ ...(round[0] as Extract<SheetQr, { kind: 'answer-sheet' }>), page: 3 })).toThrow()
    expect(() => encodeSheetQr({ kind: 'cover', learnerId: '' })).toThrow()
  })

  it('derives a stable 6-character Assessment code from an id', () => {
    const a = assessmentCodeFrom('assessment-2026-11-17-abc')
    expect(a).toBe(assessmentCodeFrom('assessment-2026-11-17-abc'))
    expect(isAssessmentCode(a)).toBe(true)
    expect([...a].every((c) => CODE_ALPHABET.includes(c))).toBe(true)
    const codes = new Set(Array.from({ length: 2000 }, (_, i) => assessmentCodeFrom(`id-${i}`)))
    expect(codes.size).toBeGreaterThan(1995)
  })
})

describe('classifying a question', () => {
  const t = deriveThresholds([0.7, 0.65, 0.8, 0.75, 0.7])

  it('follows the learner pencil, within limits', () => {
    expect(t.mark).toBeCloseTo(0.45 * 0.7)
    expect(deriveThresholds([]).mark).toBeCloseTo(0.27) // default pencil level 0.6
    expect(deriveThresholds([0.3, 0.3, 0.3]).mark).toBeGreaterThanOrEqual(0.16)
    expect(deriveThresholds([2, 2, 2]).mark).toBeLessThanOrEqual(0.4)
    expect(deriveThresholds([0.1, 0.05, 0.6]).mark).toBeCloseTo(0.27) // too few deliberate marks
  })

  it('reads one clear fill with high confidence', () => {
    const r = classifyQuestion([0.02, 0.7, 0.01, 0.03], t)
    expect(r).toMatchObject({ answer: 1, flags: [] })
    expect(r.confidence).toBeGreaterThan(0.95)
    expect(needsReview(r)).toBe(false)
  })

  it('reads a blank question as null', () => {
    const r = classifyQuestion([0.01, 0.02, 0, 0.03], t)
    expect(r.answer).toBeNull()
    expect(r.confidence).toBeGreaterThan(0.85)
  })

  it('calls two fills multiple, and always sends them to Review', () => {
    const r = classifyQuestion([0.7, 0.02, 0.72, 0.01], t)
    expect(r.answer).toBe('multiple')
    expect(needsReview(r)).toBe(true)
  })

  it('flags a light mark and keeps its confidence low', () => {
    const r = classifyQuestion([0.02, 0.22, 0.01], t)
    expect(r.flags).toEqual(['light'])
    expect(r.confidence).toBeLessThan(REVIEW_THRESHOLD)
  })

  it('reads the darker answer but flags a leftover erasure', () => {
    const r = classifyQuestion([0.7, 0.2, 0.02, 0.02], t)
    expect(r).toMatchObject({ answer: 0, flags: ['erasure'] })
    expect(needsReview(r)).toBe(true)
  })

  it('gets less sure the closer a fill is to the threshold', () => {
    const strong = classifyQuestion([0.8, 0], t).confidence
    const weak = classifyQuestion([t.mark + 0.01, 0], t).confidence
    expect(strong).toBeGreaterThan(weak)
    expect(weak).toBeGreaterThanOrEqual(REVIEW_THRESHOLD)
  })

  it('never returns a confidence outside 0 to 1', () => {
    for (let a = 0; a <= 1.2; a += 0.05) {
      for (let b = 0; b <= 1.2; b += 0.05) {
        const c = classifyQuestion([a, b, 0.01], t).confidence
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('geometry', () => {
  it('maps four points exactly and inverts', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    const dst = [
      { x: 10, y: 20 },
      { x: 130, y: 15 },
      { x: 150, y: 260 },
      { x: 5, y: 240 },
    ]
    const h = homographyFrom(src, dst)
    src.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y)
      expect(q.x).toBeCloseTo(dst[i].x, 6)
      expect(q.y).toBeCloseTo(dst[i].y, 6)
    })
    const back = applyHomography(invertHomography(h), 150, 260)
    expect(back.x).toBeCloseTo(100, 6)
    expect(back.y).toBeCloseTo(200, 6)
  })

  it('orders points clockwise on screen', () => {
    const pts = orderClockwise([
      { x: 10, y: 90 },
      { x: 90, y: 10 },
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ])
    expect(pts).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ])
  })

  it('fits a rotated square with its extreme-point quadrilateral, but not a circle', () => {
    const square = Array.from({ length: 4 }, (_, i) => ({
      x: 50 + 20 * Math.cos(i * (Math.PI / 2) + 0.4),
      y: 50 + 20 * Math.sin(i * (Math.PI / 2) + 0.4),
    }))
    expect(polygonArea(extremeQuad(convexHull(square))!)).toBeCloseTo(polygonArea(square), 6)
    const circle = Array.from({ length: 72 }, (_, i) => ({
      x: 20 * Math.cos((i * Math.PI) / 36),
      y: 20 * Math.sin((i * Math.PI) / 36),
    }))
    const ratio = polygonArea(convexHull(circle)) / polygonArea(extremeQuad(convexHull(circle))!)
    expect(ratio).toBeGreaterThan(1.5)
  })

  it('finds solid squares at any angle and ignores discs, rings and bars', () => {
    const w = 400
    const h = 200
    const mask = new Uint8Array(w * h)
    const paint = (inShape: (x: number, y: number) => boolean) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inShape(x, y)) mask[y * w + x] = 1
    }
    const rotSquare = (cx: number, cy: number, s: number, a: number) => (x: number, y: number) => {
      const dx = x - cx
      const dy = y - cy
      const u = dx * Math.cos(a) + dy * Math.sin(a)
      const v = -dx * Math.sin(a) + dy * Math.cos(a)
      return Math.abs(u) <= s / 2 && Math.abs(v) <= s / 2
    }
    paint(rotSquare(50, 50, 30, 0))
    paint(rotSquare(130, 50, 30, Math.PI / 4))
    paint(rotSquare(210, 50, 30, 0.3))
    paint((x, y) => Math.hypot(x - 300, y - 50) <= 17) // disc
    paint(
      (x, y) =>
        Math.max(Math.abs(x - 50), Math.abs(y - 140)) <= 16 && Math.max(Math.abs(x - 50), Math.abs(y - 140)) >= 10,
    ) // ring
    paint((x, y) => Math.abs(x - 150) <= 30 && Math.abs(y - 140) <= 6) // bar
    const found = findSquares(mask, w, h, { minArea: 16, maxArea: 5000 })
    expect(found.map((f) => Math.round(f.x / 10) * 10).sort((a, b) => a - b)).toEqual([50, 130, 210])
    for (const f of found) expect(f.side).toBeGreaterThan(27)
  })
})
