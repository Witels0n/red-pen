// The question booklet for one Version, and the Memo for every Version.
import type { SheetVersion } from '../../shared/omr/types'
import { letter, marksText, totalMarks, type Assessment } from '../core/model'
import { planFor, printedMemo } from '../core/versions'
import { CONTENT_WIDTH, fit, Flow, footers, hline, MARGIN, MM, MUTED, newDocument, text, wrap } from './layout'

const QUESTION_SIZE = 11
const OPTION_SIZE = 10.5
const LEADING = 1.35

/** A question booklet for one Version: questions and options in that Version's order. */
export async function renderBookletPdf(a: Assessment, version: SheetVersion): Promise<Uint8Array> {
  const plan = planFor(a, version)
  if (!plan) throw new Error(`This assessment has no Version ${version}.`)
  const { doc, fonts } = await newDocument(`${a.title}, Version ${version}`)
  const versioned = a.versions.count > 1

  const flow = new Flow(doc, fonts, (page) => {
    const top = 16 * MM
    text(page, fonts, fit(fonts.bold, a.title, 10, CONTENT_WIDTH - 40 * MM), MARGIN, top, {
      font: fonts.bold,
      size: 10,
    })
    if (versioned)
      text(page, fonts, `Version ${version}`, MARGIN + CONTENT_WIDTH, top, {
        font: fonts.bold,
        size: 10,
        align: 'right',
      })
    hline(page, MARGIN, MARGIN + CONTENT_WIDTH, top + 3 * MM)
    return top + 10 * MM
  })

  // Title block on the first page.
  const titleLines = wrap(fonts.bold, a.title, 18, CONTENT_WIDTH)
  for (const line of titleLines) {
    text(flow.page, fonts, line, MARGIN, flow.y + 14, { font: fonts.bold, size: 18 })
    flow.y += 18 * 1.25
  }
  const details = [
    `${a.questions.length} question${a.questions.length === 1 ? '' : 's'}`,
    `${marksText(totalMarks(a.questions))}`,
    ...(versioned ? [`Version ${version}`] : []),
  ].join('   |   ')
  text(flow.page, fonts, details, MARGIN, flow.y + 6, { size: 10, color: MUTED })
  flow.y += 8 * MM
  const instructions = wrap(
    fonts.italic,
    'Answer every question on your answer sheet: fill the circle for the answer you choose. Make sure the Version on your answer sheet matches this booklet.',
    9.5,
    CONTENT_WIDTH,
  )
  for (const line of instructions) {
    text(flow.page, fonts, line, MARGIN, flow.y + 8, { font: fonts.italic, size: 9.5, color: MUTED })
    flow.y += 9.5 * LEADING
  }
  flow.y += 6 * MM

  const numberWidth = 10 * MM
  const textX = MARGIN + numberWidth
  const textWidth = CONTENT_WIDTH - numberWidth
  const optionX = textX + 7 * MM
  const optionWidth = textWidth - 7 * MM

  plan.questionOrder.forEach((original, position) => {
    const q = a.questions[original]
    const questionLines = q.text.trim() ? wrap(fonts.regular, q.text, QUESTION_SIZE, textWidth) : []
    const optionLines = plan.optionOrder[position].map((o) =>
      q.options[o].trim() ? wrap(fonts.regular, q.options[o], OPTION_SIZE, optionWidth) : [''],
    )
    const qHeight = Math.max(1, questionLines.length) * QUESTION_SIZE * LEADING
    const oHeight = optionLines.reduce((s, l) => s + l.length * OPTION_SIZE * LEADING + 1.5, 0)
    const marks = q.marks === 1 ? '' : `(${marksText(q.marks)})`
    // Keep a question with its options when it fits on one page; a very long one may run on.
    if (qHeight + oHeight < flow.bottom - 40 * MM) flow.ensure(qHeight + oHeight + 2 * MM)
    else flow.ensure(qHeight + 3 * OPTION_SIZE * LEADING)

    text(flow.page, fonts, `${position + 1}.`, MARGIN, flow.y + QUESTION_SIZE, {
      font: fonts.bold,
      size: QUESTION_SIZE,
    })
    if (marks)
      text(flow.page, fonts, marks, MARGIN + CONTENT_WIDTH, flow.y + QUESTION_SIZE, {
        size: 9,
        color: MUTED,
        align: 'right',
      })
    if (questionLines.length === 0) {
      flow.y += QUESTION_SIZE * LEADING
    }
    for (const line of questionLines) {
      flow.ensure(QUESTION_SIZE * LEADING)
      text(flow.page, fonts, line, textX, flow.y + QUESTION_SIZE, { size: QUESTION_SIZE })
      flow.y += QUESTION_SIZE * LEADING
    }
    flow.y += 1.5 * MM
    optionLines.forEach((lines, k) => {
      flow.ensure(OPTION_SIZE * LEADING)
      text(flow.page, fonts, letter(k), textX, flow.y + OPTION_SIZE, { font: fonts.bold, size: OPTION_SIZE })
      lines.forEach((line, i) => {
        if (i > 0) flow.ensure(OPTION_SIZE * LEADING)
        text(flow.page, fonts, line, optionX, flow.y + OPTION_SIZE, { size: OPTION_SIZE })
        flow.y += OPTION_SIZE * LEADING
      })
      flow.y += 1.5
    })
    flow.y += 5 * MM
  })

  footers(doc, fonts, versioned ? `${a.title}, Version ${version}` : a.title)
  return doc.save()
}

