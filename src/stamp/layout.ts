// Pure layout for Stamp and number: which pages get stamped, what each one says and where it
// goes. No DOM, no pdf.js, no pdf-lib. Positions are in displayed page units (points, origin at
// the top-left of the page as shown, y down); the export maps them into PDF user space.

import { formatDate, type DateStyle } from '../shared/dates'
import { parseRanges } from '../split/ranges'

export type PageScope = 'all' | 'odd' | 'even' | 'range'

/** One of the six places a line of text can go, along the top or bottom edge. */
export type Slot = 'top-left' | 'top-centre' | 'top-right' | 'bottom-left' | 'bottom-centre' | 'bottom-right'
export const SLOTS: readonly Slot[] = [
  'top-left',
  'top-centre',
  'top-right',
  'bottom-left',
  'bottom-centre',
  'bottom-right',
]

export type NumberFormat = 'n' | 'page-n' | 'page-n-of' | 'n-of'
export type Align = 'left' | 'centre' | 'right'
export type FontName = 'helvetica' | 'times' | 'courier'
export type WatermarkSize = 'small' | 'medium' | 'large' | 'fit'

export const WATERMARK_PRESETS = ['MEMO', 'DRAFT', 'CONFIDENTIAL', 'DO NOT DISTRIBUTE', 'COPY'] as const

export interface StampSettings {
  scope: PageScope
  /** Custom pages, as typed ("2-9, 11"), used when `scope` is "range". */
  range: string
  watermark: {
    on: boolean
    /** One of WATERMARK_PRESETS, or "custom" to use `custom`. */
    preset: string
    custom: string
    diagonal: boolean
    size: WatermarkSize
    /** "#rrggbb". */
    colour: string
    /** 0 to 1. */
    opacity: number
  }
  numbers: { on: boolean; slot: Slot; format: NumberFormat; start: number }
  header: { text: string; align: Align }
  footer: { text: string; align: Align }
  date: { slot: Slot | 'none'; style: DateStyle }
  logo: { slot: 'top-left' | 'top-right'; height: number }
  text: { font: FontName; size: number; colour: string; bold: boolean; margin: number }
}

export const DEFAULT_SETTINGS: StampSettings = {
  scope: 'all',
  range: '',
  watermark: {
    on: true,
    preset: 'MEMO',
    custom: '',
    diagonal: true,
    size: 'fit',
    colour: '#d3212d',
    opacity: 0.2,
  },
  numbers: { on: true, slot: 'bottom-centre', format: 'page-n-of', start: 1 },
  header: { text: '', align: 'left' },
  footer: { text: '', align: 'left' },
  date: { slot: 'none', style: 'long' },
  logo: { slot: 'top-left', height: 32 },
  text: { font: 'helvetica', size: 10, colour: '#333333', bold: false, margin: 10 },
}

const MM = 72 / 25.4

/** Millimetres to points. */
export function mmToPt(mm: number): number {
  return mm * MM
}

/** "1", "Page 1", "Page 1 of 9" or "1/9". */
export function formatPageNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case 'page-n':
      return `Page ${n}`
    case 'page-n-of':
      return `Page ${n} of ${total}`
    case 'n-of':
      return `${n}/${total}`
    default:
      return String(n)
  }
}

export type PageSelection = { ok: true; pages: number[] } | { ok: false; error: string }

/**
 * The 0-based indexes of the pages to stamp in a PDF with `pageCount` pages. A custom range may
 * reach past the end of a shorter PDF in a batch; those pages are simply not there to stamp.
 */
export function selectPages(scope: PageScope, range: string, pageCount: number): PageSelection {
  const all = Array.from({ length: pageCount }, (_, i) => i)
  if (scope === 'odd') return { ok: true, pages: all.filter((i) => i % 2 === 0) }
  if (scope === 'even') return { ok: true, pages: all.filter((i) => i % 2 === 1) }
  if (scope !== 'range') return { ok: true, pages: all }
  const parsed = parseRanges(range, Number.MAX_SAFE_INTEGER)
  if (!parsed.ok) return parsed
  const chosen = new Set<number>()
  for (const r of parsed.ranges) {
    for (let p = r.start; p <= Math.min(r.end, pageCount); p++) chosen.add(p - 1)
  }
  return { ok: true, pages: [...chosen].sort((a, b) => a - b) }
}

