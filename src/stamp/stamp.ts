import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { displayedSize, placeUpright, type PageBox } from '../shared/pdf/page-geometry'
import {
  hexToRgb,
  mmToPt,
  placeSlot,
  placeWatermark,
  selectPages,
  slotTexts,
  watermarkFontSize,
  watermarkText,
  type FontName,
  type Placement,
  type Slot,
  type StampSettings,
} from './layout'

// Draws the stamps into the page content with pdf-lib: real vector text in the standard PDF
// fonts, so it stays sharp at any zoom and can be searched.

/** A logo the teacher chose, as PNG or JPEG bytes. */
export interface Logo {
  bytes: Uint8Array
  type: 'png' | 'jpeg'
  /** Width over height. */
  aspect: number
}

const FONTS: Record<FontName, { regular: StandardFonts; bold: StandardFonts }> = {
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
}

/** Drop characters the standard font cannot encode, so odd input never fails the save. */
export function encodable(font: PDFFont, s: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...s].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
}

interface Resources {
  text: PDFFont
  watermark: PDFFont
  logo: PDFImage | null
}

async function embedResources(doc: PDFDocument, s: StampSettings, logo: Logo | null): Promise<Resources> {
  const family = FONTS[s.text.font]
  return {
    text: await doc.embedFont(s.text.bold ? family.bold : family.regular),
    watermark: await doc.embedFont(StandardFonts.HelveticaBold),
    logo: logo ? await (logo.type === 'png' ? doc.embedPng(logo.bytes) : doc.embedJpg(logo.bytes)) : null,
  }
}

/** Draw `text` with its baseline starting at a displayed-page placement, upright on the displayed page. */
function drawAt(
  page: PDFPage,
  box: PageBox,
  rotation: number,
  text: string,
  at: Placement,
  options: { font: PDFFont; size: number; colour: string; opacity?: number },
): void {
  const o = placeUpright(box, rotation, at.x, at.y)
  const c = hexToRgb(options.colour)
  page.drawText(text, {
    x: o.x,
    y: o.y,
    size: options.size,
    font: options.font,
    color: rgb(c.r, c.g, c.b),
    opacity: options.opacity ?? 1,
    rotate: degrees(o.angle + at.angle),
  })
}

/** Stamp one page. `pageNumber` is null when page numbers are off for it. */
function stampPage(
  page: PDFPage,
  s: StampSettings,
  res: Resources,
  logo: Logo | null,
  pageNumber: number | null,
  total: number,
  today: Date,
): void {
  const box = page.getCropBox()
  const rotation = page.getRotation().angle
  const size = displayedSize(box, rotation)
  const margin = mmToPt(s.text.margin)

  const words = encodable(res.watermark, watermarkText(s.watermark))
  if (words) {
    const widthAtOne = res.watermark.widthOfTextAtSize(words, 1)
    const fontSize = watermarkFontSize(s.watermark.size, size, widthAtOne, s.watermark.diagonal)
    const cap = res.watermark.heightAtSize(fontSize, { descender: false })
    const at = placeWatermark(size, widthAtOne * fontSize, cap, s.watermark.diagonal)
    drawAt(page, box, rotation, words, at, {
      font: res.watermark,
      size: fontSize,
      colour: s.watermark.colour,
      opacity: s.watermark.opacity,
    })
  }

  let logoWidth = 0
  const logoHeight = s.logo.height
  if (res.logo && logo) {
    logoWidth = logoHeight * logo.aspect
    const x = s.logo.slot === 'top-left' ? margin : size.width - margin - logoWidth
    const o = placeUpright(box, rotation, x, margin + logoHeight)
    page.drawImage(res.logo, { x: o.x, y: o.y, width: logoWidth, height: logoHeight, rotate: degrees(o.angle) })
  }

  const fontSize = s.text.size
  const cap = res.text.heightAtSize(fontSize, { descender: false })
  const gap = logoWidth > 0 ? logoWidth + fontSize * 0.6 : 0
  for (const [slot, raw] of Object.entries(slotTexts(s, pageNumber, total, today)) as [Slot, string][]) {
    const text = encodable(res.text, raw)
    if (!text.trim()) continue
    const width = res.text.widthOfTextAtSize(text, fontSize)
    const at = placeSlot(slot, size, width, cap, margin, {
      insetLeft: slot === 'top-left' && s.logo.slot === 'top-left' ? gap : 0,
      insetRight: slot === 'top-right' && s.logo.slot === 'top-right' ? gap : 0,
      bandHeight: res.logo ? logoHeight : 0,
    })
    drawAt(page, box, rotation, text, at, { font: res.text, size: fontSize, colour: s.text.colour })
  }
}

/** The page number each chosen page gets, by 0-based index, and the total the "of" counts to. */
export function numbering(
  s: StampSettings,
  chosen: readonly number[],
): { numbers: Map<number, number>; total: number } {
  const numbers = new Map<number, number>()
  chosen.forEach((index, i) => numbers.set(index, s.numbers.start + i))
  return { numbers, total: s.numbers.start + chosen.length - 1 }
}

/** A stamped copy of a whole PDF. Throws if the custom range cannot be read. */
export async function stampPdf(
  bytes: Uint8Array,
  s: StampSettings,
  logo: Logo | null,
  today = new Date(),
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const selection = selectPages(s.scope, s.range, doc.getPageCount())
  if (!selection.ok) throw new Error(selection.error)
  const res = await embedResources(doc, s, logo)
  const { numbers, total } = numbering(s, selection.pages)
  const pages = doc.getPages()
  for (const index of selection.pages) {
    stampPage(pages[index], s, res, logo, s.numbers.on ? numbers.get(index)! : null, total, today)
  }
  return doc.save()
}

/**
 * A one-page PDF of page `index` of `source` as it will look stamped, for the live preview.
 * Pages outside the selection come back unstamped.
 */
export async function previewPage(
  source: PDFDocument,
  index: number,
  s: StampSettings,
  logo: Logo | null,
  today = new Date(),
): Promise<{ bytes: Uint8Array; stamped: boolean }> {
  const out = await PDFDocument.create()
  const [page] = await out.copyPages(source, [index])
  out.addPage(page)
  const selection = selectPages(s.scope, s.range, source.getPageCount())
  const stamped = selection.ok && selection.pages.includes(index)
  if (stamped) {
    const res = await embedResources(out, s, logo)
    const { numbers, total } = numbering(s, selection.pages)
    stampPage(page, s, res, logo, s.numbers.on ? numbers.get(index)! : null, total, today)
  }
  return { bytes: await out.save(), stamped }
}
