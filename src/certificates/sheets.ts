// Desk name cards, name labels, book labels and award slips: small items laid out on A4 sheets.
import { rgb, type PDFImage } from 'pdf-lib'
import { INK, MUTED, starPath, type Colours } from './certificate'
import { tint, type DrawFont, type Painter } from './draw'
import { fitBlock, fitName, fitSize, truncate } from './fit'
import type { Rect, TentCard } from './layouts'
import type { Lettering } from './model'

const GUIDE = rgb(0.72, 0.74, 0.78)

export function letteringFont(p: Painter, lettering: Lettering): DrawFont {
  const f = p.fonts
  return { clear: f.sansBold, display: f.display, script: f.script, serif: f.serifBold }[lettering]
}

/** The main name and optional second line, centred as a pair in a box. */
function nameAndLine(
  p: Painter,
  font: DrawFont,
  box: Rect,
  line1: string,
  line2: string,
  maxName: number,
  c: Colours,
): void {
  const inner = { ...box, x: box.x + 10, width: box.width - 20 }
  const room = box.height * (line2.trim() ? 0.72 : 0.95)
  const name = line1.trim() ? fitName(font, line1, maxName, inner.width, room) : { lines: [], size: 0 }
  const nameSize = name.size
  const second = line2.trim() ? Math.max(6, Math.min(maxName * 0.4, 16)) : 0
  const secondSize = second ? fitSize(p.fonts.sans, line2, second, inner.width) : 0
  const capH = nameSize * font.capHeight
  const step = nameSize * 1.1
  const nameH = name.lines.length ? capH + (name.lines.length - 1) * step : 0
  const gap = secondSize && nameH ? secondSize * 0.8 : 0
  const total = nameH + gap + secondSize * 0.75
  const top = box.y + (box.height - total) / 2
  const cx = inner.x + inner.width / 2
  name.lines.forEach((ln, i) => p.text(font, ln, cx, top + capH + i * step, nameSize, c.main, 'center'))
  if (secondSize) p.text(p.fonts.sans, line2, cx, top + nameH + gap + secondSize * 0.75, secondSize, MUTED, 'center')
}

/** One folded desk card: the name on the front panel and, upside down, on the back. */
export function drawTentCard(
  p: Painter,
  card: TentCard,
  font: DrawFont,
  line1: string,
  line2: string,
  bothSides: boolean,
  c: Colours,
): void {
  const panel = (r: Rect) => {
    // A coloured strip along the edge the card stands on.
    p.rect({ x: r.x + 28, y: r.y + r.height - 22, width: r.width - 56, height: 6 }, c.main)
    p.rect({ x: r.x + 28, y: r.y + r.height - 16, width: r.width - 56, height: 2 }, c.accent)
    nameAndLine(p, font, { x: r.x + 28, y: r.y + 12, width: r.width - 56, height: r.height - 40 }, line1, line2, 78, c)
  }
  panel(card.front)
  if (bothSides) p.upsideDown(card.back, () => panel(card.back))
  p.line(card.card.x + 12, card.foldY, card.card.x + card.card.width - 12, card.foldY, {
    color: GUIDE,
    width: 0.6,
    dash: [2, 3],
  })
  p.text(p.fonts.sans, 'fold', card.card.x + card.card.width - 14, card.foldY - 3, 7, GUIDE, 'right')
}

/** The dashed line between the two desk cards on a sheet. */
export function drawCutLine(p: Painter, y: number): void {
  p.line(0, y, p.width, y, { color: GUIDE, width: 0.6, dash: [6, 4] })
  p.text(p.fonts.sans, 'cut', 14, y - 3, 7, GUIDE)
}

export function drawNameLabel(
  p: Painter,
  cell: Rect,
  font: DrawFont,
  line1: string,
  line2: string,
  outline: boolean,
  c: Colours,
): void {
  if (outline) p.roundRect(cell, 6, undefined, { color: GUIDE, width: 0.5 })
  const pad = Math.min(8, cell.height * 0.12)
  nameAndLine(
    p,
    font,
    { x: cell.x + pad, y: cell.y + pad, width: cell.width - 2 * pad, height: cell.height - 2 * pad },
    line1,
    line2,
    Math.min(cell.height * 0.36, 30),
    c,
  )
}

