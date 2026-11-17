// The four certificate designs, drawn as vectors. Each design is a frame (borders and ornaments)
// plus a look (fonts, sizes, alignment); the text is laid out the same way for all of them.
import { rgb, type PDFImage, type RGB } from 'pdf-lib'
import { fitBlock, fitSize, truncate } from './fit'
import { tint, type DrawFont, type FontSet, type Painter } from './draw'
import type { Design } from './model'

export const INK = rgb(0.13, 0.15, 0.19)
export const MUTED = rgb(0.38, 0.41, 0.46)

/** The texts of one certificate, with merge fields already filled in. */
export interface CertificateText {
  school: string
  title: string
  intro: string
  name: string
  body: string
  date: string
  signatories: { name: string; role: string }[]
}

export interface Colours {
  main: RGB
  accent: RGB
}

export interface CertificateImages {
  logo?: PDFImage
  signature?: PDFImage
}

interface Look {
  align: 'center' | 'left'
  /** Left edge of the text column. */
  left: number
  width: number
  top: number
  /** Where the signature lines sit, from the top. */
  signY: number
  school: { font: DrawFont; size: number; colour: RGB; upper: boolean }
  title: { font: DrawFont; size: number; colour: RGB; upper: boolean }
  intro: { font: DrawFont; size: number; colour: RGB }
  name: { font: DrawFont; size: number; colour: RGB }
  body: { font: DrawFont; size: number; colour: RGB }
  divider: boolean
  underline: boolean
}

/** A star with `points` points, as an SVG path centred on the origin. */
export function starPath(outer: number, inner: number, points = 5): string {
  const parts: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI * i) / points - Math.PI / 2
    parts.push(`${i === 0 ? 'M' : 'L'}${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`)
  }
  return `${parts.join(' ')} Z`
}

function diamond(p: Painter, cx: number, cy: number, r: number, colour: RGB): void {
  p.path(`M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`, cx, cy, colour)
}

/** Small pseudo-random numbers that are the same every time, so a design never changes between prints. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function frame(p: Painter, design: Design, c: Colours): void {
  const { width: W, height: H } = p
  switch (design) {
    case 'classic': {
      p.rect({ x: 0, y: 0, width: W, height: H }, tint(c.accent, 0.93))
      p.rect({ x: 22, y: 22, width: W - 44, height: H - 44 }, rgb(1, 1, 1), { color: c.main, width: 7 })
      p.rect({ x: 34, y: 34, width: W - 68, height: H - 68 }, undefined, { color: c.accent, width: 1.5 })
      p.rect({ x: 39, y: 39, width: W - 78, height: H - 78 }, undefined, { color: c.main, width: 0.5 })
      for (const [x, y] of [
        [34, 34],
        [W - 34, 34],
        [34, H - 34],
        [W - 34, H - 34],
      ])
        diamond(p, x, y, 9, c.accent)
      break
    }
    case 'modern': {
      const band = Math.round(Math.min(W, H) * 0.09)
      p.rect({ x: 0, y: 0, width: band, height: H }, c.main)
      p.rect({ x: band, y: 0, width: 6, height: H }, c.accent)
      const t = band * 1.6
      p.path(`M${t} 0 L${t} ${t} L0 ${t} Z`, W - t, H - t, tint(c.accent, 0.55))
      p.path(`M${t} ${t * 0.45} L${t} ${t} L${t * 0.45} ${t} Z`, W - t, H - t, c.main)
      break
    }
    case 'playful': {
      p.rect({ x: 0, y: 0, width: W, height: H }, tint(c.accent, 0.88))
      p.roundRect({ x: 24, y: 24, width: W - 48, height: H - 48 }, 30, rgb(1, 1, 1), { color: c.main, width: 5 })
      p.roundRect({ x: 34, y: 34, width: W - 68, height: H - 68 }, 22, undefined, {
        color: c.accent,
        width: 1.5,
        dash: [6, 5],
      })
      const rand = seeded(7)
      const colours = [c.main, c.accent, tint(c.main, 0.45), tint(c.accent, 0.35)]
      // Confetti scattered along the edges, outside the text.
      for (let i = 0; i < 44; i++) {
        const edge = i % 4
        const t = rand()
        const inset = 46 + rand() * 26
        const x = edge === 0 || edge === 2 ? 60 + t * (W - 120) : edge === 1 ? W - inset : inset
        const y = edge === 1 || edge === 3 ? 60 + t * (H - 120) : edge === 0 ? inset : H - inset
        const colour = colours[i % colours.length]
        if (i % 3 === 0) p.path(starPath(6 + rand() * 4, 2.8 + rand() * 1.5), x, y, colour)
        else p.circle(x, y, 2 + rand() * 3, colour)
      }
      break
    }
    case 'minimal': {
      p.rect({ x: 30, y: 30, width: W - 60, height: H - 60 }, undefined, { color: tint(INK, 0.75), width: 0.6 })
      p.rect({ x: 84, y: 62, width: 56, height: 3 }, c.main)
      break
    }
  }
}

function look(p: Painter, design: Design, f: FontSet, c: Colours, scriptName: boolean): Look {
  const { width: W, height: H } = p
  const landscape = W > H
  const k = landscape ? 1 : 0.86 // portrait pages are narrower, so text runs a little smaller
  switch (design) {
    case 'classic':
      return {
        align: 'center',
        left: 90,
        width: W - 180,
        top: 70,
        signY: H - 108,
        school: { font: f.serifBold, size: 14 * k, colour: c.main, upper: true },
        title: { font: f.serifBold, size: 40 * k, colour: c.main, upper: true },
        intro: { font: f.serifItalic, size: 17 * k, colour: MUTED },
        name: scriptName
          ? { font: f.script, size: 66 * k, colour: c.main }
          : { font: f.serifBold, size: 46 * k, colour: INK },
        body: { font: f.serif, size: 17 * k, colour: INK },
        divider: true,
        underline: true,
      }
    case 'modern': {
      const band = Math.round(Math.min(W, H) * 0.09)
      return {
        align: 'left',
        left: band + 56,
        width: W - band - 56 - 70,
        top: 62,
        signY: H - 96,
        school: { font: f.sansBold, size: 13 * k, colour: c.accent, upper: true },
        title: { font: f.display, size: 46 * k, colour: c.main, upper: false },
        intro: { font: f.sans, size: 16 * k, colour: MUTED },
        name: scriptName
          ? { font: f.script, size: 68 * k, colour: INK }
          : { font: f.display, size: 50 * k, colour: INK },
        body: { font: f.sans, size: 16 * k, colour: INK },
        divider: false,
        underline: true,
      }
    }
    case 'playful':
      return {
        align: 'center',
        left: 100,
        width: W - 200,
        top: 74,
        signY: H - 112,
        school: { font: f.sansBold, size: 14 * k, colour: c.accent, upper: false },
        title: { font: f.display, size: 48 * k, colour: c.main, upper: false },
        intro: { font: f.sans, size: 17 * k, colour: MUTED },
        name: scriptName
          ? { font: f.script, size: 68 * k, colour: c.accent }
          : { font: f.display, size: 52 * k, colour: c.accent },
        body: { font: f.sans, size: 17 * k, colour: INK },
        divider: false,
        underline: false,
      }
    case 'minimal':
      return {
        align: 'left',
        left: 84,
        width: W - 168,
        top: 74,
        signY: H - 100,
        school: { font: f.sans, size: 12 * k, colour: MUTED, upper: true },
        title: { font: f.sans, size: 34 * k, colour: INK, upper: false },
        intro: { font: f.sans, size: 14 * k, colour: MUTED },
        name: scriptName
          ? { font: f.script, size: 60 * k, colour: c.main }
          : { font: f.display, size: 44 * k, colour: c.main },
        body: { font: f.sans, size: 15 * k, colour: INK },
        divider: false,
        underline: false,
      }
  }
}

/** One vertical block of the certificate: its height and how to draw it at a given top. */
interface Block {
  height: number
  gapAfter: number
  draw(top: number): void
}

