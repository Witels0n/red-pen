// One chart model, drawn twice: as SVG on screen (svg.ts) and with pdf-lib in the report
// (report/pdf.ts). Coordinates are points with y measured down from the top; colours are roles,
// so the screen can follow the light or dark theme while the PDF prints in fixed ink.
import type { BandScheme, Summary } from '../core/stats'

export type Role =
  'bar' | 'bar-below' | 'axis' | 'grid' | 'pass' | 'label' | 'muted' | 'box' | 'median' | 'whisker' | 'outlier'

export type Anchor = 'start' | 'middle' | 'end'

export type Mark =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; role: Role }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; role: Role; dashed?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; role: Role }
  | { kind: 'text'; x: number; y: number; text: string; role: Role; size: number; anchor: Anchor; bold?: boolean }

export interface Chart {
  width: number
  height: number
  /** A description for screen readers (and the SVG title). */
  label: string
  marks: Mark[]
}

/** A tidy top for a count axis, and the step between its gridlines. */
export function countAxis(max: number): { top: number; step: number } {
  if (max <= 4) return { top: Math.max(1, max), step: 1 }
  const raw = max / 4
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
  const step = steps.find((s) => s >= raw) ?? Math.ceil(raw)
  return { top: Math.ceil(max / step) * step, step }
}

/** Where a percentage sits on the band axis, as a fraction of the plot width (bands are equal width). */
export function bandAxisPosition(scheme: BandScheme, percent: number): number {
  const bands = scheme.bands
  const k = bands.length
  if (percent >= 100) return 1
  let i = 0
  bands.forEach((b, j) => {
    if (percent >= b.min) i = j
  })
  const lo = bands[i].min
  const hi = bands[i + 1]?.min ?? 100
  return (i + (percent - lo) / (hi - lo)) / k
}

