// Marked answer sheets: the learner's own scanned sheet (straightened) with ticks and crosses at
// the bubbles and the score, drawn with the marker's own tick and cross (src/mark/export.ts).
import { PDFDocument, rgb } from 'pdf-lib'
import { exportMarkedPdf } from '../../mark/export'
import { INK_PRESETS } from '../../mark/ink'
import type { Annotation } from '../../mark/marking-model'
import { layoutSheet, MM } from '../../shared/omr/layout'
import type { SheetSpec } from '../../shared/omr/types'
import { pageAnswer, type LearnerMark } from '../core/marking'
import { formatNumber, type Assessment, type ScannedPage } from '../core/model'
import { safeFileName } from '../core/questions-csv'
import { planFor } from '../core/versions'
import { A4_HEIGHT, A4_WIDTH } from '../../shared/pdf/layout'

export interface MarkedSheetPage {
  scan: ScannedPage
  /** The page straightened to layout space (A4 at any resolution), as a JPEG. */
  jpeg: Uint8Array
}

type Draft = { [T in Annotation['type']]: Omit<Extract<Annotation, { type: T }>, 'id'> }[Annotation['type']]

/** Where to draw the score: under the sheet QR, clear of the header text. */
const SCORE_AT = { x: 176 * MM, y: 54 * MM }

/** The ticks, crosses and score for one learner's pages (page numbers count from 1 in the output PDF). */
export function markedSheetAnnotations(
  a: Assessment,
  mark: LearnerMark,
  pages: readonly ScannedPage[],
  templates: readonly SheetSpec[],
): { annotations: Annotation[]; rings: { page: number; cx: number; cy: number; r: number }[] } {
  const annotations: Annotation[] = []
  const rings: { page: number; cx: number; cy: number; r: number }[] = []
  let id = 0
  const add = (draft: Draft) => annotations.push({ ...draft, id: `m${++id}` })
  const oneMarkEach = a.questions.every((q) => q.answer === null || q.marks === 1)

  pages.forEach((scan, p) => {
    const page = p + 1
    const version = scan.version ?? scan.read.version
    const plan = version ? planFor(a, version) : undefined
    const template = templates.find((t) => t.version === version)
    if (!plan || !template) return
    const geometry = layoutSheet({ ...template, page: scan.read.page })[0]
    for (const g of geometry.questions) {
      const i = g.index - scan.read.questionStart
      const original = plan.questionOrder[g.index]
      const outcome = mark.perQuestion[original]?.outcome
      if (!outcome || outcome === 'unmarked' || outcome === 'missing') continue
      const chosen = pageAnswer(scan, i)
      const correct = plan.optionOrder[g.index].indexOf(a.questions[original].answer!)
      const last = g.bubbles[g.bubbles.length - 1]
      if (outcome === 'correct') {
        add({ type: 'tick', page, x: g.bubbles[chosen as number].cx, y: g.bubbles[chosen as number].cy })
        continue
      }
      if (typeof chosen === 'number') add({ type: 'cross', page, x: g.bubbles[chosen].cx, y: g.bubbles[chosen].cy })
      else add({ type: 'cross', page, x: last.cx + 6 * MM, y: last.cy })
      const b = g.bubbles[correct]
      if (b) rings.push({ page, cx: b.cx, cy: b.cy, r: b.r + 1.8 })
    }
  })

  if (pages.length) {
    if (oneMarkEach) {
      add({ type: 'total', page: 1, x: SCORE_AT.x, y: SCORE_AT.y, outOf: mark.outOf })
    } else {
      const label = `${formatNumber(mark.score)} / ${formatNumber(mark.outOf)}`
      add({ type: 'text', page: 1, x: SCORE_AT.x - label.length * 4, y: SCORE_AT.y, text: label })
    }
    add({ type: 'text', page: 1, x: SCORE_AT.x - 10, y: SCORE_AT.y + 20, text: `${Math.round(mark.fraction * 100)}%` })
  }
  return { annotations, rings }
}

/** One learner's marked answer sheet as a PDF. */
export async function renderMarkedSheetPdf(
  a: Assessment,
  mark: LearnerMark,
  pages: readonly MarkedSheetPage[],
  templates: readonly SheetSpec[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${a.title}, marked answer sheet`)
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  const { annotations, rings } = markedSheetAnnotations(
    a,
    mark,
    pages.map((p) => p.scan),
    templates,
  )
  const ink = INK_PRESETS.red
  for (const [i, p] of pages.entries()) {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
    const image = await doc.embedJpg(p.jpeg)
    page.drawImage(image, { x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT })
    // The correct answer, ringed, where the learner got it wrong or left it blank.
    for (const r of rings.filter((r) => r.page === i + 1)) {
      page.drawCircle({
        x: r.cx,
        y: A4_HEIGHT - r.cy,
        size: r.r,
        borderColor: rgb(ink.r, ink.g, ink.b),
        borderWidth: 1.4,
      })
    }
  }
  return exportMarkedPdf(await doc.save(), annotations, ink)
}

/** "Thandi Mokoena marked.pdf", or "Learner 07 marked.pdf" without a name. */
export function markedSheetFileName(learnerId: string, name?: string): string {
  return `${safeFileName(name ? name : `Learner ${learnerId}`)} marked.pdf`
}
