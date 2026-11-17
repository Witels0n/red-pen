// The question booklet for one Version (with pictures), and the Memo for every Version.
import type { PDFImage, PDFPage } from 'pdf-lib'
import type { SheetVersion } from '../../shared/omr/types'
import { imageBytes } from '../core/images'
import { letter, marksText, optionImage, topicsOf, totalMarks, type Assessment, type VersionPlan } from '../core/model'
import { keepsOptionOrder, planFor, printedMemo } from '../core/versions'
import { layoutBooklet, type BookletQuestion } from './booklet-layout'
import {
  A4_HEIGHT,
  A4_WIDTH,
  CONTENT_WIDTH,
  fit,
  Flow,
  footers,
  hline,
  MARGIN,
  MM,
  MUTED,
  newDocument,
  text,
  wrap,
} from '../../shared/pdf/layout'

/** The booklet's questions in a Version's order, with their options in that Version's order. */
export function bookletQuestions(a: Assessment, plan: VersionPlan): BookletQuestion[] {
  return plan.questionOrder.map((original, position) => {
    const q = a.questions[original]
    return {
      number: position + 1,
      marks: q.marks === 1 ? '' : `(${marksText(q.marks)})`,
      text: q.text,
      image: q.image ?? null,
      options: plan.optionOrder[position].map((o) => ({ text: q.options[o], image: optionImage(q, o) })),
    }
  })
}

/** A question booklet for one Version: questions, options and pictures in that Version's order. */
export async function renderBookletPdf(a: Assessment, version: SheetVersion): Promise<Uint8Array> {
  const plan = planFor(a, version)
  if (!plan) throw new Error(`This assessment has no Version ${version}.`)
  const { doc, fonts } = await newDocument(`${a.title}, Version ${version}`)
  const versioned = a.versions.count > 1

  const header = (page: PDFPage) => {
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
  }

  // Title block on the first page.
  const first = doc.addPage([A4_WIDTH, A4_HEIGHT])
  let y = header(first)
  const titleLines = wrap(fonts.bold, a.title, 18, CONTENT_WIDTH)
  for (const line of titleLines) {
    text(first, fonts, line, MARGIN, y + 14, { font: fonts.bold, size: 18 })
    y += 18 * 1.25
  }
  const details = [
    `${a.questions.length} question${a.questions.length === 1 ? '' : 's'}`,
    `${marksText(totalMarks(a.questions))}`,
    ...(versioned ? [`Version ${version}`] : []),
  ].join('   |   ')
  text(first, fonts, details, MARGIN, y + 6, { size: 10, color: MUTED })
  y += 8 * MM
  const instructions = wrap(
    fonts.italic,
    versioned
      ? 'Answer every question on your answer sheet: fill the circle for the answer you choose. Make sure the Version on your answer sheet matches this booklet.'
      : 'Answer every question on your answer sheet: fill the circle for the answer you choose.',
    9.5,
    CONTENT_WIDTH,
  )
  for (const line of instructions) {
    text(first, fonts, line, MARGIN, y + 8, { font: fonts.italic, size: 9.5, color: MUTED })
    y += 9.5 * 1.35
  }
  y += 6 * MM

  const layout = layoutBooklet(
    bookletQuestions(a, plan),
    { left: MARGIN, width: CONTENT_WIDTH, firstTop: y, top: 26 * MM, bottom: A4_HEIGHT - 20 * MM },
    (s, size, width) => wrap(fonts.regular, s, size, width),
  )
  const pages = [first]
  while (pages.length < layout.pages) {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
    header(page)
    pages.push(page)
  }

  // Each picture is embedded once, however often it is drawn.
  const embedded = new Map<string, PDFImage>()
  const embed = async (src: string): Promise<PDFImage> => {
    let image = embedded.get(src)
    if (!image) {
      const { type, bytes } = imageBytes({ src })
      image = type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      embedded.set(src, image)
    }
    return image
  }
  for (const p of layout.placed) {
    const page = pages[p.page]
    if (p.kind === 'text') {
      text(page, fonts, p.text, p.x, p.y, {
        font: p.bold ? fonts.bold : fonts.regular,
        size: p.size,
        ...(p.muted ? { color: MUTED } : {}),
        ...(p.align ? { align: p.align } : {}),
      })
    } else {
      const q = a.questions[plan.questionOrder[p.question]]
      const source = p.option === null ? q.image : optionImage(q, plan.optionOrder[p.question][p.option])
      if (!source) continue
      page.drawImage(await embed(source.src), {
        x: p.x,
        y: page.getHeight() - p.y - p.height,
        width: p.width,
        height: p.height,
      })
    }
  }

  footers(doc, fonts, versioned ? `${a.title}, Version ${version}` : a.title)
  return doc.save()
}

