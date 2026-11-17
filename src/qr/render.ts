// Pure drawing: turns a module grid and a style into shapes, then into an SVG string.
// All geometry is in module units; the SVG viewBox scales it to any size.
import { parseHex } from './contrast'
import type { QrMatrix } from './matrix'

export type ModuleShape = 'square' | 'rounded' | 'dots'
export type EyeStyle = 'square' | 'rounded'

export interface QrStyle {
  foreground: string
  background: string
  moduleShape: ModuleShape
  eyeStyle: EyeStyle
  /** The quiet zone around the code, in modules. */
  margin: number
}

export interface QrLogo {
  /** A data: URI of the image. */
  href: string
  /** The image's natural size, used only for its aspect ratio. */
  width: number
  height: number
  /** The logo's longest side as a fraction of the code's width, capped at MAX_LOGO_SIZE. */
  size: number
  /** Draw a box in the background colour behind the logo. */
  padding: boolean
}

/** Larger logos cover too much of the code to scan reliably, even at error correction H. */
export const MAX_LOGO_SIZE = 0.22
export const MIN_LOGO_SIZE = 0.1

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface QrGeometry {
  /** Width and height of the whole image, quiet zone included, in modules. */
  view: number
  /** Every dark module, the three finder eyes and the alignment patterns, as one SVG path (nonzero fill). */
  path: string
  /** Where the logo image goes, when there is one. */
  logo?: Rect
  /** The padding box behind the logo, aligned to the module grid, when asked for. */
  padding?: Rect
}

const n = (v: number) => String(Math.round(v * 100) / 100)

/** A rectangle with its own radius at each corner, clockwise (or anticlockwise to cut a hole). */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: [number, number, number, number],
  clockwise = true,
): string {
  const [tl, tr, br, bl] = r
  const arc = (rad: number, ex: number, ey: number, sweep: number) =>
    rad > 0 ? `A${n(rad)} ${n(rad)} 0 0 ${sweep} ${n(ex)} ${n(ey)}` : `L${n(ex)} ${n(ey)}`
  if (clockwise) {
    return (
      `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}${arc(tr, x + w, y + tr, 1)}` +
      `V${n(y + h - br)}${arc(br, x + w - br, y + h, 1)}` +
      `H${n(x + bl)}${arc(bl, x, y + h - bl, 1)}` +
      `V${n(y + tl)}${arc(tl, x + tl, y, 1)}Z`
    )
  }
  return (
    `M${n(x + tl)} ${n(y)}${arc(tl, x, y + tl, 0)}` +
    `V${n(y + h - bl)}${arc(bl, x + bl, y + h, 0)}` +
    `H${n(x + w - br)}${arc(br, x + w, y + h - br, 0)}` +
    `V${n(y + tr)}${arc(tr, x + w - tr, y, 0)}Z`
  )
}

function eye(x: number, y: number, style: EyeStyle): string {
  const r = (v: number): [number, number, number, number] => (style === 'rounded' ? [v, v, v, v] : [0, 0, 0, 0])
  return (
    roundedRect(x, y, 7, 7, r(2)) +
    roundedRect(x + 1, y + 1, 5, 5, r(1.3), false) +
    roundedRect(x + 2, y + 2, 3, 3, r(0.9))
  )
}

/** The three 7 by 7 finder patterns at the top left, top right and bottom left. */
function inEye(row: number, col: number, size: number): boolean {
  const near = (v: number) => v < 7
  const far = (v: number) => v >= size - 7
  return (near(row) && near(col)) || (near(row) && far(col)) || (far(row) && near(col))
}

/** Alignment pattern centre rows and columns for each version (ISO/IEC 18004 Annex E). */
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
]

/** The centres of the 5 by 5 alignment patterns, which scanners use to correct for perspective. */
export function alignmentCentres(size: number): [number, number][] {
  const version = (size - 17) / 4
  const positions = ALIGNMENT_POSITIONS[version] ?? []
  const last = size - 7
  const centres: [number, number][] = []
  for (const r of positions)
    for (const c of positions) {
      const overlapsEye = (r < 9 && c < 9) || (r < 9 && c >= last - 1) || (r >= last - 1 && c < 9)
      if (!overlapsEye) centres.push([r, c])
    }
  return centres
}

/** An alignment pattern drawn as one solid shape, so dots and rounded modules do not break it up. */
function alignment(x: number, y: number, style: EyeStyle): string {
  const r = (v: number): [number, number, number, number] => (style === 'rounded' ? [v, v, v, v] : [0, 0, 0, 0])
  return (
    roundedRect(x, y, 5, 5, r(1.5)) +
    roundedRect(x + 1, y + 1, 3, 3, r(0.8), false) +
    roundedRect(x + 2, y + 2, 1, 1, r(0.5))
  )
}

