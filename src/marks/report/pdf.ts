// The one-page A4 report for the HoD, drawn with pdf-lib from the same chart model as the screen.
// No names unless the teacher ticks the box, which adds a page of learners below the pass mark.
import { rgb, type PDFDocument, type PDFPage, type RGB } from 'pdf-lib'
import {
  A4_HEIGHT,
  A4_WIDTH,
  box,
  CONTENT_WIDTH,
  encodable,
  fit,
  Flow,
  footers,
  hline,
  INK,
  MARGIN,
  MM,
  MUTED,
  newDocument,
  RULE,
  text,
  wrap,
  type Fonts,
} from '../../shared/pdf/layout'
import { hasNames, insightsFor, shown, type Analysis } from '../core/analysis'
import { needsSupport } from '../core/compare'
import { oneDp, pct } from '../core/stats'
import { bandChart, boxPlot, type Chart, type Role } from '../chart/model'

/** About this many characters fit in the comments box. */
export const COMMENTS_MAX = 600

/** Band charts are drawn as small multiples for up to this many assessments. */
export const MAX_BAND_CHARTS = 4

export interface ReportOptions {
  className?: string
  subject?: string
  date?: Date
  comments?: string
  /** Adds a page listing learners below the pass mark. */
  includeNames?: boolean
}

const INK_ROLES: Record<Role, RGB> = {
  bar: rgb(0.29, 0.4, 0.53),
  'bar-below': rgb(0.83, 0.13, 0.18),
  axis: rgb(0.35, 0.38, 0.43),
  grid: rgb(0.86, 0.88, 0.9),
  pass: rgb(0.1, 0.12, 0.16),
  label: INK,
  muted: MUTED,
  box: rgb(0.8, 0.86, 0.92),
  median: rgb(0.1, 0.12, 0.16),
  whisker: rgb(0.35, 0.38, 0.43),
  outlier: rgb(0.83, 0.13, 0.18),
}

/** Draws a chart model with its top-left corner at (x, top), y measured down the page, scaled by `s`. */
export function drawChart(page: PDFPage, fonts: Fonts, chart: Chart, x: number, top: number, s = 1): void {
  const H = page.getHeight()
  const X = (v: number) => x + v * s
  const Y = (v: number) => H - (top + v * s)
  for (const m of chart.marks) {
    const color = INK_ROLES[m.role]
    if (m.kind === 'rect') {
      page.drawRectangle({ x: X(m.x), y: Y(m.y + m.h), width: m.w * s, height: m.h * s, color })
      if (m.role === 'box')
        page.drawRectangle({
          x: X(m.x),
          y: Y(m.y + m.h),
          width: m.w * s,
          height: m.h * s,
          borderColor: INK_ROLES.whisker,
          borderWidth: 0.6,
        })
    } else if (m.kind === 'line') {
      page.drawLine({
        start: { x: X(m.x1), y: Y(m.y1) },
        end: { x: X(m.x2), y: Y(m.y2) },
        thickness: m.role === 'grid' ? 0.4 : m.role === 'median' || m.role === 'pass' ? 1.2 : 0.7,
        color,
        dashArray: m.dashed ? [3, 2] : undefined,
      })
    } else if (m.kind === 'circle') {
      page.drawCircle({ x: X(m.cx), y: Y(m.cy), size: m.r * s, color })
    } else {
      const font = m.bold ? fonts.bold : fonts.regular
      const size = m.size * s
      const safe = encodable(font, m.text)
      const w = font.widthOfTextAtSize(safe, size)
      const left = m.anchor === 'end' ? X(m.x) - w : m.anchor === 'middle' ? X(m.x) - w / 2 : X(m.x)
      page.drawText(safe, { x: left, y: Y(m.y), size, font, color })
    }
  }
}

const dateFormat = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

interface Column {
  label: string
  width: number
  align: 'left' | 'right'
}

