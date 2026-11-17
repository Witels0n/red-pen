// The one-page PDF for the HoD: paper details, totals, marks per level and per topic against
// targets (with bars), the level by topic matrix, the questions, and lines to sign.
// pdf-lib with its standard fonts: nothing remote.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { DIFFICULTY_NAMES, formatNumber, gridTitle, type Grid } from './core/model'
import { flagText, summarise, type Share } from './core/summary'
import { TAXONOMY_NAMES } from './core/taxonomy'

const MM = 72 / 25.4
const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const MARGIN = 14 * MM
const CONTENT = A4_WIDTH - 2 * MARGIN
/** Space kept at the foot of the page for the signature lines. */
const SIGN_HEIGHT = 30 * MM

const INK = rgb(0.1, 0.12, 0.16)
const MUTED = rgb(0.38, 0.41, 0.46)
const RULE = rgb(0.8, 0.82, 0.85)
const SHADE = rgb(0.95, 0.96, 0.97)
const BAND = rgb(0.86, 0.88, 0.91)
const OK = rgb(0.16, 0.48, 0.23)
const OVER = rgb(0.83, 0.13, 0.18)
const UNDER = rgb(0.75, 0.5, 0)
const NEUTRAL = rgb(0.45, 0.48, 0.53)

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

const flagColour = (f: Share['flag']): RGB => (f === 'ok' ? OK : f === 'over' ? OVER : f === 'under' ? UNDER : NEUTRAL)

/** Keeps only characters the standard (WinAnsi) fonts can draw. */
const charsets = new WeakMap<PDFFont, Set<number>>()

function safe(font: PDFFont, s: string): string {
  let set = charsets.get(font)
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())))
  return [...s.replace(/\t/g, ' ').replace(/[\u2010-\u2015]/g, '-')]
    .filter((ch) => set.has(ch.codePointAt(0)!))
    .join('')
}

function fit(font: PDFFont, s: string, size: number, width: number): string {
  let t = safe(font, s)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1)
  return `${t.trimEnd()}...`
}

class Writer {
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
  ) {}

  text(
    s: string,
    x: number,
    y: number,
    o: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'right' | 'center'; width?: number } = {},
  ): void {
    const font = o.bold ? this.fonts.bold : this.fonts.regular
    const size = o.size ?? 9
    const t = o.width ? fit(font, s, size, o.width) : safe(font, s)
    const w = font.widthOfTextAtSize(t, size)
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
    this.page.drawText(t, { x: left, y: A4_HEIGHT - y, size, font, color: o.color ?? INK })
  }

  line(x1: number, x2: number, y: number, thickness = 0.5, color = RULE): void {
    this.page.drawLine({ start: { x: x1, y: A4_HEIGHT - y }, end: { x: x2, y: A4_HEIGHT - y }, thickness, color })
  }

  box(x: number, y: number, w: number, h: number, color: RGB): void {
    this.page.drawRectangle({ x, y: A4_HEIGHT - y - h, width: w, height: h, color })
  }

  heading(s: string, y: number): number {
    this.text(s, MARGIN, y + 10, { size: 10.5, bold: true })
    return y + 15
  }
}

/** A table of shares with a bar per row: the bar against its target and tolerance band. */
function shareTable(w: Writer, shares: Share[], heading: string, tolerance: number, y: number, rowH: number): number {
  const size = rowH < 11 ? 7 : 8
  const cols = {
    name: MARGIN,
    marks: MARGIN + 205,
    pct: MARGIN + 245,
    target: MARGIN + 285,
    check: MARGIN + 292,
    bar: MARGIN + 365,
  }
  const barW = MARGIN + CONTENT - cols.bar
  w.text(heading, cols.name, y + 8, { size, bold: true, color: MUTED })
  w.text('Marks', cols.marks, y + 8, { size, bold: true, color: MUTED, align: 'right' })
  w.text('%', cols.pct, y + 8, { size, bold: true, color: MUTED, align: 'right' })
  w.text('Target', cols.target, y + 8, { size, bold: true, color: MUTED, align: 'right' })
  w.text('Check', cols.check, y + 8, { size, bold: true, color: MUTED })
  y += 11
  w.line(MARGIN, MARGIN + CONTENT, y)
  const max = Math.min(100, Math.max(10, ...shares.map((s) => Math.max(s.percent, (s.target ?? 0) + tolerance))) + 5)
  const bx = (p: number) => cols.bar + (Math.max(0, Math.min(max, p)) / max) * barW
  shares.forEach((s, i) => {
    const top = y
    if (i % 2 === 1) w.box(MARGIN, top, CONTENT, rowH, SHADE)
    const base = top + rowH - (rowH - size) / 2 - 1
    w.text(s.name, cols.name + 2, base, { size, width: cols.marks - cols.name - 40 })
    w.text(formatNumber(s.marks, 2), cols.marks, base, { size, align: 'right' })
    w.text(`${formatNumber(s.percent)}%`, cols.pct, base, { size, align: 'right' })
    w.text(s.target === null ? '' : `${formatNumber(s.target)}%`, cols.target, base, { size, align: 'right' })
    w.text(flagText(s), cols.check, base, {
      size,
      bold: s.flag === 'over' || s.flag === 'under',
      color: flagColour(s.flag),
      width: cols.bar - cols.check - 4,
    })
    const barTop = top + rowH * 0.25
    const barH = rowH * 0.5
    if (s.target !== null)
      w.box(
        bx(s.target - tolerance),
        top + 1.5,
        Math.max(1, bx(s.target + tolerance) - bx(s.target - tolerance)),
        rowH - 3,
        BAND,
      )
    w.box(cols.bar, barTop, Math.max(0.5, bx(s.percent) - cols.bar), barH, flagColour(s.flag))
    if (s.target !== null) {
      const tx = bx(s.target)
      w.page.drawLine({
        start: { x: tx, y: A4_HEIGHT - top - 1 },
        end: { x: tx, y: A4_HEIGHT - top - rowH + 1 },
        thickness: 1,
        color: INK,
      })
    }
    y += rowH
  })
  w.line(MARGIN, MARGIN + CONTENT, y)
  return y + 8
}