/** The Memo: for each Version, the correct letter per question as printed, with marks and Topic. */
export async function renderMemoPdf(a: Assessment): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(`${a.title} memo`)
  const versioned = a.versions.count > 1
  for (const plan of a.versions.plans) {
    const heading = versioned ? `Memo, Version ${plan.version}` : 'Memo'
    const flow = new Flow(doc, fonts, () => 16 * MM)
    for (const line of wrap(fonts.bold, a.title, 16, CONTENT_WIDTH)) {
      text(flow.page, fonts, line, MARGIN, flow.y + 12, { font: fonts.bold, size: 16 })
      flow.y += 20
    }
    text(flow.page, fonts, `${heading}   |   ${marksText(totalMarks(a.questions))}`, MARGIN, flow.y + 6, {
      size: 10.5,
      color: MUTED,
    })
    flow.y += 9 * MM

    const memo = printedMemo(a, plan)
    const cols = {
      q: MARGIN,
      answer: MARGIN + 14 * MM,
      marks: MARGIN + 30 * MM,
      topic: MARGIN + 50 * MM,
      orig: MARGIN + CONTENT_WIDTH,
    }
    const row = 6 * MM
    const head = () => {
      for (const [label, x, align] of [
        ['Q', cols.q, 'left'],
        ['Answer', cols.answer, 'left'],
        ['Marks', cols.marks, 'left'],
        ['Topic', cols.topic, 'left'],
        ...(versioned ? [['Original Q', cols.orig, 'right']] : []),
      ] as [string, number, 'left' | 'right'][]) {
        text(flow.page, fonts, label, x, flow.y + 4, { font: fonts.bold, size: 9, color: MUTED, align })
      }
      flow.y += 3 * MM
      hline(flow.page, MARGIN, MARGIN + CONTENT_WIDTH, flow.y)
      flow.y += 1 * MM
    }
    head()
    plan.questionOrder.forEach((original, position) => {
      if (flow.y + row > flow.bottom) {
        flow.newPage()
        head()
      }
      const q = a.questions[original]
      const y = flow.y + 4.2 * MM
      text(flow.page, fonts, String(position + 1), cols.q, y, { font: fonts.bold, size: 10 })
      const answer = memo[position]
      text(flow.page, fonts, answer === null ? 'Not set' : letter(answer), cols.answer, y, {
        font: answer === null ? fonts.italic : fonts.bold,
        size: answer === null ? 9 : 11,
      })
      text(flow.page, fonts, String(q.marks), cols.marks, y, { size: 10 })
      text(flow.page, fonts, fit(fonts.regular, q.topic, 10, cols.orig - cols.topic - 22 * MM), cols.topic, y, {
        size: 10,
      })
      if (versioned)
        text(flow.page, fonts, String(original + 1), cols.orig, y, { size: 10, color: MUTED, align: 'right' })
      flow.y += row
      hline(flow.page, MARGIN, MARGIN + CONTENT_WIDTH, flow.y, 0.3)
    })
  }
  footers(doc, fonts, `${a.title} memo`)
  return doc.save()
}
