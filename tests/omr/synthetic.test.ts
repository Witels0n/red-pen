// The sheet reader against a matrix of synthetic sheets: printed by the real printer, rasterised
// by pdf.js, filled with pencil-like marks and distorted like copier scans and phone photos.
// The rule that matters: a wrong answer must never come back without being sent to Review.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REVIEW_THRESHOLD } from '../../src/shared/omr/classify'
import type { RgbaImage } from '../../src/shared/omr/image'
import { layoutSheet } from '../../src/shared/omr/layout'
import { renderAnswerSheetsPdf, renderCoverSheetsPdf } from '../../src/shared/omr/print'
import { identifySheet, readSheet } from '../../src/shared/omr/read'
import type { Answer, SheetGeometry, SheetRead, SheetSpec } from '../../src/shared/omr/types'
import {
  bend,
  blur,
  camera,
  contrast,
  drawMarks,
  jpeg,
  noise,
  place,
  rasterise,
  rng,
  shadow,
  tint,
  type Mark,
  type Page,
} from './harness'

const OPTIONS = [4, 4, 5, 3, 2, 4, 5, 4, 3, 4]

const named: SheetSpec = {
  assessmentCode: 'K7QM2X',
  title: 'Grade 9 Natural Sciences: Matter and materials',
  version: 'B',
  identity: { mode: 'named-qr', learnerId: '0042', learnerName: 'Thandiwe Mokoena', idDigits: 4 },
  questions: Array.from({ length: 50 }, (_, i) => ({ options: OPTIONS[i % OPTIONS.length] })),
}

const bubbled: SheetSpec = {
  assessmentCode: 'P3HW9C',
  title: 'Grade 7 Mathematics: Fractions quiz',
  version: 'A',
  identity: { mode: 'bubbled-id', idDigits: 4 },
  questions: Array.from({ length: 30 }, () => ({ options: 4 })),
}

const twoPage: SheetSpec = {
  assessmentCode: 'ZX42RT',
  title: 'Grade 11 Life Sciences: June examination',
  version: 'C',
  identity: { mode: 'id-qr', learnerId: '317', idDigits: 3 },
  questions: Array.from({ length: 72 }, (_, i) => ({ options: i % 7 === 0 ? 5 : 4 })),
}

/** What a question should read as. 'any-flagged' accepts any answer as long as it goes to Review. */
type Expect = Answer | { oneOf: Answer[]; mustReview?: boolean }

interface Filled {
  page: Page
  geometry: SheetGeometry
  expected: Expect[]
  learnerId?: string
}

/** A learner's answers: mostly clean fills at varying darkness, plus every awkward case once. */
function fillPlan(
  g: SheetGeometry,
  seed: number,
  opts: { idDigits?: string } = {},
): { marks: Mark[]; expected: Expect[] } {
  const rand = rng(seed)
  const marks: Mark[] = []
  const expected: Expect[] = []
  g.questions.forEach((q, i) => {
    const n = q.bubbles.length
    const pick = Math.floor(rand() * n)
    const other = (pick + 1 + Math.floor(rand() * (n - 1))) % n
    const darkness = 0.55 + rand() * 0.4
    const special = i % 25
    if (special === 3) {
      // Crossed out and changed: two dark bubbles, which must go to Review as multiple.
      marks.push(
        { bubble: q.bubbles[other], kind: 'cross', darkness },
        { bubble: q.bubbles[pick], kind: 'fill', darkness },
      )
      expected.push({ oneOf: ['multiple'], mustReview: true })
    } else if (special === 7) {
      // Erased and changed: the faint erasure may be flagged, the answer must be the new one.
      marks.push({ bubble: q.bubbles[other], kind: 'erased' }, { bubble: q.bubbles[pick], kind: 'fill', darkness })
      expected.push({ oneOf: [pick] })
    } else if (special === 11) {
      expected.push(null)
    } else if (special === 14) {
      // Two answers filled on purpose.
      marks.push(
        { bubble: q.bubbles[pick], kind: 'fill', darkness },
        { bubble: q.bubbles[other], kind: 'fill', darkness },
      )
      expected.push('multiple')
    } else if (special === 17) {
      marks.push({ bubble: q.bubbles[pick], kind: 'partial', darkness })
      expected.push({ oneOf: [pick] })
    } else if (special === 19) {
      // Very light: any reading is fine, as long as it goes to Review.
      marks.push({ bubble: q.bubbles[pick], kind: 'light', darkness })
      expected.push({ oneOf: [pick, null], mustReview: true })
    } else if (special === 22) {
      // A tick in the bubble instead of a fill: either the option or Review, never another option.
      marks.push({ bubble: q.bubbles[pick], kind: 'tick', darkness })
      expected.push({ oneOf: [pick, null] })
    } else {
      marks.push({ bubble: q.bubbles[pick], kind: 'fill', darkness })
      expected.push(pick)
    }
  })
  if (opts.idDigits) {
    g.idColumns.forEach((c, d) =>
      marks.push({ bubble: c.bubbles[Number(opts.idDigits![d])], kind: 'fill', darkness: 0.8 }),
    )
  }
  return { marks, expected }
}