function summaryTable(page: PDFPage, fonts: Fonts, analysis: Analysis, y: number): number {
  const cols: Column[] = [
    { label: 'Assessment', width: 0, align: 'left' },
    { label: 'Marks', width: 36, align: 'right' },
    { label: 'Absent', width: 38, align: 'right' },
    { label: 'Mean', width: 42, align: 'right' },
    { label: 'Median', width: 44, align: 'right' },
    { label: 'SD', width: 32, align: 'right' },
    { label: 'Lowest', width: 44, align: 'right' },
    { label: 'Highest', width: 46, align: 'right' },
    { label: 'Pass rate', width: 52, align: 'right' },
  ]
  cols[0].width = CONTENT_WIDTH - cols.slice(1).reduce((s, c) => s + c.width, 0)
  const rowH = 14
  const row = (cells: string[], top: number, bold: boolean) => {
    let x = MARGIN
    cells.forEach((cell, i) => {
      const c = cols[i]
      const font = bold ? fonts.bold : fonts.regular
      const s = i === 0 ? fit(font, cell, 9, c.width - 6) : cell
      text(page, fonts, s, c.align === 'right' ? x + c.width : x, top + 10, { font, size: 9, align: c.align })
      x += c.width
    })
  }
  box(page, MARGIN, y, CONTENT_WIDTH, rowH, rgb(0.95, 0.96, 0.97))
  row(
    cols.map((c) => c.label),
    y,
    true,
  )
  y += rowH
  for (const { column, summary: s } of shown(analysis)) {
    row(
      [
        column.name + (column.calculated ? ' (calculated)' : ''),
        String(s.count),
        String(s.absent),
        pct(s.mean),
        pct(s.median),
        oneDp(s.sd),
        pct(s.min),
        pct(s.max),
        pct(s.passRate),
      ],
      y,
      false,
    )
    y += rowH
    hline(page, MARGIN, MARGIN + CONTENT_WIDTH, y)
  }
  return y
}

function heading(page: PDFPage, fonts: Fonts, label: string, y: number): number {
  text(page, fonts, label, MARGIN, y + 11, { font: fonts.bold, size: 11 })
  return y + 17
}