/** The watermark's words, or "" when it is off or empty. */
export function watermarkText(s: StampSettings['watermark']): string {
  if (!s.on) return ''
  return (s.preset === 'custom' ? s.custom : s.preset).trim()
}

/** The lines of text for one stamped page, gathered by slot. Several in one slot are joined. */
export function slotTexts(
  s: StampSettings,
  pageNumber: number | null,
  total: number,
  today: Date,
): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string[]>> = {}
  const add = (slot: Slot, text: string) => {
    const t = text.trim()
    if (t) (out[slot] ??= []).push(t)
  }
  const side = (edge: 'top' | 'bottom', align: Align): Slot => `${edge}-${align}`
  add(side('top', s.header.align), s.header.text)
  add(side('bottom', s.footer.align), s.footer.text)
  if (s.date.slot !== 'none') add(s.date.slot, formatDate(today, s.date.style))
  if (s.numbers.on && pageNumber !== null) add(s.numbers.slot, formatPageNumber(s.numbers.format, pageNumber, total))
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('   |   ')]))
}

/** Where a line of text goes: the start of its baseline and its angle (degrees, anticlockwise). */
export interface Placement {
  x: number
  y: number
  angle: number
}

export interface PageSize {
  width: number
  height: number
}

/**
 * A line of text along the top or bottom edge. `textWidth` and `capHeight` are the measured text
 * at its size; `inset` pushes it away from the left or right edge (to clear a logo).
 */
export function placeSlot(
  slot: Slot,
  page: PageSize,
  textWidth: number,
  capHeight: number,
  margin: number,
  options: { insetLeft?: number; insetRight?: number; bandHeight?: number } = {},
): Placement {
  const [edge, align] = slot.split('-') as ['top' | 'bottom', Align]
  const left = margin + (options.insetLeft ?? 0)
  const right = page.width - margin - (options.insetRight ?? 0)
  const x = align === 'left' ? left : align === 'right' ? right - textWidth : (page.width - textWidth) / 2
  // Along the top, text is centred on the band a logo makes (or sits just under the margin).
  const band = Math.max(options.bandHeight ?? 0, capHeight)
  const y = edge === 'top' ? margin + band / 2 + capHeight / 2 : page.height - margin
  return { x, y, angle: 0 }
}

/**
 * The watermark, centred on the page: horizontal, or along the diagonal from bottom-left to
 * top-right. Returns the start of its baseline so its middle lands on the middle of the page.
 */
export function placeWatermark(page: PageSize, textWidth: number, capHeight: number, diagonal: boolean): Placement {
  const angle = diagonal ? (Math.atan2(page.height, page.width) * 180) / Math.PI : 0
  const a = (angle * Math.PI) / 180
  // Along the baseline (y down on screen, so "up" is negative) and the normal pointing below it.
  const along = { x: Math.cos(a), y: -Math.sin(a) }
  const below = { x: Math.sin(a), y: Math.cos(a) }
  const cx = page.width / 2
  const cy = page.height / 2
  return {
    x: cx - (textWidth / 2) * along.x + (capHeight / 2) * below.x,
    y: cy - (textWidth / 2) * along.y + (capHeight / 2) * below.y,
    angle,
  }
}

const SIZES: Record<Exclude<WatermarkSize, 'fit'>, number> = { small: 48, medium: 72, large: 110 }

/**
 * The watermark's font size. "fit" makes it run across 75% of the page (or its diagonal), and
 * `widthAtOne` is the text's width at size 1.
 */