const sources: Record<string, Filled> = {}

beforeAll(async () => {
  const add = async (key: string, spec: SheetSpec, pageIndex: number, seed: number, idDigits?: string) => {
    const pages = await rasterise(await renderAnswerSheetsPdf([spec]))
    const geometry = layoutSheet(spec)[pageIndex]
    const plan = fillPlan(geometry, seed, { idDigits })
    sources[key] = {
      page: drawMarks(pages[pageIndex], plan.marks, seed, 6, geometry),
      geometry,
      expected: plan.expected,
      learnerId: idDigits ?? spec.identity.learnerId,
    }
  }
  await add('named', named, 0, 11)
  await add('bubbled', bubbled, 0, 22, '0815')
  await add('page2', twoPage, 1, 33)
}, 60_000)

type Distort = (img: RgbaImage) => RgbaImage | Promise<RgbaImage>

/** A typical phone photo: tilted back, a little rotated, slightly soft, noisy, compressed, shadowed. */
const phone =
  (rotate: number, extra: Partial<Parameters<typeof camera>[1]> = {}): Distort =>
  async (img) =>
    jpeg(
      noise(
        blur(
          shadow(camera(img, { width: 1800, height: 2400, rotate, keystone: 0.1, fill: 0.88, ...extra }), 0.3, 40),
          1.1,
        ),
        5,
        7,
      ),
      75,
    )

interface Case {
  name: string
  source: keyof typeof sources | string
  distort: Distort
  templates: SheetSpec[]
}

const cases: Case[] = []
const add = (name: string, distort: Distort, source = 'named', templates = [named]) =>
  cases.push({ name, source, distort, templates })

