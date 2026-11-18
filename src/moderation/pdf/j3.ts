// Annexure J3, the evidence of school moderation for up to six tasks, as one landscape A4 page
// that matches the official form.
import type { PDFPage } from 'pdf-lib'
import { newDocument, type Fonts } from '../../shared/pdf/layout'
import { FORMS, J3_FOOTNOTE, J3_LEARNERS, J3_MODERATIONS, ORDINALS, showDate, type Values } from '../core/forms'
import {
  BLACK,
  GREY,
  drawLine,
  drawLogo,
  drawRow,
  embedLogo,
  fitted,
  strokeRect,
  titleBox,
  wrapText,
  type Cell,
  type Line,
  type RowStyle,
} from './kit'

const PAGE: [number, number] = [841.89, 595.28]
const LEFT = 22
const WIDTH = 796
const LABEL = 94
const NUMBER = 20
const HEAD = LABEL + NUMBER
const COL = (WIDTH - HEAD) / J3_MODERATIONS
const STYLE: RowStyle = { size: 8.5, leading: 1.2, padX: 3, padY: 2, minHeight: 15, border: 0.6 }
/** The most lines a comment may take, so the form always stays on one page. */
const MAX_COMMENT_LINES = 5
const MAX_RECORD_LINES = 3

/** Bold lines centred in a grey block that spans several rows. */
function block(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  y: number,
  w: number,
  h: number,
  lines: string[],
  size: number,
): void {
  strokeRect(page, x, y, w, h, STYLE.border, GREY)
  const lead = size * 1.25
  let at = y + (h - lines.length * lead) / 2 + size * 0.95
  for (const text of lines) {
    page.drawText(text, { x: x + STYLE.padX, y: page.getHeight() - at, size, font: fonts.bold, color: BLACK })
    at += lead
  }
}

function capped(lines: Line[], max: number, fonts: Fonts, size: number): Line[] {
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  const last = kept[max - 1]!
  const dots = fonts.regular.widthOfTextAtSize('...', size)
  kept[max - 1] = {
    pieces: [...last.pieces, { text: '...', font: fonts.regular, width: dots }],
    width: last.width + dots,
  }
  return kept
}