export function watermarkFontSize(size: WatermarkSize, page: PageSize, widthAtOne: number, diagonal: boolean): number {
  if (size !== 'fit') return SIZES[size]
  const length = diagonal ? Math.hypot(page.width, page.height) : page.width
  if (widthAtOne <= 0) return SIZES.medium
  // A tall word should still leave the page's corners clear.
  return Math.max(8, Math.min((length * 0.75) / widthAtOne, page.height * 0.4))
}

/** "#33aa00" -> { r, g, b } between 0 and 1. Anything unreadable is black. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * Settings read back from storage: anything missing, of the wrong type or out of range falls
 * back to the default, so an old or damaged saved copy never breaks the page.
 */
export function sanitiseSettings(raw: unknown): StampSettings {
  const d = DEFAULT_SETTINGS
  const r = isObject(raw) ? raw : {}
  const part = (k: string) => (isObject(r[k]) ? (r[k] as Record<string, unknown>) : {})
  const str = (o: Record<string, unknown>, k: string, fallback: string, max = 200) =>
    typeof o[k] === 'string' ? (o[k] as string).slice(0, max) : fallback
  const bool = (o: Record<string, unknown>, k: string, fallback: boolean) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : fallback
  const num = (o: Record<string, unknown>, k: string, fallback: number, min: number, max: number) =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.min(max, Math.max(min, o[k] as number)) : fallback
  const pick = <T extends string>(o: Record<string, unknown>, k: string, options: readonly T[], fallback: T): T =>
    options.includes(o[k] as T) ? (o[k] as T) : fallback
  const colour = (o: Record<string, unknown>, k: string, fallback: string) => {
    const v = str(o, k, fallback)
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback
  }
  const aligns: readonly Align[] = ['left', 'centre', 'right']
  const w = part('watermark')
  const n = part('numbers')
  const h = part('header')
  const f = part('footer')
  const dt = part('date')
  const l = part('logo')
  const t = part('text')
  return {
    scope: pick(r, 'scope', ['all', 'odd', 'even', 'range'], d.scope),
    range: str(r, 'range', d.range),
    watermark: {
      on: bool(w, 'on', d.watermark.on),
      preset: pick(w, 'preset', [...WATERMARK_PRESETS, 'custom'], d.watermark.preset),
      custom: str(w, 'custom', d.watermark.custom, 60),
      diagonal: bool(w, 'diagonal', d.watermark.diagonal),
      size: pick(w, 'size', ['small', 'medium', 'large', 'fit'], d.watermark.size),
      colour: colour(w, 'colour', d.watermark.colour),
      opacity: num(w, 'opacity', d.watermark.opacity, 0.05, 1),
    },
    numbers: {
      on: bool(n, 'on', d.numbers.on),
      slot: pick(n, 'slot', SLOTS, d.numbers.slot),
      format: pick(n, 'format', ['n', 'page-n', 'page-n-of', 'n-of'], d.numbers.format),
      start: Math.round(num(n, 'start', d.numbers.start, 0, 99999)),
    },
    header: { text: str(h, 'text', d.header.text), align: pick(h, 'align', aligns, d.header.align) },
    footer: { text: str(f, 'text', d.footer.text), align: pick(f, 'align', aligns, d.footer.align) },
    date: {
      slot: pick(dt, 'slot', [...SLOTS, 'none'], d.date.slot),
      style: pick(dt, 'style', ['long', 'iso'], d.date.style),
    },
    logo: {
      slot: pick(l, 'slot', ['top-left', 'top-right'], d.logo.slot),
      height: num(l, 'height', d.logo.height, 12, 120),
    },
    text: {
      font: pick(t, 'font', ['helvetica', 'times', 'courier'], d.text.font),
      size: num(t, 'size', d.text.size, 5, 36),
      colour: colour(t, 'colour', d.text.colour),
      bold: bool(t, 'bold', d.text.bold),
      margin: num(t, 'margin', d.text.margin, 0, 50),
    },
  }
}