export interface BandChartOptions {
  width?: number
  height?: number
  /** The count the axis must reach, for a shared scale across small multiples. */
  maxCount?: number
  /** Leave out the range line under each band (for small multiples). */
  compact?: boolean
  /** Shown above the chart, for small multiples. */
  title?: string
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'learner' : 'learners'}`
}

/** Learners per band as bars, with the pass mark as a dashed line. */
export function bandChart(summary: Summary, scheme: BandScheme, options: BandChartOptions = {}): Chart {
  const width = options.width ?? 360
  const height = options.height ?? 220
  const compact = options.compact ?? false
  const top = (options.title ? 16 : 0) + 22
  const bottom = compact ? 18 : 32
  const left = 26
  const right = 6
  const plotW = width - left - right
  const plotH = height - top - bottom
  const marks: Mark[] = []
  if (options.title)
    marks.push({ kind: 'text', x: 0, y: 11, text: options.title, role: 'label', size: 11, anchor: 'start', bold: true })

  const max = Math.max(options.maxCount ?? 0, ...summary.bands.map((b) => b.count))
  const axis = countAxis(max)
  const yOf = (count: number) => top + plotH - (count / axis.top) * plotH
  for (let v = 0; v <= axis.top; v += axis.step) {
    const y = yOf(v)
    marks.push({ kind: 'line', x1: left, y1: y, x2: left + plotW, y2: y, role: v === 0 ? 'axis' : 'grid' })
    marks.push({ kind: 'text', x: left - 5, y: y + 3, text: String(v), role: 'muted', size: 9, anchor: 'end' })
  }

  const k = scheme.bands.length
  const slot = plotW / k
  const barW = Math.max(2, slot * 0.72)
  scheme.bands.forEach((band, i) => {
    const { count } = summary.bands[i]
    const x = left + slot * i + (slot - barW) / 2
    const upper = scheme.bands[i + 1]?.min ?? 100.0001
    const role: Role = upper <= summary.passMark ? 'bar-below' : 'bar'
    if (count > 0) marks.push({ kind: 'rect', x, y: yOf(count), w: barW, h: yOf(0) - yOf(count), role })
    const cx = x + barW / 2
    if (count > 0)
      marks.push({
        kind: 'text',
        x: cx,
        y: yOf(count) - 3,
        text: String(count),
        role: 'label',
        size: 9,
        anchor: 'middle',
      })
    marks.push({ kind: 'text', x: cx, y: top + plotH + 12, text: band.short, role: 'label', size: 9, anchor: 'middle' })
    if (!compact)
      marks.push({
        kind: 'text',
        x: cx,
        y: top + plotH + 24,
        text: band.range,
        role: 'muted',
        size: 8,
        anchor: 'middle',
      })
  })

  const px = left + bandAxisPosition(scheme, summary.passMark) * plotW
  marks.push({ kind: 'line', x1: px, y1: top - 6, x2: px, y2: top + plotH, role: 'pass', dashed: true })
  const passText = `Pass ${summary.passMark}%`
  const anchor: Anchor = px < left + 30 ? 'start' : px > left + plotW - 30 ? 'end' : 'middle'
  marks.push({ kind: 'text', x: px, y: top - 9, text: passText, role: 'pass', size: 9, anchor, bold: true })

  const parts = scheme.bands.map((b, i) => `${b.label} (${b.range}%): ${plural(summary.bands[i].count)}`)
  return {
    width,
    height,
    label: `${options.title ? `${options.title}. ` : ''}Learners per band. ${parts.join('; ')}. Pass mark ${summary.passMark}%.`,
    marks,
  }
}

export interface BoxPlotRow {
  label: string
  summary: Summary
}

export interface BoxPlotOptions {
  width?: number
  rowHeight?: number
}

/** Shortens a label to about `chars` characters. */
export function shorten(label: string, chars: number): string {
  return label.length <= chars ? label : `${label.slice(0, Math.max(1, chars - 3)).trimEnd()}...`
}

/** One box plot per assessment on a shared 0 to 100% axis, with outlier dots and the pass mark. */
export function boxPlot(rows: readonly BoxPlotRow[], passMark: number, options: BoxPlotOptions = {}): Chart {
  const width = options.width ?? 360
  const rowH = options.rowHeight ?? 34
  const labelled = rows.length > 1
  const left = labelled ? Math.min(110, Math.round(width * 0.3)) : 10
  const right = 12
  const top = 16
  const bottom = 22
  const plotW = width - left - right
  const height = top + rows.length * rowH + bottom
  const xOf = (p: number) => left + (Math.max(0, Math.min(100, p)) / 100) * plotW
  const marks: Mark[] = []
  const plotBottom = top + rows.length * rowH

  for (let v = 0; v <= 100; v += 20) {
    marks.push({ kind: 'line', x1: xOf(v), y1: top, x2: xOf(v), y2: plotBottom, role: v === 0 ? 'axis' : 'grid' })
    marks.push({ kind: 'text', x: xOf(v), y: plotBottom + 13, text: `${v}%`, role: 'muted', size: 9, anchor: 'middle' })
  }
  marks.push({ kind: 'line', x1: left, y1: plotBottom, x2: left + plotW, y2: plotBottom, role: 'axis' })

  rows.forEach((row, i) => {
    const s = row.summary
    const cy = top + i * rowH + rowH / 2
    const boxH = Math.min(18, rowH * 0.55)
    if (labelled)
      marks.push({
        kind: 'text',
        x: left - 8,
        y: cy + 3.5,
        text: shorten(row.label, Math.floor((left - 10) / 5.5)),
        role: 'label',
        size: 10,
        anchor: 'end',
      })
    marks.push({ kind: 'line', x1: xOf(s.whiskerLow), y1: cy, x2: xOf(s.q1), y2: cy, role: 'whisker' })
    marks.push({ kind: 'line', x1: xOf(s.q3), y1: cy, x2: xOf(s.whiskerHigh), y2: cy, role: 'whisker' })
    for (const end of [s.whiskerLow, s.whiskerHigh])
      marks.push({ kind: 'line', x1: xOf(end), y1: cy - boxH / 3, x2: xOf(end), y2: cy + boxH / 3, role: 'whisker' })
    marks.push({
      kind: 'rect',
      x: xOf(s.q1),
      y: cy - boxH / 2,
      w: Math.max(1, xOf(s.q3) - xOf(s.q1)),
      h: boxH,
      role: 'box',
    })
    marks.push({
      kind: 'line',
      x1: xOf(s.median),
      y1: cy - boxH / 2,
      x2: xOf(s.median),
      y2: cy + boxH / 2,
      role: 'median',
    })
    for (const o of s.outliers) marks.push({ kind: 'circle', cx: xOf(o), cy, r: 3, role: 'outlier' })
  })

  const px = xOf(passMark)
  marks.push({ kind: 'line', x1: px, y1: top - 4, x2: px, y2: plotBottom, role: 'pass', dashed: true })
  marks.push({
    kind: 'text',
    x: px,
    y: top - 6,
    text: `Pass ${passMark}%`,
    role: 'pass',
    size: 9,
    anchor: px > left + plotW - 30 ? 'end' : px < left + 30 ? 'start' : 'middle',
    bold: true,
  })

  const one = (r: BoxPlotRow) => {
    const s = r.summary
    const out = s.outliers.length ? `, ${s.outliers.length} outlier${s.outliers.length === 1 ? '' : 's'}` : ''
    return `${r.label}: lowest ${Math.round(s.min)}%, quartiles ${Math.round(s.q1)}% to ${Math.round(s.q3)}%, median ${Math.round(s.median)}%, highest ${Math.round(s.max)}%${out}`
  }
  return { width, height, label: `Box plot. ${rows.map(one).join('; ')}.`, marks }
}