export async function buildJ3(values: Values, logoData: string | null = null): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(FORMS.j3.title)
  const logo = await embedLogo(doc, logoData)
  const page = doc.addPage(PAGE)
  const H = PAGE[1]
  const v = (key: string) => (values[key] ?? '').trim()
  const colX = (m: number) => LEFT + HEAD + m * COL

  // The stamp box, the annexure label, the logo and the title.
  strokeRect(page, 583, 10, 75, 34, 0.7)
  page.drawText('District', {
    x: 583 + (75 - fonts.regular.widthOfTextAtSize('District', 7)) / 2,
    y: H - 21,
    size: 7,
    font: fonts.regular,
    color: BLACK,
  })
  const annexure = v('annexure') || FORMS.j3.annexure
  page.drawText(annexure, {
    x: 780 - fonts.bold.widthOfTextAtSize(annexure, 10.5),
    y: H - 42,
    size: 10.5,
    font: fonts.bold,
    color: BLACK,
  })
  drawLogo(page, logo, 108, 46, 190, 58)
  const grade = v('grade') || '12'
  const year = v('year')
  titleBox(page, fonts, 330, 54, 492, 46, [
    { text: 'EVIDENCE OF SCHOOL MODERATION', size: 15 },
    { text: `SCHOOL- BASED ASSESSMENT GRADE ${grade}${year ? ` - ${year}` : ''}`, size: 11.5 },
  ])

  let y = 112
  const row = (cells: Cell[], style: RowStyle = STYLE): number => {
    const h = drawRow(page, fonts, LEFT, y, cells, style)
    y += h
    return h
  }
  const grey = (width: number, text: string, extra: Partial<Cell> = {}): Cell => ({
    width,
    text,
    bold: true,
    fill: GREY,
    oneLine: true,
    valign: 'middle',
    ...extra,
  })
  const value = (width: number, text: string, extra: Partial<Cell> = {}): Cell => ({
    width,
    text,
    oneLine: true,
    valign: 'middle',
    ...extra,
  })

  row([
    grey(HEAD, 'SUBJECT'),
    value(2 * COL, v('subject')),
    grey(52, 'GRADE', { align: 'center' }),
    value(96, v('grade')),
    grey(156, 'NAME OF TEACHER', { align: 'center' }),
    value(WIDTH - HEAD - 2 * COL - 304, v('teacher')),
  ])
  row([
    grey(HEAD, 'NAME OF SCHOOL'),
    value(310, v('school')),
    grey(212, 'NAME OF LEAD/SENIOR TEACHER /HOD'),
    value(WIDTH - HEAD - 522, v('hod')),
  ])

  // The six moderations and their dates.
  const datesTop = y
  const datesH = 30
  block(page, fonts, LEFT, datesTop, HEAD, datesH, ['DATES OF', 'MODERATION'], 8.5)
  for (let m = 0; m < J3_MODERATIONS; m++) {
    const x = colX(m)
    strokeRect(page, x, datesTop, COL, datesH, STYLE.border)
    const n = String(m + 1)
    const rest = ' MODERATION'
    const wn = fonts.bold.widthOfTextAtSize(n, 8.5)
    const ws = fonts.bold.widthOfTextAtSize(ORDINALS[m]!, 5.5)
    const wr = fonts.bold.widthOfTextAtSize(rest, 8.5)
    let at = x + (COL - wn - ws - wr) / 2
    page.drawText(n, { x: at, y: H - datesTop - 11, size: 8.5, font: fonts.bold, color: BLACK })
    at += wn
    page.drawText(ORDINALS[m]!, { x: at, y: H - datesTop - 8, size: 5.5, font: fonts.bold, color: BLACK })
    at += ws
    page.drawText(rest, { x: at, y: H - datesTop - 11, size: 8.5, font: fonts.bold, color: BLACK })
    const date = fitted(fonts, showDate(v(`m${m + 1}.date`), true) || year, COL - 8, { size: 8.5, bold: true })
    drawLine(page, date.line, x + COL - 4 - date.line.width, datesTop + 25, date.size)
  }
  y += datesH

  row([
    grey(HEAD, 'TASK MODERATED'),
    ...Array.from({ length: J3_MODERATIONS }, (_, m) => value(COL, v(`m${m + 1}.task`))),
  ])

  // Learners' names, one row each.
  const learnersTop = y
  for (let l = 1; l <= J3_LEARNERS; l++) {
    row(
      [
        { width: LABEL, open: true },
        grey(NUMBER, String(l), { align: 'right' }),
        ...Array.from({ length: J3_MODERATIONS }, (_, m) => value(COL, v(`m${m + 1}.l${l}`))),
      ],
      { ...STYLE, minHeight: 15.5 },
    )
  }
  block(page, fonts, LEFT, learnersTop, LABEL, y - learnersTop, ['NAME OF', 'LEARNERS'], 8.5)

  // Pre-moderation: a date and comments per task. The row grows with the longest comment.
  const small = 7.5
  const lead = small * 1.22
  const inner = COL - 2 * STYLE.padX
  const dateLabel = fonts.bold.widthOfTextAtSize('DATE: ', small)
  const comments = Array.from({ length: J3_MODERATIONS }, (_, m) => {
    const text = v(`m${m + 1}.comments`)
    const lines = wrapText(fonts, `**COMMENTS:** ${text}`, inner, { size: small, markup: true })
    return capped(lines, MAX_COMMENT_LINES, fonts, small)
  })
  const preH = Math.max(38, (1 + Math.max(...comments.map((c) => c.length))) * lead + 6)
  const preTop = y
  block(page, fonts, LEFT, preTop, HEAD, preH, ['DATE OF PRE-', 'MODERATION OF TASK', '& COMMENTS'], 7.2)
  comments.forEach((lines, m) => {
    const x = colX(m)
    strokeRect(page, x, preTop, COL, preH, STYLE.border)
    page.drawText('DATE: ', {
      x: x + STYLE.padX,
      y: H - preTop - 3 - small,
      size: small,
      font: fonts.bold,
      color: BLACK,
    })
    const date = fitted(fonts, showDate(v(`m${m + 1}.premod`), true), inner - dateLabel, { size: small })
    drawLine(page, date.line, x + STYLE.padX + dateLabel, preTop + 3 + small, date.size)
    lines.forEach((line, i) => drawLine(page, line, x + STYLE.padX, preTop + 3 + small + (i + 1) * lead, small))
  })
  y += preH

  // Correctness of the record sheet.
  const records = Array.from({ length: J3_MODERATIONS }, (_, m) =>
    capped(wrapText(fonts, v(`m${m + 1}.record`), inner, { size: small }), MAX_RECORD_LINES, fonts, small),
  )
  const recordH = Math.max(30, Math.max(...records.map((r) => r.length)) * lead + 7)
  block(page, fonts, LEFT, y, HEAD, recordH, ['CORRECTNESS OF', 'RECORD SHEET'], 8.5)
  records.forEach((lines, m) => {
    strokeRect(page, colX(m), y, COL, recordH, STYLE.border)
    lines.forEach((line, i) => drawLine(page, line, colX(m) + STYLE.padX, y + 3 + small + i * lead, small))
  })
  y += recordH

  // Marks from the teacher and the HOD for each learner.
  const teacherW = COL * 0.68
  const hodW = COL - teacherW
  const marksTop = y
  row(
    [
      { width: HEAD, open: true },
      ...Array.from({ length: J3_MODERATIONS }, () => [
        { width: teacherW, text: 'TEACHER', bold: true, align: 'center' as const, valign: 'middle' as const },
        { width: hodW, text: 'HOD', bold: true, align: 'center' as const, valign: 'middle' as const },
      ]).flat(),
    ],
    { ...STYLE, minHeight: 22 },
  )
  for (let l = 1; l <= J3_LEARNERS; l++) {
    row(
      [
        { width: LABEL, open: true },
        grey(NUMBER, String(l), { align: 'right' }),
        ...Array.from({ length: J3_MODERATIONS }, (_, m) => [
          value(teacherW, v(`m${m + 1}.t${l}`), { align: 'center' }),
          value(hodW, v(`m${m + 1}.h${l}`), { align: 'center' }),
        ]).flat(),
      ],
      { ...STYLE, minHeight: 15.5 },
    )
  }
  // One grey block behind the label and the corner above the numbers.
  page.drawRectangle({ x: LEFT, y: H - marksTop - 22, width: HEAD, height: 22, color: GREY })
  block(page, fonts, LEFT, marksTop, LABEL, y - marksTop, ['MARK', 'AWARDED'], 8.5)
  strokeRect(page, LEFT + LABEL, marksTop, NUMBER, 22, STYLE.border, GREY)

  // Signatures, left empty to sign by hand.
  const signTop = y
  for (const who of ['TEACHER', 'HOD']) {
    row([
      { width: HEAD, open: true },
      ...Array.from({ length: J3_MODERATIONS }, () => ({
        width: COL,
        text: who,
        bold: true,
        valign: 'middle' as const,
      })),
    ])
  }
  block(page, fonts, LEFT, signTop, HEAD, y - signTop, ['SIGNATURES'], 8.5)

  const note = fitted(fonts, J3_FOOTNOTE, WIDTH, { size: 8.5, bold: true })
  drawLine(page, note.line, LEFT + WIDTH - note.line.width, y + 10, note.size)
  return doc.save()
}