// Copier scans
add('clean 200 dpi', (i) => i)
add('copier: rotated +1.5', (i) =>
  camera(i, { width: 1654, height: 2339, rotate: 1.5, fill: 0.97, background: [255, 255, 255] }),
)
add('copier: upside down', (i) =>
  camera(i, { width: 1654, height: 2339, rotate: 180, fill: 0.97, background: [255, 255, 255] }),
)
add('copier: 150 dpi', (i) => camera(i, { width: 1240, height: 1754, fill: 0.99, background: [255, 255, 255] }))
add('copier: 100 dpi', (i) => camera(i, { width: 827, height: 1170, fill: 0.99, background: [255, 255, 255] }))
add('copier: toner grey and noisy', (i) => noise(contrast(i, 40, 245), 10, 3))
add('copier: JPEG quality 40', (i) => jpeg(i, 40))
// Rotation
add('rotate +3', (i) => camera(i, { width: 1800, height: 2400, rotate: 3 }))
add('rotate -5', (i) => camera(i, { width: 1800, height: 2400, rotate: -5 }))
add('rotate +5', (i) => camera(i, { width: 1800, height: 2400, rotate: 5 }))
add('rotate 180', (i) => camera(i, { width: 1800, height: 2400, rotate: 180 }))
add('rotate 177', (i) => camera(i, { width: 1800, height: 2400, rotate: 177 }))
add('landscape photo (90)', (i) => camera(i, { width: 2400, height: 1800, rotate: 0 }))
add('landscape photo (270 + 4)', (i) => camera(i, { width: 2400, height: 1800, rotate: 184 }))
// Perspective and scale
add('keystone 8%', (i) => camera(i, { width: 1800, height: 2400, keystone: 0.08 }))
add('keystone 18%', (i) => camera(i, { width: 1800, height: 2400, keystone: 0.18 }))
add('keystone 15% + side tilt 8% + rotate 4', (i) =>
  camera(i, { width: 1800, height: 2400, keystone: 0.15, sideTilt: 0.08, rotate: 4 }),
)
add('far away (page 55% of frame)', (i) => camera(i, { width: 2400, height: 3200, fill: 0.55, rotate: -2 }))
add('small photo (1200 px)', (i) => camera(i, { width: 900, height: 1200, fill: 0.92, rotate: 2 }))
add('large photo (4000 px, downscaled)', (i) => camera(i, { width: 3000, height: 4000, fill: 0.85, rotate: 1 }))
add('off centre', (i) => camera(i, { width: 1800, height: 2400, fill: 0.8, shift: { x: 120, y: -150 } }))
// Image quality
add('blur 1.5', (i) => blur(i, 1.5))
add('blur 2.5', (i) => blur(i, 2.5))
add('JPEG quality 60', (i) => jpeg(i, 60))
add('JPEG quality 30', (i) => jpeg(i, 30))
add('noise 8', (i) => noise(i, 8, 5))
add('noise 18', (i) => noise(i, 18, 6))
// Lighting
add('shadow ramp 45%', (i) => shadow(i, 0.45, 30))
add('hard shadow band 40%', (i) => shadow(i, 0.4, 100, true))
add('low contrast (90 to 200)', (i) => contrast(i, 90, 200))
add('low contrast + noise', (i) => noise(contrast(i, 80, 190), 8, 9))
add('dim warm light', (i) => tint(contrast(i, 30, 170), 1, 0.92, 0.75))
add('overexposed', (i) => contrast(i, 120, 270))
add('white table', (i) => camera(i, { width: 1800, height: 2400, rotate: 2, fill: 0.85, background: [235, 235, 230] }))
add('black table', (i) => camera(i, { width: 1800, height: 2400, rotate: -3, fill: 0.85, background: [15, 15, 18] }))
// Phone combinations
add('phone', phone(2))
add('phone upside down', phone(182))
add('phone landscape', phone(-3, { width: 2400, height: 1800 }))
add('phone strong keystone', phone(-4, { keystone: 0.2, sideTilt: 0.05 }))
add('lens barrel 2%', (i) => bend(camera(i, { width: 1800, height: 2400, rotate: 2, keystone: 0.08 }), 0.02))
add('paper curl 20 px', (i) => bend(camera(i, { width: 1800, height: 2400, rotate: -2, keystone: 0.06 }), 0, 20))
add('phone far and dim', async (i) => contrast(await phone(3, { fill: 0.6 })(i), 40, 190))
// Other sheets
add('Bubbled ID: clean', (i) => i, 'bubbled', [bubbled])
add('Bubbled ID: phone', phone(-2), 'bubbled', [bubbled])
add(
  'Bubbled ID: upside down + blur',
  (i) => blur(camera(i, { width: 1800, height: 2400, rotate: 178 }), 1.2),
  'bubbled',
  [bubbled],
)
add('Bubbled ID: low contrast', (i) => contrast(i, 90, 200), 'bubbled', [bubbled])
add('page 2 of 2: clean', (i) => i, 'page2', [twoPage])
add('page 2 of 2: phone landscape', phone(4, { width: 2400, height: 1800 }), 'page2', [twoPage])
add(
  'page 2 of 2: rotate 180 + JPEG 50',
  (i) => jpeg(camera(i, { width: 1800, height: 2400, rotate: 180 }), 50),
  'page2',
  [twoPage],
)
add('several Versions offered', (i) => i, 'named', [{ ...named, version: 'A' }, named, { ...named, version: 'C' }])

