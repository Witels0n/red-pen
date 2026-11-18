// Annexure J2, the post assessment moderation tool, as A4 pages that match the official form.
// Rows grow with their comments and the pages break between rows.
import { newDocument } from '../../shared/pdf/layout'
import {
  FORMS,
  J2_LEARNERS_LINE,
  J2_LEVELS,
  J2_MODERATORS,
  J2_OVERALL,
  J2_POOR_AFTER,
  J2_POOR_COLUMNS,
  J2_POOR_MIN,
  J2_POOR_ROWS,
  J2_POOR_TITLE,
  J2_SECTIONS,
  J3_LEARNERS,
  commentKey,
  showDate,
  type Values,
} from '../core/forms'
import {
  BLACK,
  LIGHT,
  ROW,
  SILVER,
  Sheet,
  circle,
  drawLine,
  drawLogo,
  embedLogo,
  measureRow,
  pageNumbers,
  strokeRect,
  titleBox,
  wrapText,
  type Cell,
} from './kit'

const A4: [number, number] = [595.28, 841.89]
const WIDTH = 547
const INDICATOR = 228
const BODY = { ...ROW, size: 9.5, leading: 1.22, padY: 1.4 }

export async function buildJ2(values: Values, logoData: string | null = null): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(FORMS.j2.title)
  const logo = await embedLogo(doc, logoData)
  const sheet = new Sheet(doc, fonts, A4, { left: 22, right: 26.28, top: 36, bottom: 36 })
  const v = (key: string) => (values[key] ?? '').trim()
  const H = A4[1]

  drawLogo(sheet.page, logo, 32, 30, 190, 64)
  const annexure = v('annexure') || FORMS.j2.annexure
  sheet.page.drawText(annexure, {
    x: 548 - fonts.bold.widthOfTextAtSize(annexure, 10.5),
    y: H - 56,
    size: 10.5,
    font: fonts.bold,
    color: BLACK,
  })
  titleBox(sheet.page, fonts, 34, 94, 529, 28, [{ text: 'POST ASSESSMENT MODERATION TOOL', size: 13 }])

  // The details block, in its heavy double frame.
  const details: [string, string][] = [
    ['NAME OF SCHOOL', v('school')],
    ['DISTRICT', v('district')],
    ['SUBJECT', v('subject')],
    ['GRADE', v('grade')],
    ['TASK MODERATED', v('task')],
    ['NAME OF MODERATOR', v('moderator')],
  ]
  sheet.y = 135
  const top = sheet.y
  for (const [label, value] of details) {
    sheet.row(
      [
        { width: 116, text: label, bold: true, size: 9.5 },
        { width: 415, text: value, size: 10, valign: 'middle' },
      ],
      { ...ROW, minHeight: 27, padY: 2.5 },
      24,
    )
  }
  strokeRect(sheet.page, 19.5, top - 4.5, 540, sheet.y - top + 9, 2.2)
  strokeRect(sheet.page, 23, top - 1, 533, sheet.y - top + 2, 0.9)

  const heading = (title: string, keep: number): void => {
    sheet.gap(15)
    sheet.text(title, { size: 9.5, bold: true, indent: 14, keep })
    sheet.gap(0.5)
  }
  const indicatorRow = (s: number, i: number): Cell[] => {
    const criterion = J2_SECTIONS[s]!.rows[i]!
    return [
      { width: INDICATOR, text: criterion.text, label: criterion.no, hang: 16, markup: true },
      { width: WIDTH - INDICATOR, text: v(commentKey(s, i)) },
    ]
  }

  J2_SECTIONS.forEach((section, s) => {
    heading(section.title, measureRow(fonts, indicatorRow(s, 0), BODY) + (s === 0 ? 16 : 0))
    if (s === 0) {
      sheet.row(
        [
          { width: INDICATOR, text: 'Quality Indicators', bold: true },
          { width: WIDTH - INDICATOR, text: 'Comment in FULL sentence', bold: true },
        ],
        BODY,
      )
    }
    section.rows.forEach((_, i) => sheet.row(indicatorRow(s, i), BODY))

    if (s === J2_POOR_AFTER) {
      const widths = [78, 142, 117, WIDTH - 337]
      sheet.gap(15)
      sheet.text(J2_POOR_TITLE, { size: 9.5, bold: true, indent: 14, keep: 70 })
      sheet.gap(0.5)
      sheet.row(
        J2_POOR_COLUMNS.map((c, k) => ({ width: widths[k]!, text: c.head, bold: true, fill: LIGHT })),
        BODY,
      )
      let used = 0
      for (let r = 1; r <= J2_POOR_ROWS; r++) {
        if (J2_POOR_COLUMNS.some((c) => v(`p${r}.${c.key}`) !== '')) used = r
      }
      for (let r = 1; r <= Math.max(J2_POOR_MIN, used); r++) {
        sheet.row(
          J2_POOR_COLUMNS.map((c, k) => ({ width: widths[k]!, text: v(`p${r}.${c.key}`) })),
          { ...BODY, minHeight: 29 },
        )
      }
    }
  })

  // Overall impression: three columns, ruled for handwriting when nothing was typed.
  const third = WIDTH / 3
  const overall: Cell[] = J2_OVERALL.map((c) => ({ width: third, text: v(c.key) }))
  const overallStyle = { ...BODY, minHeight: 128, padY: 3 }
  sheet.gap(15)
  sheet.text('OVERALL IMPRESSION BY THE MODERATOR', {
    size: 9.5,
    bold: true,
    indent: 14,
    keep: measureRow(fonts, overall, overallStyle) + 22,
  })
  sheet.gap(4)
  sheet.row(
    J2_OVERALL.map((c) => ({ width: third, text: c.head, bold: true, align: 'center' as const, size: 10 })),
    BODY,
  )
  const overallTop = sheet.y
  sheet.row(overall, overallStyle)
  if (overall.every((c) => c.text === '')) {
    for (let line = 1; line < 8; line++) {
      const y = overallTop + line * 16
      sheet.page.drawLine({
        start: { x: sheet.left, y: H - y },
        end: { x: sheet.left + WIDTH, y: H - y },
        thickness: 0.5,
        color: BLACK,
        dashArray: [2.5, 1.5],
      })
    }
  }

  // The learners, with the level of moderation circled.
  sheet.gap(13)
  const lines = wrapText(fonts, J2_LEARNERS_LINE, WIDTH - 20, { size: 10, bold: true })
  sheet.ensure(lines.length * 11.5 + J3_LEARNERS * 18 + 4)
  for (const line of lines) {
    const baseline = sheet.y + 9
    drawLine(sheet.page, line, sheet.left + 12, baseline, 10)
    let x = sheet.left + 12
    for (const piece of line.pieces) {
      const word = piece.text.replace(/[,.]$/, '')
      if ((J2_LEVELS as readonly string[]).includes(word) && v('level') === word) {
        circle(sheet.page, x, baseline, fonts.bold.widthOfTextAtSize(word, 10), 10)
      }
      x += piece.width
    }
    sheet.y += 11.5
  }
  sheet.gap(1)
  for (let i = 1; i <= J3_LEARNERS; i++) {
    sheet.row(
      [
        { width: 36, text: `${i}.`, bold: true, valign: 'middle' },
        { width: WIDTH - 44, text: v(`l${i}`), size: 10, valign: 'middle', oneLine: true },
      ],
      { ...BODY, minHeight: 18 },
      sheet.left + 8,
    )
  }

  sheet.gap(13)
  const cols = [135, 150, 143, WIDTH - 434]
  sheet.ensure(4 * 17)
  sheet.row(
    ['MODERATORS', 'NAME', 'SIGNATURES', 'DATE'].map((text, k) => ({
      width: cols[k]!,
      text,
      bold: true,
      fill: SILVER,
      size: 10,
    })),
    { ...BODY, minHeight: 16 },
    sheet.left + 6,
  )
  for (const m of J2_MODERATORS) {
    sheet.row(
      [
        { width: cols[0]!, text: m.label, size: 10 },
        { width: cols[1]!, text: v(`${m.key}.name`), size: 10, oneLine: true },
        { width: cols[2]!, text: '' },
        { width: cols[3]!, text: showDate(v(`${m.key}.date`)), size: 10, oneLine: true },
      ],
      { ...BODY, minHeight: 17 },
      sheet.left + 6,
    )
  }

  pageNumbers(doc, fonts, 26)
  return doc.save()
}
