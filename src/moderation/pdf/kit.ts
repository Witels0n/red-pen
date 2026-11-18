// Drawing kit for the moderation forms: bordered table rows that grow with their text and move to
// a new page when they do not fit, text with bold runs, title boxes, logos and circled words.
// pdf-lib with its standard fonts, nothing remote. y runs down from the top of the page.
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import { encodable, type Fonts } from '../../shared/pdf/layout'

export const BLACK = rgb(0, 0, 0)
export const GREY = rgb(0.75, 0.75, 0.75)
export const LIGHT = rgb(0.95, 0.95, 0.95)
export const SILVER = rgb(0.85, 0.85, 0.85)

interface Piece {
  text: string
  font: PDFFont
  width: number
}

export interface Line {
  pieces: Piece[]
  width: number
}

/** Splits "plain **bold** plain" into runs. Without `markup` the whole text is one run. */
function runs(text: string, markup: boolean, bold: boolean): { text: string; bold: boolean }[] {
  if (!markup) return [{ text, bold }]
  return text
    .split('**')
    .map((part, i) => ({ text: part, bold: i % 2 === 1 ? !bold : bold }))
    .filter((r) => r.text !== '')
}

export interface TextStyle {
  size: number
  bold?: boolean
  /** Read **double asterisks** as bold. Never set for text a teacher typed. */
  markup?: boolean
}

/** Wraps text to `width`, keeping its own line breaks and breaking words that are wider than a line. */
export function wrapText(fonts: Fonts, text: string, width: number, style: TextStyle): Line[] {
  const lines: Line[] = []
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line: Line = { pieces: [], width: 0 }
    const push = () => {
      lines.push(line)
      line = { pieces: [], width: 0 }
    }
    // A space at the end of one run still separates it from the next.
    let spaced = false
    for (const run of runs(paragraph, style.markup ?? false, style.bold ?? false)) {
      const font = run.bold ? fonts.bold : fonts.regular
      const space = font.widthOfTextAtSize(' ', style.size)
      for (const token of encodable(font, run.text).match(/ +|[^ ]+/g) ?? []) {
        if (token.startsWith(' ')) {
          spaced = true
          continue
        }
        let word = token
        const gap = spaced && line.pieces.length > 0 ? space : 0
        spaced = false
        let w = font.widthOfTextAtSize(word, style.size)
        if (line.pieces.length > 0 && line.width + gap + w > width) {
          push()
        } else if (gap > 0) {
          line.pieces.push({ text: ' ', font, width: gap })
          line.width += gap
        }
        while (w > width && word.length > 1) {
          let cut = word.length - 1
          while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), style.size) > width) cut--
          const head = word.slice(0, cut)
          line.pieces.push({ text: head, font, width: font.widthOfTextAtSize(head, style.size) })
          push()
          word = word.slice(cut)
          w = font.widthOfTextAtSize(word, style.size)
        }
        line.pieces.push({ text: word, font, width: w })
        line.width += w
      }
    }
    lines.push(line)
  }
  return lines
}

export function drawLine(page: PDFPage, line: Line, x: number, baseline: number, size: number, color = BLACK): void {
  let at = x
  for (const piece of line.pieces) {
    if (piece.text !== ' ') {
      page.drawText(piece.text, { x: at, y: page.getHeight() - baseline, size, font: piece.font, color })
    }
    at += piece.width
  }
}

/** One line of text, shrunk (down to `min`) and then cut short so it never passes `width`. */
export function fitted(
  fonts: Fonts,
  text: string,
  width: number,
  style: TextStyle & { min?: number },
): { line: Line; size: number } {
  const font = style.bold ? fonts.bold : fonts.regular
  let clean = encodable(font, text.replace(/\s+/g, ' ').trim())
  let size = style.size
  const min = style.min ?? Math.min(style.size, 6)
  while (size > min && font.widthOfTextAtSize(clean, size) > width) size -= 0.25
  if (font.widthOfTextAtSize(clean, size) > width) {
    while (clean.length > 1 && font.widthOfTextAtSize(`${clean}...`, size) > width) clean = clean.slice(0, -1)
    clean = `${clean.trimEnd()}...`
  }
  const w = font.widthOfTextAtSize(clean, size)
  return { line: { pieces: clean ? [{ text: clean, font, width: w }] : [], width: w }, size }
}

export interface Cell {
  width: number
  text?: string
  size?: number
  bold?: boolean
  markup?: boolean
  fill?: RGB
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle'
  /** A number such as "1." drawn at the left, with the text hanging to its right. */
  label?: string
  /** How far the text starts from the cell's left padding when there is a label. */
  hang?: number
  /** Keep to one line, shrinking the text to fit. */
  oneLine?: boolean
  /** Draw no border (for a spacer in a row). */
  open?: boolean
  /** Do not draw these sides, where a neighbour already has. */
  noTop?: boolean
  noBottom?: boolean
}