/** The logo's rectangle, and the whole modules it clears, both centred on the code. */
function logoLayout(size: number, margin: number, logo: QrLogo): { logo: Rect; cleared: Rect } {
  const longest = size * Math.min(MAX_LOGO_SIZE, Math.max(MIN_LOGO_SIZE, logo.size))
  const aspect = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1
  const w = aspect >= 1 ? longest : longest * aspect
  const h = aspect >= 1 ? longest / aspect : longest
  const centre = size / 2
  const pad = logo.padding ? Math.max(0.5, longest * 0.08) : 0
  const x0 = Math.floor(centre - w / 2 - pad)
  const y0 = Math.floor(centre - h / 2 - pad)
  const x1 = Math.ceil(centre + w / 2 + pad)
  const y1 = Math.ceil(centre + h / 2 + pad)
  return {
    logo: { x: margin + centre - w / 2, y: margin + centre - h / 2, w, h },
    cleared: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  }
}

export function qrGeometry(matrix: QrMatrix, style: QrStyle, logo?: QrLogo): QrGeometry {
  const { size } = matrix
  const m = Math.max(0, Math.round(style.margin))
  const layout = logo ? logoLayout(size, m, logo) : undefined
  const cleared = layout?.cleared
  const inCleared = (r: number, c: number) =>
    !!cleared && c >= cleared.x && c < cleared.x + cleared.w && r >= cleared.y && r < cleared.y + cleared.h
  const dark = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < size && c < size && matrix.isDark(r, c) && !inCleared(r, c)

  // Alignment patterns the logo leaves alone are drawn whole; one the logo touches stays cleared.
  const touchesLogo = ([r, c]: [number, number]) =>
    !!cleared &&
    c + 2 >= cleared.x &&
    c - 2 < cleared.x + cleared.w &&
    r + 2 >= cleared.y &&
    r - 2 < cleared.y + cleared.h
  const aligned = alignmentCentres(size).filter((centre) => !touchesLogo(centre))
  const inAlignment = (r: number, c: number) =>
    aligned.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2)
  const special = (r: number, c: number) => inEye(r, c, size) || inAlignment(r, c)

  const parts: string[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (special(r, c) || !dark(r, c)) continue
      const x = m + c
      const y = m + r
      if (style.moduleShape === 'dots') {
        const rad = 0.45
        parts.push(
          `M${n(x + 0.5 - rad)} ${n(y + 0.5)}a${rad} ${rad} 0 1 1 ${rad * 2} 0a${rad} ${rad} 0 1 1 ${-rad * 2} 0Z`,
        )
      } else if (style.moduleShape === 'rounded') {
        const up = dark(r - 1, c) && !special(r - 1, c)
        const down = dark(r + 1, c) && !special(r + 1, c)
        const left = dark(r, c - 1) && !special(r, c - 1)
        const right = dark(r, c + 1) && !special(r, c + 1)
        const k = 0.5
        parts.push(
          roundedRect(x, y, 1, 1, [
            !up && !left ? k : 0,
            !up && !right ? k : 0,
            !down && !right ? k : 0,
            !down && !left ? k : 0,
          ]),
        )
      } else {
        parts.push(`M${x} ${y}h1v1h-1Z`)
      }
    }
  }
  for (const [r, c] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    parts.push(eye(m + c, m + r, style.eyeStyle))
  }
  for (const [r, c] of aligned) parts.push(alignment(m + c - 2, m + r - 2, style.eyeStyle))

  const geometry: QrGeometry = { view: size + 2 * m, path: parts.join('') }
  if (layout) {
    geometry.logo = layout.logo
    if (logo?.padding) geometry.padding = { ...layout.cleared, x: layout.cleared.x + m, y: layout.cleared.y + m }
  }
  return geometry
}

/** A safe colour for an SVG attribute: the hex itself, or the fallback when it is not one. */
export function safeColour(hex: string, fallback: string): string {
  const rgb = parseHex(hex)
  return rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}` : fallback
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export interface SvgOptions {
  /** Pixel width and height written on the <svg>; omit for a freely scaling image. */
  pixelSize?: number
  /** Accessible name for the image. */
  title?: string
}

/** A standalone SVG document of the code. The logo, if any, is embedded as a data URI. */
export function renderSvg(matrix: QrMatrix, style: QrStyle, logo?: QrLogo, options: SvgOptions = {}): string {
  const g = qrGeometry(matrix, style, logo)
  const fg = safeColour(style.foreground, '#000000')
  const bg = safeColour(style.background, '#ffffff')
  const size = options.pixelSize ? ` width="${options.pixelSize}" height="${options.pixelSize}"` : ''
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${g.view} ${g.view}"${size} role="img">`,
  ]
  if (options.title) out.push(`<title>${escapeAttr(options.title)}</title>`)
  out.push(`<rect width="${g.view}" height="${g.view}" fill="${bg}"/>`)
  out.push(`<path d="${g.path}" fill="${fg}"/>`)
  if (g.padding) {
    const p = g.padding
    out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="1" fill="${bg}"/>`)
  }
  if (g.logo && logo) {
    const l = g.logo
    const href = escapeAttr(logo.href)
    out.push(
      `<image x="${n(l.x)}" y="${n(l.y)}" width="${n(l.w)}" height="${n(l.h)}" preserveAspectRatio="xMidYMid meet" href="${href}" xlink:href="${href}"/>`,
    )
  }
  out.push('</svg>')
  return out.join('')
}