export function drawBookLabel(
  p: Painter,
  cell: Rect,
  font: DrawFont,
  heading: string,
  rows: { label: string; value: string }[],
  outline: boolean,
  c: Colours,
  logo?: PDFImage,
): void {
  const f = p.fonts
  if (outline) p.roundRect(cell, 6, undefined, { color: GUIDE, width: 0.5 })
  const pad = Math.max(8, Math.min(14, cell.width * 0.05))
  const x0 = cell.x + pad
  const x1 = cell.x + cell.width - pad
  let y = cell.y + pad
  const headSize = Math.min(14, cell.height * 0.13)
  if (heading.trim() || logo) {
    const bandH = headSize * 1.9
    p.roundRect({ x: x0, y, width: x1 - x0, height: bandH }, 4, c.main)
    let textX = x0 + 8
    if (logo) textX += p.image(logo, { x: x0 + 4, y: y + 3, width: bandH * 1.6, height: bandH - 6 }).width + 6
    if (heading.trim()) {
      const size = fitSize(f.sansBold, heading, headSize, x1 - textX - 8)
      const avail = x1 - textX
      p.text(f.sansBold, heading, textX + avail / 2 - 4, y + bandH / 2 + size * 0.34, size, rgb(1, 1, 1), 'center')
    }
    y += bandH + 4
  }
  const used = rows.filter((r) => r.label.trim() || r.value.trim())
  if (used.length === 0) return
  const rowH = (cell.y + cell.height - pad - y) / used.length
  const labelSize = Math.min(11, rowH * 0.36)
  for (const r of used) {
    const base = y + rowH * 0.78
    const label = r.label.trim() ? `${r.label.trim()}:` : ''
    const lw = label ? p.text(f.sansBold, label, x0, base, labelSize, MUTED) + 6 : 0
    p.line(x0 + lw, base + 2, x1, base + 2, { color: tint(INK, 0.6), width: 0.5 })
    if (r.value.trim()) {
      const max = Math.min(rowH * 0.62, 20)
      const size = fitSize(font, r.value, max, x1 - x0 - lw - 4)
      p.text(font, r.value, x0 + lw + 2, base, size, INK)
    }
    y += rowH
  }
}

export interface SlipText {
  title: string
  body: string
  signedBy: string
  footer: string
}

export function drawSlip(p: Painter, cell: Rect, font: DrawFont, t: SlipText, c: Colours, logo?: PDFImage): void {
  const f = p.fonts
  const box = { x: cell.x + 18, y: cell.y + 14, width: cell.width - 36, height: cell.height - 28 }
  p.roundRect(box, 14, tint(c.accent, 0.92), { color: c.main, width: 2 })
  // A rosette on the left.
  const r = Math.min(34, box.height * 0.24)
  const cx = box.x + 22 + r
  const cy = box.y + box.height / 2
  p.path(starPath(r, r * 0.84, 20), cx, cy, c.accent)
  p.circle(cx, cy, r * 0.74, c.main)
  p.path(starPath(r * 0.45, r * 0.19), cx, cy, rgb(1, 1, 1))
  let right = box.x + box.width - 18
  if (logo) {
    const placed = p.image(logo, { x: right - 70, y: box.y + 12, width: 70, height: 46 }, 'top')
    right = Math.min(right, placed.x - 10)
  }
  const left = cx + r + 18
  const width = right - left
  let y = box.y + 14
  if (t.title.trim()) {
    const size = fitSize(font, t.title, 26, width)
    p.text(font, t.title, left, y + size * 0.85, size, c.main)
    y += size * 1.25
  }
  const footerTop = box.y + box.height - 34
  if (t.body.trim()) {
    const fitted = fitBlock(f.sans, t.body, { width, height: footerTop - y - 6 }, 15, 8)
    fitted.lines.forEach((ln, i) =>
      p.text(f.sans, ln, left, y + fitted.size * 0.9 + i * fitted.lineHeight, fitted.size, INK),
    )
  }
  const lineW = Math.min(170, width * 0.5)
  p.line(left, footerTop + 10, left + lineW, footerTop + 10, { color: MUTED, width: 0.7 })
  if (t.signedBy.trim()) p.text(f.sans, truncate(f.sans, t.signedBy, 9, lineW), left, footerTop + 21, 9, MUTED)
  if (t.footer.trim()) {
    const fw = width - lineW - 20
    p.text(f.sans, truncate(f.sans, t.footer, 11, fw), left + width, footerTop + 10, 11, INK, 'right')
  }
}

export function drawSlipCutLines(p: Painter, cells: Rect[]): void {
  for (const cell of cells.slice(1)) p.line(0, cell.y, p.width, cell.y, { color: GUIDE, width: 0.6, dash: [6, 4] })
}