export interface RowStyle {
  size: number
  /** The height of one line of text, as a multiple of its size. */
  leading: number
  padX: number
  padY: number
  minHeight: number
  border: number
}

export const ROW: RowStyle = { size: 9, leading: 1.28, padX: 3.5, padY: 1.6, minHeight: 0, border: 0.6 }

interface Laid {
  cell: Cell
  lines: Line[]
  size: number
}

function layCell(fonts: Fonts, cell: Cell, style: RowStyle): Laid {
  const size = cell.size ?? style.size
  const inner = cell.width - 2 * style.padX - (cell.label !== undefined ? (cell.hang ?? 14) : 0)
  const text = cell.text ?? ''
  if (cell.oneLine) {
    const one = fitted(fonts, text, inner, { size, bold: cell.bold })
    return { cell, lines: [one.line], size: one.size }
  }
  return {
    cell,
    lines: text === '' ? [] : wrapText(fonts, text, inner, { size, bold: cell.bold, markup: cell.markup }),
    size,
  }
}

function rowHeight(laid: Laid[], style: RowStyle): number {
  let h = style.minHeight
  for (const l of laid) h = Math.max(h, l.lines.length * l.size * style.leading + 2 * style.padY)
  return h
}

/** How tall a row would be, without drawing it. */
export function measureRow(fonts: Fonts, cells: Cell[], style: RowStyle = ROW): number {
  return rowHeight(
    cells.map((c) => layCell(fonts, c, style)),
    style,
  )
}

export function strokeRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  thickness: number,
  fill?: RGB,
): void {
  page.drawRectangle({
    x,
    y: page.getHeight() - y - h,
    width: w,
    height: h,
    borderWidth: thickness,
    borderColor: BLACK,
    ...(fill ? { color: fill } : {}),
  })
}

export function rule(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness = 0.6): void {
  const H = page.getHeight()
  page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness, color: BLACK })
}

/** Draws a row of bordered cells with its top edge at y, and returns its height. */
export function drawRow(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  y: number,
  cells: Cell[],
  style: RowStyle = ROW,
  height?: number,
): number {
  const laid = cells.map((c) => layCell(fonts, c, style))
  const h = Math.max(height ?? 0, rowHeight(laid, style))
  let left = x
  for (const { cell, lines, size } of laid) {
    if (cell.fill) {
      page.drawRectangle({ x: left, y: page.getHeight() - y - h, width: cell.width, height: h, color: cell.fill })
    }
    if (!cell.open) {
      const right = left + cell.width
      if (!cell.noTop) rule(page, left, y, right, y, style.border)
      if (!cell.noBottom) rule(page, left, y + h, right, y + h, style.border)
      rule(page, left, y, left, y + h, style.border)
      rule(page, right, y, right, y + h, style.border)
    }
    const lead = size * style.leading
    const block = lines.length * lead
    const top = cell.valign === 'middle' ? y + (h - block) / 2 : y + style.padY
    const hang = cell.label !== undefined ? (cell.hang ?? 14) : 0
    const inner = cell.width - 2 * style.padX - hang
    if (cell.label !== undefined) {
      page.drawText(encodable(fonts.regular, cell.label), {
        x: left + style.padX,
        y: page.getHeight() - (top + size * 0.86 + (lead - size) / 2),
        size,
        font: cell.bold ? fonts.bold : fonts.regular,
        color: BLACK,
      })
    }
    lines.forEach((line, i) => {
      const start = left + style.padX + hang
      const lx =
        cell.align === 'center'
          ? start + (inner - line.width) / 2
          : cell.align === 'right'
            ? start + inner - line.width
            : start
      drawLine(page, line, lx, top + i * lead + size * 0.86 + (lead - size) / 2, size)
    })
    left += cell.width
  }
  return h
}

/** A grey title box with a heavy double border, and up to two centred lines. */
export function titleBox(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  y: number,
  w: number,
  h: number,
  lines: { text: string; size: number }[],
): void {
  strokeRect(page, x, y, w, h, 2.2)
  strokeRect(page, x + 3, y + 3, w - 6, h - 6, 0.8, GREY)
  const total = lines.reduce((t, l) => t + l.size * 1.15, 0)
  let at = y + (h - total) / 2
  for (const l of lines) {
    const fit = fitted(fonts, l.text, w - 16, { size: l.size, bold: true, min: 8 })
    drawLine(page, fit.line, x + (w - fit.line.width) / 2, at + fit.size * 0.92, fit.size)
    at += l.size * 1.15
  }
}