function signatureSlots(
  p: Painter,
  l: Look,
  t: CertificateText,
  f: FontSet,
  c: Colours,
  images: CertificateImages,
  design: Design,
): void {
  const people = t.signatories.filter((s) => s.name.trim() || s.role.trim())
  type Slot = { kind: 'person'; name: string; role: string; first: boolean } | { kind: 'date' } | { kind: 'seal' }
  const slots: Slot[] = people.map((s, i) => ({ kind: 'person', ...s, first: i === 0 }))
  const hasDate = t.date.trim() !== ''
  if (l.align === 'center') {
    // Centre designs: first signatory, then the date (or a seal), then the second.
    const middle: Slot = hasDate ? { kind: 'date' } : { kind: 'seal' }
    if (slots.length === 2) slots.splice(1, 0, middle)
    else if (slots.length === 1) slots.push(middle)
    else slots.push(middle)
  } else if (hasDate) slots.push({ kind: 'date' })
  if (slots.length === 0) return

  const lineW = Math.min(190, (l.width - 30 * (slots.length - 1)) / slots.length)
  const gap = slots.length > 1 ? (l.width - lineW * slots.length) / (slots.length - 1) : 0
  const lineY = l.signY
  slots.forEach((slot, i) => {
    const x0 =
      l.align === 'center' && slots.length === 1
        ? l.left + (l.width - lineW) / 2
        : l.left + i * (lineW + Math.min(gap, l.align === 'left' ? 50 : gap))
    const cx = x0 + lineW / 2
    if (slot.kind === 'seal') {
      if (design === 'minimal') return
      const r = 34
      p.path(starPath(r, r * 0.84, 24), cx, lineY - 6, c.accent)
      p.circle(cx, lineY - 6, r * 0.74, c.main)
      p.circle(cx, lineY - 6, r * 0.62, undefined, { color: c.accent, width: 1 })
      p.path(starPath(r * 0.36, r * 0.15), cx, lineY - 6, c.accent)
      return
    }
    p.line(x0, lineY, x0 + lineW, lineY, { color: MUTED, width: 0.8 })
    if (slot.kind === 'date') {
      const size = fitSize(f.sans, t.date, 13, lineW)
      p.text(f.sans, t.date, cx, lineY - 7, size, INK, 'center')
      p.text(f.sans, 'Date', cx, lineY + 14, 10, MUTED, 'center')
      return
    }
    if (slot.first && images.signature)
      p.image(images.signature, { x: x0 + 6, y: lineY - 52, width: lineW - 12, height: 48 }, 'bottom')
    let y = lineY + 15
    if (slot.name.trim()) {
      p.text(f.sansBold, truncate(f.sansBold, slot.name, 11, lineW), cx, y, 11, INK, 'center')
      y += 13
    }
    if (slot.role.trim()) p.text(f.sans, truncate(f.sans, slot.role, 10, lineW), cx, y, 10, MUTED, 'center')
  })
}