interface Tally {
  name: string
  correct: number
  total: number
  reviewed: number
  silentWrong: number[]
  missedReview: number[]
  millis: number
  read: SheetRead
}

const tallies: Tally[] = []

function check(expected: Expect, answer: Answer, review: boolean): { ok: boolean; silent: boolean; missed: boolean } {
  if (expected !== null && typeof expected === 'object') {
    const ok = expected.oneOf.includes(answer)
    return { ok, silent: !ok && !review, missed: !!expected.mustReview && !review }
  }
  const ok = expected === answer
  return { ok, silent: !ok && !review, missed: expected === 'multiple' && !review }
}

describe('reading synthetic sheets', () => {
  it.each(cases.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      const src = sources[c.source]
      const image = await c.distort(src.page.image)
      const started = performance.now()
      const read = readSheet(image, { templates: c.templates })
      const millis = performance.now() - started
      expect(read.ok, read.problems.join(' ')).toBe(true)
      expect(read.page).toBe(src.geometry.page)
      expect(read.identity.learnerId).toBe(src.learnerId)
      expect(read.version).toBe(c.templates.find((t) => t.version === read.version)?.version)
      const t: Tally = {
        name: c.name,
        correct: 0,
        total: 0,
        reviewed: 0,
        silentWrong: [],
        missedReview: [],
        millis,
        read,
      }
      src.expected.forEach((e, i) => {
        const review = read.confidences[i] < REVIEW_THRESHOLD || read.flags[i].length > 0
        const r = check(e, read.answers[i], review)
        t.total++
        if (r.ok) t.correct++
        if (review) t.reviewed++
        if (r.silent) t.silentWrong.push(i + 1 + read.questionStart)
        if (r.missed) t.missedReview.push(i + 1 + read.questionStart)
      })
      tallies.push(t)
      expect(t.silentWrong, 'wrong answers that were not sent to Review').toEqual([])
      expect(t.missedReview, 'crossed-out or double answers that were not sent to Review').toEqual([])
      // Every plain, clearly filled answer is read correctly (the awkward cases are a few per sheet).
      expect(t.correct / t.total).toBeGreaterThanOrEqual(0.9)
    },
    30_000,
  )
})

/** Paints over the QR, as a learner's scribble or a torn corner would. */
function hideQr(src: Filled): RgbaImage {
  const data = new Uint8ClampedArray(src.page.image.data)
  const s = src.page.scale
  const r = src.geometry.qr
  for (let y = Math.floor(r.y * s); y < (r.y + r.h) * s; y++) {
    for (let x = Math.floor(r.x * s); x < (r.x + r.w) * s; x++) {
      const i = (y * src.page.image.width + x) * 4
      const v = (x >> 4) % 2 ? 60 : 240
      data[i] = data[i + 1] = data[i + 2] = v
    }
  }
  return { ...src.page.image, data }
}

describe('when the QR cannot be read', () => {
  it('a Bubbled ID sheet still reads the Learner ID and answers', () => {
    const read = readSheet(hideQr(sources.bubbled), { templates: [bubbled] })
    expect(read.ok).toBe(true)
    expect(read.identity).toEqual({ learnerId: '0815', source: 'bubbles' })
    expect(read.version).toBe('A')
    expect(read.problems).toContain('The code on the sheet could not be read.')
    sources.bubbled.expected.forEach((e, i) => {
      if (typeof e === 'number') expect(read.answers[i]).toBe(e)
    })
  })

  it('a QR sheet reads the answers but leaves the learner for Review', () => {
    const read = readSheet(hideQr(sources.named), { templates: [named] })
    expect(read.ok).toBe(true)
    expect(read.identity.learnerId).toBeUndefined()
    expect(read.needsReview).toBe(true)
    expect(read.problems.join(' ')).toMatch(/learner is unknown/)
  })

  it('page 2 of a two-page sheet is recognised from its layout, and flagged', () => {
    const read = readSheet(hideQr(sources.page2), { templates: [twoPage] })
    expect(read.ok).toBe(true)
    expect(read.page).toBe(2)
    expect(read.questionStart).toBe(50)
    expect(read.needsReview).toBe(true)
  })

  it('with several Versions offered, the Version is left unknown', () => {
    const read = readSheet(hideQr(sources.named), { templates: [named, { ...named, version: 'A' }] })
    expect(read.version).toBeUndefined()
    expect(read.needsReview).toBe(true)
  })

  it('BarcodeDetector hints from the main thread are used', () => {
    const read = readSheet(hideQr(sources.named), {
      templates: [named],
      qrHints: ['not ours', 'RP1|K7QM2X|B|0042|1/1'],
    })
    expect(read.identity).toEqual({ learnerId: '0042', source: 'qr' })
  })
})

