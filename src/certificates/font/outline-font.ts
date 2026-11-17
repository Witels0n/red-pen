// A small reader for TrueType outlines in a WOFF file, so the bundled fonts (Great Vibes,
// Bricolage Grotesque, Atkinson Hyperlegible) can be drawn in a PDF as vector paths without
// embedding a font program. Reads only what drawing needs: cmap, hmtx, loca and glyf.
// Pure: no DOM, so tests read the same font files from node_modules.
import { unzlibSync } from 'fflate'

/** A font that could not be read. */
export class FontError extends Error {
  override name = 'FontError'
}

type Tables = Map<string, DataView>

/** The tables of a WOFF (version 1) file, inflated where they were compressed. */
export function woffTables(bytes: Uint8Array): Tables {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 44 || view.getUint32(0) !== 0x774f4646) throw new FontError('Not a WOFF font.')
  const count = view.getUint16(12)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
    const offset = view.getUint32(at + 4)
    const compressed = view.getUint32(at + 8)
    const original = view.getUint32(at + 12)
    const raw = bytes.subarray(offset, offset + compressed)
    const data = compressed < original ? unzlibSync(raw) : raw
    tables.set(tag, new DataView(data.buffer, data.byteOffset, data.byteLength))
  }
  return tables
}

/** One step of a glyph outline in font units, y up. Quadratic segments are already cubic. */
type Command =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' }

interface Point {
  x: number
  y: number
  on: boolean
}

function contourCommands(points: Point[], out: Command[]): void {
  const n = points.length
  if (n === 0) return
  // Walk the contour from an on-curve point; with none, from the implied point between the first two.
  const s = points.findIndex((p) => p.on)
  const ordered =
    s >= 0
      ? [...points.slice(s), ...points.slice(0, s)]
      : [
          { x: (points[0].x + points[1 % n].x) / 2, y: (points[0].y + points[1 % n].y) / 2, on: true },
          ...points.slice(1),
          points[0],
        ]
  const start = ordered[0]
  out.push({ op: 'M', x: start.x, y: start.y })
  let current: Point = start
  let control: Point | null = null
  const quad = (c: Point, to: Point) => {
    out.push({
      op: 'C',
      x1: current.x + (2 / 3) * (c.x - current.x),
      y1: current.y + (2 / 3) * (c.y - current.y),
      x2: to.x + (2 / 3) * (c.x - to.x),
      y2: to.y + (2 / 3) * (c.y - to.y),
      x: to.x,
      y: to.y,
    })
    current = to
  }
  for (const p of ordered.slice(1)) {
    if (p.on) {
      if (control) quad(control, p)
      else {
        out.push({ op: 'L', x: p.x, y: p.y })
        current = p
      }
      control = null
    } else {
      if (control) quad(control, { x: (control.x + p.x) / 2, y: (control.y + p.y) / 2, on: true })
      control = p
    }
  }
  if (control) quad(control, start)
  out.push({ op: 'Z' })
}

/** A TrueType font read from a WOFF file: metrics, character mapping and glyph outlines. */
export class OutlineFont {
  readonly unitsPerEm: number
  readonly ascender: number
  readonly descender: number
  private readonly numGlyphs: number
  private readonly numHMetrics: number
  private readonly longLoca: boolean
  private readonly hmtx: DataView
  private readonly loca: DataView
  private readonly glyf: DataView
  private readonly cmap = new Map<number, number>()
  private readonly outlines = new Map<number, Command[]>()

  constructor(bytes: Uint8Array) {
    const t = woffTables(bytes)
    const need = (tag: string) => {
      const table = t.get(tag)
      if (!table) throw new FontError(`The font has no ${tag} table.`)
      return table
    }
    const head = need('head')
    const hhea = need('hhea')
    this.unitsPerEm = head.getUint16(18)
    this.longLoca = head.getInt16(50) === 1
    this.ascender = hhea.getInt16(4)
    this.descender = hhea.getInt16(6)
    this.numHMetrics = hhea.getUint16(34)
    this.numGlyphs = need('maxp').getUint16(4)
    this.hmtx = need('hmtx')
    this.loca = need('loca')
    this.glyf = need('glyf')
    this.readCmap(need('cmap'))
  }

