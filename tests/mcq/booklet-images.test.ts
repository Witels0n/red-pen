import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { MM } from '../../src/shared/omr/layout'
import {
  optionImage,
  withOptionImage,
  withQuestion,
  withQuestionImage,
  type Assessment,
} from '../../src/mcq/core/model'
import { refreshVersions } from '../../src/mcq/core/versions'
import { bookletQuestions, renderBookletPdf } from '../../src/mcq/pdf/booklet'
import {
  layoutBooklet,
  OPTION_IMAGE_MAX,
  type BookletFrame,
  type BookletQuestion,
  type Placed,
} from '../../src/mcq/pdf/booklet-layout'
import { assessment } from './fixtures'
import { pngImage } from './image-fixtures'

const frame: BookletFrame = { left: 50, width: 495, firstTop: 120, top: 74, bottom: 785 }
/** Every text is one line per 60 characters. */
const wrap = (s: string) => s.match(/.{1,60}/g) ?? ['']

const square = { width: 1000, height: 1000 }

function question(number: number, options: BookletQuestion['options'], text = `Question ${number}`): BookletQuestion {
  return { number, marks: '', text, image: null, options }
}

function bottomOf(p: Placed): number {
  return p.kind === 'image' ? p.y + p.height : p.y
}

/** The pages each question's items are on. */
function pagesOf(placed: Placed[], index: number, numberText: string): Set<number> {
  const start = placed.findIndex((p) => p.kind === 'text' && p.text === numberText)
  const next = placed.findIndex((p, i) => i > start && p.kind === 'text' && /^\d+\.$/.test(p.text))
  return new Set(placed.slice(start, next < 0 ? undefined : next).map((p) => p.page))
}

describe('booklet layout with pictures', () => {
  it('puts options with pictures in two columns, the picture under its text or beside an image-only letter', () => {
    const q = question(1, [
      { text: 'A cat', image: square },
      { text: '', image: square },
      { text: 'Neither', image: null },
      { text: '', image: { width: 400, height: 100 } },
    ])
    const { placed, pages } = layoutBooklet([q], frame, wrap)
    expect(pages).toBe(1)
    const images = placed.filter((p) => p.kind === 'image')
    expect(images.map((p) => p.option)).toEqual([0, 1, 3])
    const [a, b, d] = images
    // A and B side by side; D in the second row under B.
    expect(b.x).toBeGreaterThan(a.x + a.width)
    expect(d.x).toBe(b.x)
    expect(d.y).toBeGreaterThan(a.y + a.height)
    // Within half the option width, and no taller than the cap.
    const half = (frame.width - 10 * MM - 6 * MM) / 2 - 7 * MM
    expect(a.width).toBeLessThanOrEqual(half + 0.01)
    expect(a.height).toBeLessThanOrEqual(OPTION_IMAGE_MAX + 0.01)
    expect(a.width / a.height).toBeCloseTo(1)
    // The text "A cat" is above its picture; image-only B starts at the top of its row.
    const aText = placed.find((p) => p.kind === 'text' && p.text === 'A cat')!
    expect(a.y).toBeGreaterThan(aText.y - 10)
    expect(b.y).toBeLessThan(a.y)
    const letters = placed
      .filter((p) => p.kind === 'text' && /^[A-D]$/.test(p.text))
      .map((p) => p.kind === 'text' && p.text)
    expect(letters).toEqual(['A', 'B', 'C', 'D'])
  })

  it('keeps each question with its pictures on one page, and breaks between questions', () => {
    const qs = Array.from({ length: 7 }, (_, i) =>
      question(
        i + 1,
        [0, 1, 2, 3].map((k) => ({ text: `Picture ${k}`, image: square })),
      ),
    )
    const { placed, pages } = layoutBooklet(qs, frame, wrap)
    expect(pages).toBeGreaterThan(2)
    qs.forEach((_, i) => expect(pagesOf(placed, i, `${i + 1}.`).size).toBe(1))
    expect(Math.max(...placed.map(bottomOf))).toBeLessThanOrEqual(frame.bottom)
    for (const p of placed)
      expect(p.kind === 'image' ? p.y : p.y).toBeGreaterThanOrEqual(p.page === 0 ? frame.firstTop : frame.top)
  })

  it('lets a question longer than a page run on, but never splits an option from its picture', () => {
    const long = 'word '.repeat(12 * 60)
    const q = question(
      1,
      [0, 1, 2, 3].map((k) => ({ text: `Option ${k}`, image: square })),
      long,
    )
    const { placed, pages } = layoutBooklet([q], frame, wrap)
    expect(pages).toBe(2)
    for (let k = 0; k < 4; k++) {
      const image = placed.find((p) => p.kind === 'image' && p.option === k)!
      const label = placed.find((p) => p.kind === 'text' && p.text === `Option ${k}`)!
      expect(image.page).toBe(label.page)
    }
    expect(Math.max(...placed.map(bottomOf))).toBeLessThanOrEqual(frame.bottom)
  })
})

/** The image XObjects drawn on each page of a PDF. */
async function imagesPerPage(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) return 0
    return xobjects.keys().filter((k) => {
      const obj = xobjects.lookup(k)
      return obj && 'dict' in obj && (obj as { dict: PDFDict }).dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
    }).length
  })
}

describe('the question booklet PDF', () => {
  function pictured(): Assessment {
    let a = assessment(6)
    a.questions.forEach((q, i) => {
      let next = withQuestion(a, i, { text: `Which picture shows ${i + 1}?` }).questions[i]
      for (let k = 0; k < 4; k++)
        next = withOptionImage(next, k, pngImage(600 + k, 600, ['#c33', '#3c3', '#33c', '#cc3'][k]))
      if (i === 0) next = withQuestionImage(next, pngImage(800, 400, '#999'))
      a = withQuestion(a, i, next)
    })
    return refreshVersions(a)
  }

  it('embeds the pictures on the pages of their questions', async () => {
    const a = pictured()
    const bytes = await renderBookletPdf(a, 'A')
    const perPage = await imagesPerPage(bytes)
    expect(perPage.length).toBeGreaterThan(1)
    expect(perPage.every((n) => n > 0)).toBe(true)
    // 6 questions x 4 options, plus one question picture, each embedded once.
    expect(perPage.reduce((s, n) => s + n, 0)).toBe(25)
  })

  it('keeps each picture with its option through the shuffle', () => {
    const a = pictured()
    const plan = a.versions.plans[0]
    expect(plan.optionOrder.some((o) => o.join() !== '0,1,2,3')).toBe(true)
    const printed = bookletQuestions(a, plan)
    printed.forEach((q, p) => {
      const original = a.questions[plan.questionOrder[p]]
      q.options.forEach((o, k) => {
        expect(o.image).toBe(optionImage(original, plan.optionOrder[p][k]))
        expect(o.text).toBe(original.options[plan.optionOrder[p][k]])
      })
    })
  })
})