/** One column of the Memo table: its title, where it sits, and the text per printed question. */
export interface MemoColumn {
  key: 'q' | 'answer' | 'entered' | 'marks' | 'topic' | 'original'
  title: string
  cells: string[]
}

/**
 * The Memo for one Version as a table. "Entered as" (the letter in the teacher's own order) shows
 * when the options print in another order; the Topic column only when the Assessment has Topics;
 * "Original Q" only with more than one Version.
 */
export function memoTable(a: Assessment, plan: VersionPlan): MemoColumn[] {
  const memo = printedMemo(a, plan)
  const questions = plan.questionOrder.map((o) => a.questions[o])
  const columns: MemoColumn[] = [
    { key: 'q', title: 'Q', cells: questions.map((_, p) => String(p + 1)) },
    { key: 'answer', title: 'Answer', cells: memo.map((m) => (m === null ? 'Not set' : letter(m))) },
  ]
  if (!keepsOptionOrder(plan))
    columns.push({
      key: 'entered',
      title: 'Entered as',
      cells: questions.map((q) => (q.answer === null ? '' : letter(q.answer))),
    })
  columns.push({ key: 'marks', title: 'Marks', cells: questions.map((q) => String(q.marks)) })
  if (topicsOf(a.questions).length)
    columns.push({ key: 'topic', title: 'Topic', cells: questions.map((q) => q.topic.trim()) })
  if (a.versions.count > 1)
    columns.push({ key: 'original', title: 'Original Q', cells: plan.questionOrder.map((o) => String(o + 1)) })
  return columns
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
    flow.y += 6 * MM
    const columns = memoTable(a, plan)
    if (columns.some((c) => c.key === 'entered')) {
      const note = wrap(
        fonts.italic,
        'The options are printed in a shuffled order. Answer is the letter on the printed paper; Entered as is the letter you typed in Build.',
        9,
        CONTENT_WIDTH,
      )
      for (const line of note) {
        text(flow.page, fonts, line, MARGIN, flow.y + 4, { font: fonts.italic, size: 9, color: MUTED })
        flow.y += 9 * 1.35
      }
    }
    flow.y += 3 * MM

    const x: Record<MemoColumn['key'], number> = {
      q: MARGIN,
      answer: MARGIN + 14 * MM,
      entered: MARGIN + 30 * MM,
      marks: MARGIN + (columns.some((c) => c.key === 'entered') ? 52 : 30) * MM,
      topic: MARGIN + (columns.some((c) => c.key === 'entered') ? 70 : 50) * MM,
      original: MARGIN + CONTENT_WIDTH,
    }
    const row = 6 * MM
    const head = () => {
      for (const c of columns) {
        text(flow.page, fonts, c.title, x[c.key], flow.y + 4, {
          font: fonts.bold,
          size: 9,
          color: MUTED,
          align: c.key === 'original' ? 'right' : 'left',
        })
      }
      flow.y += 3 * MM
      hline(flow.page, MARGIN, MARGIN + CONTENT_WIDTH, flow.y)
      flow.y += 1 * MM
    }
    head()
    plan.questionOrder.forEach((_, position) => {
      if (flow.y + row > flow.bottom) {
        flow.newPage()
        head()
      }
      const y = flow.y + 4.2 * MM
      for (const c of columns) {
        const cell = c.cells[position]
        if (c.key === 'answer') {
          const unset = cell === 'Not set'
          text(flow.page, fonts, cell, x.answer, y, { font: unset ? fonts.italic : fonts.bold, size: unset ? 9 : 11 })
        } else if (c.key === 'q') text(flow.page, fonts, cell, x.q, y, { font: fonts.bold, size: 10 })
        else if (c.key === 'topic')
          text(flow.page, fonts, fit(fonts.regular, cell, 10, x.original - x.topic - 22 * MM), x.topic, y, { size: 10 })
        else if (c.key === 'original')
          text(flow.page, fonts, cell, x.original, y, { size: 10, color: MUTED, align: 'right' })
        else text(flow.page, fonts, cell, x[c.key], y, { size: 10, ...(c.key === 'entered' ? { color: MUTED } : {}) })
      }
      flow.y += row
      hline(flow.page, MARGIN, MARGIN + CONTENT_WIDTH, flow.y, 0.3)
    })
  }
  footers(doc, fonts, `${a.title} memo`)
  return doc.save()
}