describe('Cover sheets', () => {
  it('are identified from a phone photo, upside down', async () => {
    const pdf = await renderCoverSheetsPdf([
      { learnerId: '0042', learnerName: 'Thandiwe Mokoena', className: 'Grade 9B' },
      { learnerId: '0043', learnerName: 'Pieter van der Merwe', title: 'Term 2 essay' },
    ])
    const pages = await rasterise(pdf)
    expect(pages).toHaveLength(2)
    const photo = await phone(181)(pages[1].image)
    const id = identifySheet(photo)
    expect(id.ok && id.qr).toEqual({ kind: 'cover', learnerId: '0043' })
    const read = readSheet(pages[0].image, { templates: [named] })
    expect(read.ok).toBe(false)
    expect(read.kind).toBe('cover')
    expect(read.identity.learnerId).toBe('0042')
  })
})

describe('rejecting what is not a whole sheet', () => {
  it('a photo with a corner square cut off', async () => {
    const img = sources.named.page.image
    const cropped = place(img, {
      width: 1500,
      height: 2100,
      corners: [
        { x: -160, y: -160 },
        { x: img.width - 160, y: -160 },
        { x: img.width - 160, y: img.height - 160 },
        { x: -160, y: img.height - 160 },
      ],
    })
    const read = readSheet(cropped, { templates: [named] })
    expect(read.ok).toBe(false)
    expect(read.problems[0]).toMatch(/All four corner squares must be in the photo/)
  })

  it('a blank photo', () => {
    const blank = { width: 1200, height: 1600, data: new Uint8ClampedArray(1200 * 1600 * 4).fill(200) }
    expect(readSheet(blank, { templates: [named] }).ok).toBe(false)
  })

  it('a sheet from another assessment', () => {
    const read = readSheet(sources.named.page.image, { templates: [{ ...named, assessmentCode: 'AAAAAA' }] })
    expect(read.ok).toBe(false)
    expect(read.problems[0]).toMatch(/different assessment \(code K7QM2X\)/)
  })
})

afterAll(() => {
  if (tallies.length === 0) return
  const rows = tallies.map(
    (t) =>
      `${t.name.padEnd(40)} ${String(t.correct).padStart(3)}/${t.total}  review ${String(t.reviewed).padStart(2)}  silent ${t.silentWrong.length}  ${Math.round(t.millis)} ms`,
  )
  const all = tallies.reduce((s, t) => s + t.total, 0)
  const ok = tallies.reduce((s, t) => s + t.correct, 0)
  const reviewed = tallies.reduce((s, t) => s + t.reviewed, 0)
  const silent = tallies.reduce((s, t) => s + t.silentWrong.length, 0)
  const ms = tallies.map((t) => t.millis).sort((a, b) => a - b)
  if (process.env.OMR_REPORT) {
    console.log(
      [
        ...rows,
        `TOTAL ${ok}/${all} correct (${((100 * ok) / all).toFixed(1)}%), ${reviewed} sent to Review (${((100 * reviewed) / all).toFixed(1)}%), ${silent} silent errors`,
        `read time: median ${Math.round(ms[ms.length >> 1])} ms, max ${Math.round(ms[ms.length - 1])} ms`,
      ].join('\n'),
    )
  }
})
