// Annexure J1, the pre-assessment moderation tool, as an A4 page that matches the official form.
// Comments make their rows taller, and the form runs on to a second page when it has to.
import type { PDFDocument } from 'pdf-lib'
import { newDocument } from '../../shared/pdf/layout'
import {
  FORMS,
  J1_DECISIONS,
  J1_LEAD,
  J1_NOTE,
  J1_QUESTION,
  J1_SECTIONS,
  commentKey,
  showDate,
  type Values,
} from '../core/forms'
import {
  BLACK,
  ROW,
  Sheet,
  circle,
  drawLogo,
  drawRow,
  embedLogo,
  measureRow,
  pageNumbers,
  ruledField,
  titleBox,
  type Cell,
} from './kit'

const A4: [number, number] = [595.28, 841.89]
const COLS = { no: 27, criterion: 255, comments: 259 }
/** The criteria tables are set in 10 point, as the official form is. */
const BODY = { ...ROW, size: 10, leading: 1.2, padY: 1.2 }

export async function buildJ1(values: Values, logoData: string | null = null): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(FORMS.j1.title)
  const logo = await embedLogo(doc, logoData)
  const sheet = new Sheet(doc, fonts, A4, { left: 30, right: 24.28, top: 36, bottom: 34 })
  const page = sheet.page
  const v = (key: string) => (values[key] ?? '').trim()

  drawLogo(page, logo, 30, 30, 190, 64)
  const annexure = v('annexure') || FORMS.j1.annexure
  page.drawText(annexure, {
    x: 540 - fonts.bold.widthOfTextAtSize(annexure, 10.5),
    y: A4[1] - 58,
    size: 10.5,
    font: fonts.bold,
    color: BLACK,
  })
  titleBox(page, fonts, 222, 85, 352, 30, [{ text: 'PRE-ASSESSMENT MODERATION TOOL', size: 13.5 }])

  const end = ruledField(page, fonts, 39, 150, 'NAME OF CENTRE/SCHOOL:', v('school'), 176, 10.5)
  ruledField(page, fonts, end + 5, 150, 'DISTRICT:', v('district'), 82, 10.5)

  sheet.y = 160
  sheet.row(
    [
      { width: 58, text: 'Subject', bold: true, size: 10.5 },
      { width: 140, text: v('subject'), size: 10, oneLine: true },
      { width: 198, text: 'Name of DH/Subject Specialist', bold: true, size: 10.5 },
      { width: 145, text: v('specialist'), size: 10, oneLine: true },
    ],
    { ...ROW, padY: 3, minHeight: 21 },
  )
  sheet.gap(1)
  sheet.text(J1_NOTE, { size: 8.5, bold: true, indent: 6 })

  const row = (no: string, text: string, comment: string): Cell[] => [
    { width: COLS.no, text: no },
    { width: COLS.criterion, text },
    { width: COLS.comments, text: comment },
  ]
  J1_SECTIONS.forEach((section, s) => {
    const first = row(section.rows[0]!.no, section.rows[0]!.text, v(commentKey(s, 0)))
    if (s === 0) {
      sheet.gap(9)
      sheet.text(section.title, { size: 8.5, bold: true, indent: 44, keep: 60 })
      sheet.gap(8)
      sheet.text(J1_LEAD, { size: 8.5, indent: 6, keep: 40 })
      sheet.row(
        [
          { width: COLS.no, text: '' },
          { width: COLS.criterion, text: 'Criterion', bold: true },
          { width: COLS.comments, text: 'Comments', bold: true },
        ],
        BODY,
      )
    } else {
      sheet.text(section.title, {
        size: 9,
        bold: true,
        indent: 44,
        keep: measureRow(fonts, first, BODY),
        leading: 1.16,
      })
    }
    section.rows.forEach((criterion, i) => sheet.row(row(criterion.no, criterion.text, v(commentKey(s, i))), BODY))
  })

  // The decision and the signatures stay together.
  const decision: Cell[] = [
    { width: 270, text: J1_QUESTION },
    { width: 40, text: 'YES', bold: true },
    { width: 31, text: 'NO', bold: true },
    {
      width: 200,
      text: `**Date of resubmission:** ${showDate(v('resubmission'))}`,
      markup: true,
    },
  ]
  sheet.gap(10)
  sheet.ensure(measureRow(fonts, decision) + 74)
  const top = sheet.y
  const height = drawRow(sheet.page, fonts, sheet.left, top, decision)
  sheet.y += height
  const baseline = top + ROW.padY + 9 * 0.86 + (9 * ROW.leading - 9) / 2
  if (v('meets') === 'yes') {
    circle(sheet.page, sheet.left + 270 + ROW.padX, baseline, fonts.bold.widthOfTextAtSize('YES', 9), 9)
  }
  if (v('meets') === 'no') {
    circle(sheet.page, sheet.left + 310 + ROW.padX, baseline, fonts.bold.widthOfTextAtSize('NO', 9), 9)
  }

  sheet.gap(22)
  let x = 38
  J1_DECISIONS.forEach((d, i) => {
    const word = i === 0 ? d.word : `/${d.word}`
    const slash = i === 0 ? 0 : fonts.bold.widthOfTextAtSize('/', 11)
    const w = fonts.bold.widthOfTextAtSize(word, 11)
    sheet.page.drawText(word, { x, y: A4[1] - sheet.y, size: 11, font: fonts.bold, color: BLACK })
    if (v('decision') === d.id) circle(sheet.page, x + slash, sheet.y, w - slash, 11)
    x += w
  })
  sheet.page.drawText('(Circle whichever is applicable)', {
    x: 38,
    y: A4[1] - sheet.y - 12,
    size: 8,
    font: fonts.bold,
    color: BLACK,
  })
  sheet.gap(32)
  const a = ruledField(sheet.page, fonts, 38, sheet.y, 'Name of Moderator:', v('moderator'), 122, 10.5)
  const b = ruledField(sheet.page, fonts, a + 5, sheet.y, 'Signature:', '', 100, 10.5)
  ruledField(sheet.page, fonts, b + 5, sheet.y, 'Date:', showDate(v('date')), 112, 10.5)

  pageNumbers(doc as PDFDocument, fonts, 24)
  return doc.save()
}