/** Builds the report. Draws only the included assessments that have marks. */
export async function buildReport(analysis: Analysis, options: ReportOptions = {}): Promise<Uint8Array> {
  const cols = shown(analysis)
  const { doc, fonts } = await newDocument('Marks analysis')
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  const bottom = A4_HEIGHT - 16 * MM
  let y = MARGIN

  // Header
  text(page, fonts, 'Marks analysis', MARGIN, y + 16, { font: fonts.bold, size: 18 })
  const date = dateFormat.format(options.date ?? new Date())
  text(page, fonts, date, MARGIN + CONTENT_WIDTH, y + 16, { size: 10, color: MUTED, align: 'right' })
  y += 24
  const about = [options.className?.trim(), options.subject?.trim()].filter(Boolean).join(', ')
  if (about) {
    text(page, fonts, fit(fonts.regular, about, 12, CONTENT_WIDTH), MARGIN, y + 11, { size: 12 })
    y += 17
  }
  text(
    page,
    fonts,
    `Pass mark ${analysis.passMark}%. Bands: ${analysis.scheme.name}. All figures are percentages; SD is in percentage points.`,
    MARGIN,
    y + 9,
    { size: 8.5, color: MUTED },
  )
  y += 18

  if (cols.length === 0) {
    text(page, fonts, 'No marks to analyse.', MARGIN, y + 12, { size: 11 })
    footers(doc, fonts, 'Red Pen: Marks analysis')
    return doc.save()
  }

  y = summaryTable(page, fonts, analysis, y) + 12

  // Work out the space left for charts once the insights and comments are reserved.
  const insights = insightsFor(analysis).slice(0, 4)
  const insightLines = insights.map((i) => wrap(fonts.regular, i.text, 9.5, CONTENT_WIDTH - 12))
  const insightsH = 17 + insightLines.reduce((s, l) => s + l.length * 12 + 3, 0) + 8
  const commentsH = 17 + 92
  const room = bottom - y - insightsH - commentsH - 8

  const withBands = cols.length <= MAX_BAND_CHARTS
  const grid = cols.length === 1 ? 1 : 2
  const gridRows = Math.ceil(cols.length / grid)
  const gap = 12
  const cellW = (CONTENT_WIDTH - gap * (grid - 1)) / grid
  let bandH = withBands ? (cols.length === 1 ? 175 : cols.length === 2 ? 155 : 125) : 0
  let rowH = cols.length === 1 ? 30 : 22
  const boxNatural = () => 17 + 38 + cols.length * rowH
  const natural = () => (withBands ? 17 + gridRows * (bandH + 8) : 0) + boxNatural()
  if (natural() > room) {
    const f = Math.max(0.35, room / natural())
    bandH *= f
    rowH = Math.max(9, rowH * f)
  }

  if (withBands) {
    y = heading(page, fonts, 'Learners per band', y)
    const maxCount = Math.max(...cols.map((c) => Math.max(...c.summary.bands.map((b) => b.count))))
    cols.forEach((c, i) => {
      const chart = bandChart(c.summary, analysis.scheme, {
        width: cellW,
        height: bandH,
        maxCount,
        compact: cols.length > 2 || analysis.scheme.bands.length > 9,
        title: cols.length > 1 ? c.column.name : undefined,
      })
      drawChart(page, fonts, chart, MARGIN + (i % grid) * (cellW + gap), y + Math.floor(i / grid) * (bandH + 8))
    })
    y += gridRows * (bandH + 8)
  }

  y = heading(page, fonts, cols.length > 1 ? 'Spread of marks (box plots)' : 'Spread of marks (box plot)', y)
  const plot = boxPlot(
    cols.map((c) => ({ label: c.column.name, summary: c.summary })),
    analysis.passMark,
    { width: CONTENT_WIDTH, rowHeight: rowH },
  )
  drawChart(page, fonts, plot, MARGIN, y)
  y += plot.height + 8

  // Insights
  y = heading(page, fonts, 'What stands out', y)
  insightLines.forEach((lines) => {
    text(page, fonts, '-', MARGIN + 2, y + 9, { size: 9.5 })
    lines.forEach((line, i) => text(page, fonts, line, MARGIN + 12, y + 9 + i * 12, { size: 9.5 }))
    y += lines.length * 12 + 3
  })
  y += 8

  // Comments
  y = heading(page, fonts, 'Comments', y)
  const boxH = Math.max(60, Math.min(92, bottom - y))
  page.drawRectangle({
    x: MARGIN,
    y: A4_HEIGHT - y - boxH,
    width: CONTENT_WIDTH,
    height: boxH,
    borderColor: RULE,
    borderWidth: 0.8,
  })
  const comments = (options.comments ?? '').slice(0, COMMENTS_MAX)
  const lines = wrap(fonts.regular, comments, 9.5, CONTENT_WIDTH - 12).slice(0, Math.floor((boxH - 8) / 12))
  lines.forEach((line, i) => text(page, fonts, line, MARGIN + 6, y + 14 + i * 12, { size: 9.5 }))

  if (options.includeNames && hasNames(analysis)) namesPages(doc, fonts, analysis)

  footers(doc, fonts, 'Red Pen: Marks analysis. Worked out in the browser; nothing was uploaded.')
  return doc.save()
}

function namesPages(doc: PDFDocument, fonts: Fonts, analysis: Analysis): void {
  const flow = new Flow(doc, fonts, (page) => {
    text(page, fonts, `Learners below the pass mark (${analysis.passMark}%)`, MARGIN, MARGIN + 14, {
      font: fonts.bold,
      size: 14,
    })
    return MARGIN + 28
  })
  const colW = CONTENT_WIDTH / 2
  for (const { column } of shown(analysis)) {
    const list = needsSupport(column, analysis.passMark, analysis)
    flow.ensure(17 + 14)
    flow.y = heading(flow.page, fonts, `${column.name} (${list.length})`, flow.y)
    if (list.length === 0) {
      text(flow.page, fonts, 'Everyone reached the pass mark.', MARGIN, flow.y + 9, { size: 9.5, color: MUTED })
      flow.y += 20
      continue
    }
    for (let i = 0; i < list.length; i += 2) {
      flow.ensure(13)
      list.slice(i, i + 2).forEach((l, j) => {
        const x = MARGIN + j * colW
        text(flow.page, fonts, fit(fonts.regular, l.label, 9.5, colW - 60), x, flow.y + 9, { size: 9.5 })
        text(flow.page, fonts, pct(l.value), x + colW - 14, flow.y + 9, { size: 9.5, align: 'right' })
      })
      flow.y += 13
    }
    flow.y += 8
  }
}