export async function gridPdf(g: Grid): Promise<Uint8Array> {
  const s = summarise(g)
  const doc = await PDFDocument.create()
  doc.setTitle(`${gridTitle(g)}: question paper grid`)
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  doc.setLanguage('en-ZA')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  const w = new Writer(page, fonts)

  // Title and paper details.
  let y = MARGIN
  w.text('Question paper grid', MARGIN, y + 14, { size: 16, bold: true })
  w.text(gridTitle(g), MARGIN + CONTENT, y + 14, { size: 10, color: MUTED, align: 'right', width: CONTENT - 180 })
  y += 24
  const d = g.details
  const fields: [string, string][] = [
    ['Subject', d.subject],
    ['Grade', d.grade],
    ['Paper', d.paper],
    ['Date', d.date],
    ['Examiner', d.examiner],
    ['Moderator', d.moderator],
  ]
  const colW = CONTENT / 3
  fields.forEach(([label, value], i) => {
    const x = MARGIN + (i % 3) * colW
    const fy = y + Math.floor(i / 3) * 18
    w.text(label, x, fy + 7, { size: 7, color: MUTED })
    w.text(value, x, fy + 16, { size: 9.5, bold: true, width: colW - 8 })
    w.line(x, x + colW - 8, fy + 18.5)
  })
  y += 44

  const totalText =
    s.intended === null
      ? `Questions add up to ${formatNumber(s.total, 2)} marks.`
      : `Questions add up to ${formatNumber(s.total, 2)} of ${formatNumber(s.intended, 2)} marks${s.difference === 0 ? '.' : ` (${s.difference! > 0 ? '+' : ''}${formatNumber(s.difference!, 2)}).`}`
  w.text(totalText, MARGIN, y + 9, { size: 10, bold: true, color: s.difference ? OVER : INK })
  w.text(
    `${TAXONOMY_NAMES[g.taxonomy.id]}, tolerance ${formatNumber(g.tolerance)} percentage points`,
    MARGIN + CONTENT,
    y + 9,
    { size: 7.5, color: MUTED, align: 'right', width: CONTENT - 250 },
  )
  y += 18

  // Shares per level and per topic; rows shrink when there are many.
  const levels = s.levels.map((l, i) => (l.key ? { ...l, name: `${i + 1}: ${l.name}` } : l))
  const shareRowsCount = levels.length + s.topics.length
  const rowH = shareRowsCount > 22 ? 9 : shareRowsCount > 14 ? 10.5 : 12.5
  y = w.heading('Cognitive levels', y)
  y = shareTable(w, levels, 'Level', g.tolerance, y, rowH)
  if (s.topics.length > 0) {
    y = w.heading('Topics', y)
    y = shareTable(w, s.topics, 'Topic', g.tolerance, y, rowH)
  }

  // The level by topic matrix.
  const m = s.matrix
  if (m.topics.length > 0) {
    y = w.heading('Level by topic (marks)', y)
    const firstW = 120
    const cw = Math.min(70, (CONTENT - firstW) / (m.topics.length + 1))
    const size = cw < 34 ? 6 : 7.5
    const levelName = (id: string) => {
      const i = g.taxonomy.levels.findIndex((l) => l.id === id)
      return i < 0 ? 'No level' : `${i + 1}: ${g.taxonomy.levels[i].name}`
    }
    const cx = (i: number) => MARGIN + firstW + (i + 1) * cw - 2
    m.topics.forEach((t, i) =>
      w.text(t || 'No topic', cx(i), y + 8, { size, bold: true, color: MUTED, align: 'right', width: cw - 4 }),
    )
    w.text('Total', cx(m.topics.length), y + 8, { size, bold: true, color: MUTED, align: 'right' })
    y += 11
    w.line(MARGIN, MARGIN + firstW + (m.topics.length + 1) * cw, y)
    const mh = rowH - 1.5
    const row = (label: string, cells: number[], total: number, bold: boolean) => {
      const base = y + mh - 2.5
      w.text(label, MARGIN + 2, base, { size, bold, width: firstW - 6 })
      cells.forEach((c, i) =>
        w.text(c === 0 ? '0' : formatNumber(c, 2), cx(i), base, {
          size,
          bold,
          color: c === 0 ? MUTED : INK,
          align: 'right',
        }),
      )
      w.text(formatNumber(total, 2), cx(cells.length), base, { size, bold: true, align: 'right' })
      y += mh
    }
    m.levels.forEach((l, i) => row(levelName(l), m.cells[i], m.levelTotals[i], false))
    w.line(MARGIN, MARGIN + firstW + (m.topics.length + 1) * cw, y + 1)
    y += 1
    row('Total', m.topicTotals, s.total, true)
    y += 8
  }

  // Checks worth the HoD's attention.
  const notes = s.warnings.slice(0, 4)
  if (notes.length > 0) {
    y = w.heading('Checks', y)
    for (const n of notes) {
      w.text(`- ${n}`, MARGIN + 2, y + 8, { size: 8, color: OVER, width: CONTENT - 4 })
      y += 11
    }
    y += 4
  }

  // The questions, in as many columns as it takes to fit above the signature lines.
  const bottom = A4_HEIGHT - MARGIN - SIGN_HEIGHT
  const lineH = 9.5
  y = w.heading('Questions', y)
  const available = Math.max(lineH, bottom - y - 10)
  const perColumn = Math.max(1, Math.floor(available / lineH) - 1)
  const counted = new Set(s.numbering.counted.map((r) => r.id))
  const subtotals = new Map(s.numbering.sections.filter((x) => x.headingRowId).map((x) => [x.headingRowId!, x.marks]))
  const rows = g.rows.filter((r) => r.number.trim() || r.marks !== null)
  const columns = Math.min(4, Math.max(1, Math.ceil(rows.length / perColumn)))
  const shown = rows.slice(0, columns * perColumn - (rows.length > columns * perColumn ? 1 : 0))
  const qW = CONTENT / columns
  const levelShort = (id: string) => {
    const i = g.taxonomy.levels.findIndex((l) => l.id === id)
    return i < 0 ? '' : `L${i + 1}`
  }
  for (let c = 0; c < columns; c++) {
    const x = MARGIN + c * qW
    w.text('No.', x, y + 7, { size: 7, bold: true, color: MUTED })
    w.text('Marks', x + 50, y + 7, { size: 7, bold: true, color: MUTED, align: 'right' })
    w.text('Level', x + 56, y + 7, { size: 7, bold: true, color: MUTED })
    w.text('Topic', x + 80, y + 7, { size: 7, bold: true, color: MUTED })
  }
  const top = y + 9
  shown.forEach((r, i) => {
    const c = Math.floor(i / perColumn)
    const x = MARGIN + c * qW
    const ry = top + (i % perColumn) * lineH + lineH - 2
    const heading = !counted.has(r.id)
    const marks = heading ? subtotals.get(r.id) : r.marks
    w.text(r.number, x, ry, { size: 7.5, bold: heading, width: 34 })
    w.text(marks === undefined || marks === null ? '' : formatNumber(marks, 2), x + 50, ry, {
      size: 7.5,
      bold: heading,
      align: 'right',
    })
    if (!heading) {
      w.text(levelShort(r.level), x + 56, ry, { size: 7.5 })
      const extra = r.difficulty ? ` (${DIFFICULTY_NAMES[r.difficulty]})` : ''
      w.text(`${r.topic}${extra}`, x + 80, ry, { size: 7.5, width: qW - 84 })
    }
  })
  if (shown.length < rows.length) {
    const i = shown.length
    const x = MARGIN + (columns - 1) * qW
    w.text(
      `and ${rows.length - shown.length} more (see the Excel file)`,
      x,
      top + (i % perColumn) * lineH + lineH - 2,
      { size: 7, color: MUTED },
    )
  }

  // Signature lines.
  let sy = A4_HEIGHT - MARGIN - SIGN_HEIGHT + 12
  const signLine = (role: string, name: string) => {
    w.text(role, MARGIN, sy, { size: 8, bold: true })
    w.text(name, MARGIN + 52, sy, { size: 8, width: 140 })
    w.text('Signature', MARGIN + 200, sy, { size: 7, color: MUTED })
    w.line(MARGIN + 238, MARGIN + 390, sy + 1)
    w.text('Date', MARGIN + 400, sy, { size: 7, color: MUTED })
    w.line(MARGIN + 420, MARGIN + CONTENT, sy + 1)
    sy += 22
  }
  w.line(MARGIN, MARGIN + CONTENT, sy - 14, 0.75, INK)
  signLine('Examiner', d.examiner)
  signLine('Moderator', d.moderator)
  signLine('HoD', '')
  w.text('Made with Red Pen', MARGIN + CONTENT, A4_HEIGHT - MARGIN + 6, { size: 6.5, color: MUTED, align: 'right' })

  return doc.save()
}