/** A bold label followed by its value on a ruled line. Returns where it ends. */
export function ruledField(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  baseline: number,
  label: string,
  value: string,
  lineWidth: number,
  size: number,
): number {
  const w = fonts.bold.widthOfTextAtSize(label, size)
  page.drawText(label, { x, y: page.getHeight() - baseline, size, font: fonts.bold, color: BLACK })
  const start = x + w + 4
  rule(page, start, baseline + 1.5, start + lineWidth, baseline + 1.5, 0.8)
  if (value.trim() !== '') {
    const fit = fitted(fonts, value, lineWidth - 4, { size, min: 7 })
    drawLine(page, fit.line, start + 2, baseline - 1, fit.size)
  }
  return start + lineWidth
}

/** An oval drawn round a word, the way a pen circles the answer that applies. */
export function circle(page: PDFPage, x: number, baseline: number, width: number, size: number): void {
  page.drawEllipse({
    x: x + width / 2,
    y: page.getHeight() - baseline + size * 0.3,
    xScale: width / 2 + size * 0.28,
    yScale: size * 0.68,
    borderWidth: 1,
    borderColor: BLACK,
  })
}

/** A cross through a box, for the YES or NO that applies. */
export function cross(page: PDFPage, x: number, y: number, w: number, h: number): void {
  const inset = Math.min(w, h) * 0.22
  rule(page, x + inset, y + inset, x + w - inset, y + h - inset, 1.2)
  rule(page, x + inset, y + h - inset, x + w - inset, y + inset, 1.2)
}

function bytesOf(dataUrl: string): Uint8Array {
  const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** A logo stored as a PNG or JPEG data URL, or null when there is none or it cannot be read. */
export async function embedLogo(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
  if (!dataUrl) return null
  try {
    return dataUrl.startsWith('data:image/png')
      ? await doc.embedPng(bytesOf(dataUrl))
      : await doc.embedJpg(bytesOf(dataUrl))
  } catch {
    return null
  }
}

/** Draws the logo as large as fits the box, against its left edge and centred top to bottom. */
export function drawLogo(page: PDFPage, logo: PDFImage | null, x: number, y: number, maxW: number, maxH: number): void {
  if (!logo) return
  const scale = Math.min(maxW / logo.width, maxH / logo.height)
  const w = logo.width * scale
  const h = logo.height * scale
  page.drawImage(logo, { x, y: page.getHeight() - y - (maxH + h) / 2, width: w, height: h })
}

export interface Margins {
  left: number
  right: number
  top: number
  bottom: number
}

/** Writes rows and paragraphs down a page, starting a new page when the next one does not fit. */
export class Sheet {
  page: PDFPage
  y: number

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly size: [number, number],
    readonly margins: Margins,
  ) {
    this.page = doc.addPage(size)
    this.y = margins.top
  }

  get left(): number {
    return this.margins.left
  }

  get width(): number {
    return this.size[0] - this.margins.left - this.margins.right
  }

  get bottom(): number {
    return this.size[1] - this.margins.bottom
  }

  /** Starts a new page unless `height` more points fit on this one. Returns whether it did. */
  ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false
    this.page = this.doc.addPage(this.size)
    this.y = this.margins.top
    return true
  }

  gap(height: number): void {
    this.y += height
  }

  row(cells: Cell[], style: RowStyle = ROW, x = this.left): void {
    this.ensure(measureRow(this.fonts, cells, style))
    this.y += drawRow(this.page, this.fonts, x, this.y, cells, style)
  }

  /** A paragraph. `keep` is the height that must still fit below it, so a heading stays with its table. */
  text(text: string, style: TextStyle & { indent?: number; keep?: number; leading?: number }): void {
    const indent = style.indent ?? 0
    const lines = wrapText(this.fonts, text, this.width - indent, style)
    const lead = style.size * (style.leading ?? 1.2)
    this.ensure(lines.length * lead + (style.keep ?? 0))
    for (const line of lines) {
      drawLine(this.page, line, this.left + indent, this.y + style.size * 0.9, style.size)
      this.y += lead
    }
  }
}

/** "Page 1 of 2" at the foot of each page of a form that runs over one page. */
export function pageNumbers(doc: PDFDocument, fonts: Fonts, right: number): void {
  const pages = doc.getPages()
  if (pages.length < 2) return
  pages.forEach((page, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    const w = fonts.regular.widthOfTextAtSize(label, 7.5)
    page.drawText(label, { x: page.getWidth() - right - w, y: 16, size: 7.5, font: fonts.regular, color: BLACK })
  })
}