  private readCmap(cmap: DataView): void {
    const count = cmap.getUint16(2)
    let best = -1
    let bestScore = 0
    for (let i = 0; i < count; i++) {
      const platform = cmap.getUint16(4 + i * 8)
      const encoding = cmap.getUint16(6 + i * 8)
      const offset = cmap.getUint32(8 + i * 8)
      const format = cmap.getUint16(offset)
      const score =
        format === 12 && (platform === 3 || platform === 0)
          ? 3
          : format === 4 && (platform === 0 || (platform === 3 && encoding === 1))
            ? 2
            : 0
      if (score > bestScore) {
        best = offset
        bestScore = score
      }
    }
    if (best < 0) throw new FontError('The font has no Unicode character map.')
    if (cmap.getUint16(best) === 12) {
      const groups = cmap.getUint32(best + 12)
      for (let g = 0; g < groups; g++) {
        const at = best + 16 + g * 12
        const startChar = cmap.getUint32(at)
        const endChar = cmap.getUint32(at + 4)
        const startGlyph = cmap.getUint32(at + 8)
        for (let c = startChar; c <= endChar && c - startChar < 0x10000; c++)
          this.cmap.set(c, startGlyph + c - startChar)
      }
      return
    }
    const segX2 = cmap.getUint16(best + 6)
    const ends = best + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const ranges = deltas + segX2
    for (let s = 0; s < segX2; s += 2) {
      const end = cmap.getUint16(ends + s)
      const start = cmap.getUint16(starts + s)
      const delta = cmap.getInt16(deltas + s)
      const rangeOffset = cmap.getUint16(ranges + s)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff
        else {
          const at = ranges + s + rangeOffset + (c - start) * 2
          glyph = cmap.getUint16(at)
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff
        }
        if (glyph !== 0) this.cmap.set(c, glyph)
      }
    }
  }

  /** The glyph for a character, or 0 (the missing glyph) when the font does not have it. */
  glyphIndex(codePoint: number): number {
    return this.cmap.get(codePoint) ?? 0
  }

  /** Whether the font can draw this character. */
  has(codePoint: number): boolean {
    return this.cmap.has(codePoint)
  }

  advance(glyph: number): number {
    const i = Math.min(glyph, this.numHMetrics - 1)
    return this.hmtx.getUint16(i * 4)
  }

  private glyphRange(glyph: number): [number, number] {
    if (glyph >= this.numGlyphs) return [0, 0]
    return this.longLoca
      ? [this.loca.getUint32(glyph * 4), this.loca.getUint32(glyph * 4 + 4)]
      : [this.loca.getUint16(glyph * 2) * 2, this.loca.getUint16(glyph * 2 + 2) * 2]
  }

  /** The outline of a glyph in font units, y up. Empty for a space. */
  outline(glyph: number, depth = 0): Command[] {
    const cached = this.outlines.get(glyph)
    if (cached) return cached
    const [start, end] = this.glyphRange(glyph)
    const out: Command[] = []
    if (end > start && depth < 8) {
      const g = this.glyf
      const contours = g.getInt16(start)
      if (contours >= 0) this.simpleGlyph(start, contours, out)
      else this.compositeGlyph(start, out, depth)
    }
    this.outlines.set(glyph, out)
    return out
  }

  private simpleGlyph(start: number, contours: number, out: Command[]): void {
    const g = this.glyf
    const endPts: number[] = []
    for (let i = 0; i < contours; i++) endPts.push(g.getUint16(start + 10 + i * 2))
    const count = contours === 0 ? 0 : endPts[contours - 1] + 1
    let at = start + 10 + contours * 2
    at += 2 + g.getUint16(at) // skip instructions
    const flags: number[] = []
    while (flags.length < count) {
      const f = g.getUint8(at++)
      flags.push(f)
      if (f & 8) {
        let repeat = g.getUint8(at++)
        while (repeat-- > 0 && flags.length < count) flags.push(f)
      }
    }
    const xs: number[] = []
    let x = 0
    for (const f of flags) {
      if (f & 2) {
        const d = g.getUint8(at++)
        x += f & 16 ? d : -d
      } else if (!(f & 16)) {
        x += g.getInt16(at)
        at += 2
      }
      xs.push(x)
    }
    let y = 0
    const points: Point[] = []
    flags.forEach((f, i) => {
      if (f & 4) {
        const d = g.getUint8(at++)
        y += f & 32 ? d : -d
      } else if (!(f & 32)) {
        y += g.getInt16(at)
        at += 2
      }
      points.push({ x: xs[i], y, on: (f & 1) === 1 })
    })
    let from = 0
    for (const last of endPts) {
      contourCommands(points.slice(from, last + 1), out)
      from = last + 1
    }
  }

  private compositeGlyph(start: number, out: Command[], depth: number): void {
    const g = this.glyf
    let at = start + 10
    let more = true
    while (more) {
      const flags = g.getUint16(at)
      const component = g.getUint16(at + 2)
      at += 4
      let dx: number
      let dy: number
      if (flags & 1) {
        dx = g.getInt16(at)
        dy = g.getInt16(at + 2)
        at += 4
      } else {
        dx = g.getInt8(at)
        dy = g.getInt8(at + 1)
        at += 2
      }
      if (!(flags & 2)) {
        dx = 0 // point matching is rare in these fonts; place the component at the origin
        dy = 0
      }
      let a = 1
      let b = 0
      let c = 0
      let d = 1
      const f2dot14 = (o: number) => g.getInt16(o) / 16384
      if (flags & 8) {
        a = d = f2dot14(at)
        at += 2
      } else if (flags & 0x40) {
        a = f2dot14(at)
        d = f2dot14(at + 2)
        at += 4
      } else if (flags & 0x80) {
        a = f2dot14(at)
        b = f2dot14(at + 2)
        c = f2dot14(at + 4)
        d = f2dot14(at + 6)
        at += 8
      }
      const tx = (px: number, py: number) => ({ x: a * px + c * py + dx, y: b * px + d * py + dy })
      for (const cmd of this.outline(component, depth + 1)) {
        if (cmd.op === 'Z') out.push(cmd)
        else if (cmd.op === 'C') {
          const p1 = tx(cmd.x1, cmd.y1)
          const p2 = tx(cmd.x2, cmd.y2)
          const p = tx(cmd.x, cmd.y)
          out.push({ op: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y })
        } else {
          const p = tx(cmd.x, cmd.y)
          out.push({ op: cmd.op, x: p.x, y: p.y })
        }
      }
      more = (flags & 0x20) !== 0
    }
  }

  /** Characters this font can draw: unknown ones lose their accents, or are dropped. */
  encodable(text: string): string {
    let out = ''
    for (const ch of text.normalize('NFC')) {
      const cp = ch.codePointAt(0)!
      if (this.has(cp)) out += ch
      else if (/\s/.test(ch)) out += ' '
      else {
        const bare = ch.normalize('NFD').replace(/\p{M}/gu, '')
        if (bare && [...bare].every((b) => this.has(b.codePointAt(0)!))) out += bare
      }
    }
    return out
  }

  /** The width of text in points at a font size. */
  widthOf(text: string, size: number): number {
    let units = 0
    for (const ch of this.encodable(text)) units += this.advance(this.glyphIndex(ch.codePointAt(0)!))
    return (units * size) / this.unitsPerEm
  }

  /**
   * An SVG path (y down, as pdf-lib's drawSvgPath expects) for text whose baseline starts at the
   * origin, at a font size in points.
   */
  svgPath(text: string, size: number): string {
    const s = size / this.unitsPerEm
    const n = (v: number) => (Math.round(v * 100) / 100).toString()
    const parts: string[] = []
    let pen = 0
    for (const ch of this.encodable(text)) {
      const glyph = this.glyphIndex(ch.codePointAt(0)!)
      for (const c of this.outline(glyph)) {
        if (c.op === 'Z') parts.push('Z')
        else if (c.op === 'C')
          parts.push(
            `C${n((pen + c.x1) * s)} ${n(-c.y1 * s)} ${n((pen + c.x2) * s)} ${n(-c.y2 * s)} ${n((pen + c.x) * s)} ${n(-c.y * s)}`,
          )
        else parts.push(`${c.op}${n((pen + c.x) * s)} ${n(-c.y * s)}`)
      }
      pen += this.advance(glyph)
    }
    return parts.join('')
  }
}