/** Draws one certificate on an empty page. */
export function drawCertificate(
  p: Painter,
  design: Design,
  c: Colours,
  t: CertificateText,
  images: CertificateImages,
  scriptName: boolean,
): void {
  const f = p.fonts
  frame(p, design, c)
  const l = look(p, design, f, c, scriptName)
  const x = l.align === 'center' ? l.left + l.width / 2 : l.left
  const blocks: Block[] = []
  const line = (
    style: { font: DrawFont; size: number; colour: RGB },
    text: string,
    gapAfter: number,
    under = false,
  ) => {
    if (!text.trim()) return
    const size = fitSize(style.font, text, style.size, l.width)
    const script = style.font === f.script
    // Script capitals rise high and its tails drop low, so it gets more room above the baseline.
    const ascent = size * (script ? 0.78 : 0.8)
    const height = size * (script ? 1.05 : 1.1) + (under ? 10 : 0)
    blocks.push({
      height,
      gapAfter,
      draw(top) {
        const base = top + ascent
        const w = p.text(style.font, text, x, base, size, style.colour, l.align)
        if (under) {
          const uw = Math.min(l.width, Math.max(w + 40, 220))
          const ux = l.align === 'center' ? x - uw / 2 : x
          p.line(ux, base + size * (script ? 0.28 : 0.2) + 4, ux + uw, base + size * (script ? 0.28 : 0.2) + 4, {
            color: c.accent,
            width: 1,
          })
        }
      },
    })
  }

  if (images.logo) {
    const h = Math.min(70, p.height * 0.1)
    blocks.push({
      height: h,
      gapAfter: 12,
      draw(top) {
        const box =
          l.align === 'center' ? { x: x - 90, y: top, width: 180, height: h } : { x, y: top, width: 160, height: h }
        if (l.align === 'center') p.image(images.logo!, box, 'top')
        else {
          // Left-aligned designs keep the logo flush left.
          const scale = Math.min(box.width / images.logo!.width, box.height / images.logo!.height)
          p.image(images.logo!, { x, y: top, width: images.logo!.width * scale, height: h }, 'top')
        }
      },
    })
  }
  line({ ...l.school, font: l.school.font }, l.school.upper ? t.school.toUpperCase() : t.school, 10)
  line(l.title, l.title.upper ? t.title.toUpperCase() : t.title, l.divider ? 6 : 18)
  if (l.divider && t.title.trim()) {
    blocks.push({
      height: 14,
      gapAfter: 14,
      draw(top) {
        const y = top + 7
        p.line(x - 110, y, x - 14, y, { color: c.accent, width: 1 })
        p.line(x + 14, y, x + 110, y, { color: c.accent, width: 1 })
        diamond(p, x, y, 5, c.accent)
      },
    })
  }
  line(l.intro, t.intro, 10)
  line(l.name, t.name, 16, l.underline)
  if (design === 'modern' && t.name.trim()) {
    blocks.push({ height: 4, gapAfter: 18, draw: (top) => p.rect({ x, y: top, width: 64, height: 4 }, c.accent) })
  }
  if (t.body.trim()) {
    const maxH = l.signY - 70 - l.top - blocks.reduce((s, b) => s + b.height + b.gapAfter, 0)
    const fitted = fitBlock(
      l.body.font,
      t.body,
      { width: l.width, height: Math.max(l.body.size * 1.4, Math.min(maxH, l.body.size * 1.4 * 4)) },
      l.body.size,
      9,
    )
    blocks.push({
      height: fitted.lines.length * fitted.lineHeight,
      gapAfter: 0,
      draw(top) {
        fitted.lines.forEach((ln, i) =>
          p.text(
            l.body.font,
            ln,
            x,
            top + fitted.size * 0.85 + i * fitted.lineHeight,
            fitted.size,
            l.body.colour,
            l.align,
          ),
        )
      },
    })
  }

  // Centre the stack between the top margin and the signatures.
  const total = blocks.reduce((s, b, i) => s + b.height + (i < blocks.length - 1 ? b.gapAfter : 0), 0)
  const room = l.signY - 64 - l.top
  let top = l.top + Math.max(0, (room - total) / 2)
  for (const b of blocks) {
    b.draw(top)
    top += b.height + b.gapAfter
  }
  signatureSlots(p, l, t, f, c, images, design)
}
