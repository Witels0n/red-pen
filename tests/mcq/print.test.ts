import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { newClassList } from '../../src/shared/classes/class-list'
import { layoutSheet } from '../../src/shared/omr/layout'
import { collate, markAll } from '../../src/mcq/core/marking'
import { marksheetCsv, marksheetRows } from '../../src/mcq/core/marksheet'
import { withQuestion } from '../../src/mcq/core/model'
import { printRun, readTemplates } from '../../src/mcq/core/sheets'
import { renderBookletPdf, renderMemoPdf } from '../../src/mcq/pdf/booklet'
import { questionsToLookAt, renderFeedbackPdf } from '../../src/mcq/pdf/feedback'
import { markedSheetAnnotations, markedSheetFileName, renderMarkedSheetPdf } from '../../src/mcq/pdf/marked-sheets'
import { assessment, memoAnswers, pagesFor } from './fixtures'

const classList = newClassList('Grade 7B', 2, [
  { id: '01', name: 'Thandi Mokoena' },
  { id: '02', name: 'Sipho Dlamini' },
  { id: '03' },
])

describe('printRun', () => {
  it('prints a named sheet per learner in round-robin Versions, plus spares', () => {
    const a = { ...assessment(12, 2), print: { ...assessment(1).print, mode: 'named-qr' as const, spares: 2 } }
    const run = printRun(a, classList)
    expect(run.specs.map((s) => [s.identity.learnerId, s.identity.learnerName, s.version])).toEqual([
      ['01', 'Thandi Mokoena', 'A'],
      ['02', 'Sipho Dlamini', 'B'],
      ['03', undefined, 'A'],
      [undefined, undefined, 'B'],
      [undefined, undefined, 'A'],
    ])
    expect(run.perVersion).toEqual({ A: 3, B: 2 })
    // Every spec lays out (the sheet engine validates the Learner ID digits).
    for (const s of run.specs) expect(layoutSheet(s)).toHaveLength(1)
  })

  it('never prints names in ID-only mode, and can give everyone one Version', () => {
    const base = assessment(12, 3)
    const a = {
      ...base,
      print: {
        ...base.print,
        mode: 'id-qr' as const,
        spares: 0,
        assign: 'single' as const,
        singleVersion: 'C' as const,
      },
    }
    const run = printRun(a, classList)
    expect(run.specs.every((s) => s.identity.learnerName === undefined && s.version === 'C')).toBe(true)
  })

  it('prints identical Bubbled ID sheets', () => {
    const base = assessment(12, 2)
    const a = { ...base, print: { ...base.print, mode: 'bubbled-id' as const, copies: 5, idDigits: 3 } }
    const run = printRun(a, null)
    expect(run.specs).toHaveLength(5)
    expect(run.specs.map((s) => s.version).join('')).toBe('ABABA')
    expect(readTemplates(a, null).map((t) => [t.version, t.identity.mode, t.identity.idDigits])).toEqual([
      ['A', 'bubbled-id', 3],
      ['B', 'bubbled-id', 3],
    ])
  })

  it('needs a Class list for the QR modes', () => {
    expect(() => printRun(assessment(3), null)).toThrow(/Choose a Class list/)
  })
})

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}

describe('PDFs', () => {
  it('renders a booklet per Version that wraps long text onto more pages', async () => {
    let a = assessment(30, 2)
    a.questions.forEach((_, i) => {
      a = withQuestion(a, i, {
        text: `Question ${i + 1}: ${'A long question about fractions and decimals that needs wrapping. '.repeat(4)}`,
        options: ['½', 'A rather long option text that also goes on for a while', 'Short', '0,25'],
      })
    })
    expect(await pageCount(await renderBookletPdf(a, 'B'))).toBeGreaterThan(2)
    expect(await pageCount(await renderMemoPdf(a))).toBeGreaterThanOrEqual(2)
  })

  it('renders feedback slips one or two per page', async () => {
    const a = assessment(12, 2)
    const scans = ['01', '02', '03'].flatMap((id, i) => pagesFor(a, id, i % 2 ? 'B' : 'A', memoAnswers(a)))
    const marks = markAll(a, collate({ ...a, scans }).learners)
    const learners = marks.map((mark) => ({
      mark,
      name: classList.learners.find((l) => l.id === mark.learnerId)?.name,
    }))
    expect(await pageCount(await renderFeedbackPdf(a, learners, 1))).toBe(3)
    expect(await pageCount(await renderFeedbackPdf(a, learners, 2))).toBe(2)
  })

  it('lists questions to look at again in the learner Version numbering', () => {
    const a = assessment(12, 2)
    const answers = memoAnswers(a)
    answers[0] = null
    const [m] = markAll(a, collate({ ...a, scans: pagesFor(a, '01', 'B', answers) }).learners)
    expect(questionsToLookAt(a, m)).toEqual([a.versions.plans[1].questionOrder.indexOf(0) + 1])
  })

  it('draws ticks, crosses and the score on a marked answer sheet', async () => {
    const a = { ...assessment(12, 2), print: { ...assessment(1).print, mode: 'id-qr' as const } }
    const answers = memoAnswers(a)
    answers[0] = ((answers[0] as number) + 1) % 4
    answers[1] = null
    const scans = pagesFor(a, '01', 'B', answers)
    const [m] = markAll(a, collate({ ...a, scans }).learners)
    const templates = readTemplates(a, classList)
    const { annotations, rings } = markedSheetAnnotations(a, m, scans, templates)
    expect(annotations.filter((x) => x.type === 'tick')).toHaveLength(10)
    expect(annotations.filter((x) => x.type === 'cross')).toHaveLength(2)
    expect(annotations.find((x) => x.type === 'total')).toMatchObject({ outOf: 12 })
    expect(rings).toHaveLength(2)

    const canvas = createCanvas(119, 168)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 119, 168)
    const jpeg = new Uint8Array(await canvas.encode('jpeg'))
    const pdf = await renderMarkedSheetPdf(a, m, [{ scan: scans[0], jpeg }], templates)
    expect(await pageCount(pdf)).toBe(1)
    expect(markedSheetFileName('07', 'Thandi Mokoena')).toBe('Thandi Mokoena marked.pdf')
    expect(markedSheetFileName('07')).toBe('Learner 07 marked.pdf')
  })
})

describe('marksheet', () => {
  it('has a row per learner with totals, per question marks and Topic percentages', () => {
    const a = assessment(4, 1)
    const scans = pagesFor(a, '01', 'A', [0, 1, 0, 0])
    const marks = markAll(a, collate({ ...a, scans }).learners)
    const rows = marksheetRows(a, marks, new Map([['01', 'Thandi, "TJ" Mokoena']]))
    expect(marksheetCsv(a, rows).split('\r\n').slice(0, 2)).toEqual([
      'Learner ID,Name,Version,Total,Out of,Percentage,Q1,Q2,Q3,Q4,Fractions %,Decimals %,Note',
      '01,"Thandi, ""TJ"" Mokoena",A,2,4,50,1,1,0,0,50,50,',
    ])
  })
})
