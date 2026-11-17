// Feedback slips: per learner, the score, a Topic breakdown and the Topics to revise (when the
// Assessment has Topics), and the questions to look at again.
// One slip per page, or two per A4 page to cut in half.
import { rgb, type PDFPage } from 'pdf-lib'
import { REVISE_BELOW, topicsToRevise } from '../core/analysis'
import type { LearnerMark, TopicScore } from '../core/marking'
import { formatNumber, topicsOf, type Assessment } from '../core/model'
import { planFor } from '../core/versions'
import {
  A4_HEIGHT,
  A4_WIDTH,
  box,
  CONTENT_WIDTH,
  fit,
  hline,
  MARGIN,
  MM,
  MUTED,
  newDocument,
  RULE,
  text,
  wrap,
  type Fonts,
} from './layout'

export type SlipsPerPage = 1 | 2

export interface SlipLearner {
  mark: LearnerMark
  /** The learner's name, when the Class list is on this device. */
  name?: string
}

const BAR_TRACK = rgb(0.9, 0.91, 0.93)
const BAR_GOOD = rgb(0.18, 0.48, 0.25)
const BAR_LOW = rgb(0.83, 0.13, 0.18)

/** Question numbers as printed on the learner's own Version, for every question not answered correctly. */
export function questionsToLookAt(a: Pick<Assessment, 'versions'>, mark: LearnerMark): number[] {
  const plan = mark.version ? planFor(a, mark.version) : undefined
  return mark.perQuestion
    .map((q, i) => ({ q, printed: plan ? plan.questionOrder.indexOf(i) + 1 : i + 1 }))
    .filter(({ q }) => q.outcome === 'wrong' || q.outcome === 'blank' || q.outcome === 'multiple')
    .map(({ printed }) => printed)
    .sort((x, y) => x - y)
}

/** What a slip says below the score. The Topic parts are left out (null) when the Assessment has no Topics. */
export interface SlipContent {
  topics: TopicScore[] | null
  revise: string | null
  look: number[]
}

export function slipContent(a: Pick<Assessment, 'questions' | 'versions'>, mark: LearnerMark): SlipContent {
  const look = questionsToLookAt(a, mark)
  if (topicsOf(a.questions).length === 0) return { topics: null, revise: null, look }
  const revise = topicsToRevise(mark)
  return {
    topics: mark.topics,
    revise: revise.length
      ? revise.join(', ')
      : mark.topics.length
        ? `Well done: you scored ${Math.round(REVISE_BELOW * 100)}% or more in every Topic.`
        : 'None of the questions you were marked on has a Topic.',
    look,
  }
}

function drawSlip(page: PDFPage, fonts: Fonts, a: Assessment, learner: SlipLearner, top: number, height: number): void {
  const { mark } = learner
  const left = MARGIN
  const right = MARGIN + CONTENT_WIDTH
  let y = top + 14 * MM

  text(page, fonts, fit(fonts.bold, a.title, 14, CONTENT_WIDTH - 60 * MM), left, y, { font: fonts.bold, size: 14 })
  text(page, fonts, 'Feedback', right, y, { size: 10, color: MUTED, align: 'right' })
  y += 8 * MM
  const who = learner.name ? `${learner.name}   (Learner ID ${mark.learnerId})` : `Learner ID ${mark.learnerId}`
  text(page, fonts, fit(fonts.bold, who, 12, CONTENT_WIDTH - 50 * MM), left, y, { font: fonts.bold, size: 12 })
  if (mark.version && a.versions.count > 1)
    text(page, fonts, `Version ${mark.version}`, right, y, { size: 10, color: MUTED, align: 'right' })
  y += 4 * MM
  hline(page, left, right, y, 0.6)
  y += 12 * MM

  // Score
  const percent = Math.round(mark.fraction * 100)
  text(page, fonts, `${formatNumber(mark.score)} / ${formatNumber(mark.outOf)}`, left, y, {
    font: fonts.bold,
    size: 26,
  })
  text(page, fonts, `${percent}%`, left + 52 * MM, y, { font: fonts.bold, size: 26, color: MUTED })
  y += 6 * MM
  if (mark.missingPages.length) {
    text(page, fonts, `Page ${mark.missingPages.join(', ')} of your answer sheet was not scanned.`, left, y, {
      size: 9,
      color: BAR_LOW,
    })
    y += 5 * MM
  }
  y += 5 * MM

  const bottom = top + height - 10 * MM
  const content = slipContent(a, mark)
  const look = content.look
  const topics = content.topics ?? []
  // Room kept below the Topic table for "Topics to revise" and "Questions to look at again".
  const reserved = 34 * MM

  if (topics.length) {
    text(page, fonts, 'Topic', left, y, { font: fonts.bold, size: 9, color: MUTED })
    text(page, fonts, 'Marks', left + 95 * MM, y, { font: fonts.bold, size: 9, color: MUTED, align: 'right' })
    text(page, fonts, '%', left + 110 * MM, y, { font: fonts.bold, size: 9, color: MUTED, align: 'right' })
    y += 2 * MM
    hline(page, left, right, y)
    const rowH = 6.2 * MM
    const fits = Math.max(1, Math.floor((bottom - reserved - y) / rowH))
    const shown = topics.length > fits ? topics.slice(0, fits - 1) : topics
    for (const t of shown) {
      y += rowH
      const share = t.possible > 0 ? t.earned / t.possible : 0
      text(page, fonts, fit(fonts.regular, t.topic, 10.5, 80 * MM), left, y, { size: 10.5 })
      text(page, fonts, `${formatNumber(t.earned)} / ${formatNumber(t.possible)}`, left + 95 * MM, y, {
        size: 10.5,
        align: 'right',
      })
      text(page, fonts, `${Math.round(share * 100)}%`, left + 110 * MM, y, {
        size: 10.5,
        align: 'right',
        font: fonts.bold,
      })
      const barX = left + 115 * MM
      const barW = right - barX
      box(page, barX, y - 3 * MM, barW, 2.6 * MM, BAR_TRACK)
      if (share > 0) box(page, barX, y - 3 * MM, barW * share, 2.6 * MM, share < REVISE_BELOW ? BAR_LOW : BAR_GOOD)
    }
    if (shown.length < topics.length) {
      y += rowH
      text(page, fonts, `and ${topics.length - shown.length} more Topics`, left, y, { size: 9.5, color: MUTED })
    }
    y += 4 * MM
    hline(page, left, right, y)
    y += 9 * MM
  }

  if (content.revise !== null) {
    text(page, fonts, 'Topics to revise', left, y, { font: fonts.bold, size: 11 })
    y += 5.5 * MM
    for (const line of wrap(fonts.regular, content.revise, 10.5, CONTENT_WIDTH).slice(0, 2)) {
      text(page, fonts, line, left, y, { size: 10.5 })
      y += 5 * MM
    }
    y += 3 * MM
  }
  if (look.length) {
    text(page, fonts, 'Questions to look at again', left, y, { font: fonts.bold, size: 11 })
    y += 5.5 * MM
    for (const line of wrap(fonts.regular, look.join(', '), 10.5, CONTENT_WIDTH).slice(0, 2)) {
      text(page, fonts, line, left, y, { size: 10.5 })
      y += 5 * MM
    }
  }
}

/** One PDF with a feedback slip per learner, in the order given. */
export async function renderFeedbackPdf(
  a: Assessment,
  learners: readonly SlipLearner[],
  perPage: SlipsPerPage = 1,
): Promise<Uint8Array> {
  if (learners.length === 0) throw new Error('There are no marked learners yet.')
  const { doc, fonts } = await newDocument(`${a.title} feedback`)
  const slipHeight = A4_HEIGHT / perPage
  learners.forEach((learner, i) => {
    const slot = i % perPage
    const page = slot === 0 ? doc.addPage([A4_WIDTH, A4_HEIGHT]) : doc.getPage(doc.getPageCount() - 1)
    if (slot === 1) {
      // A dashed cut line between the two slips.
      const yCut = A4_HEIGHT / 2
      for (let x = 10 * MM; x < A4_WIDTH - 10 * MM; x += 4 * MM) hline(page, x, x + 2 * MM, yCut, 0.6, RULE)
    }
    drawSlip(page, fonts, a, learner, slot * slipHeight, slipHeight)
  })
  return doc.save()
}
