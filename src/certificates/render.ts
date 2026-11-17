// Builds the PDF for a Product from the settings and the Recipient list. Runs the same in the
// browser and in tests (no DOM): the fonts and pictures come in as bytes.
import { PDFDocument, type PDFImage } from 'pdf-lib'
import { safeFileBase } from '../shared/pdf/file-names'
import { drawCertificate, type Colours } from './certificate'
import { fontSet, hex, Painter, type OutlineFonts } from './draw'
import { A4, labelCells, placeItems, slipCells, tentCards } from './layouts'
import { fillTemplate, type Recipient } from './merge'
import { themeById, type Product, type Settings } from './model'
import {
  drawBookLabel,
  drawCutLine,
  drawNameLabel,
  drawSlip,
  drawSlipCutLines,
  drawTentCard,
  letteringFont,
} from './sheets'

/** A picture the teacher added: PNG or JPEG bytes. */
export interface Picture {
  bytes: Uint8Array
  type: 'png' | 'jpg'
}

export interface Pictures {
  logo?: Picture
  signature?: Picture
}

export interface RenderInput {
  settings: Settings
  recipients: readonly Recipient[]
  fonts: OutlineFonts
  pictures: Pictures
}

const TITLES: Record<Product, string> = {
  certificate: 'Certificates',
  desk: 'Desk name cards',
  labels: 'Name labels',
  book: 'Book labels',
  slips: 'Award slips',
}

/** Products where each learner can have a PDF of their own. */
export function canSplitPerLearner(product: Product): boolean {
  return product === 'certificate' || product === 'desk'
}

async function embed(doc: PDFDocument, picture?: Picture): Promise<PDFImage | undefined> {
  if (!picture) return undefined
  return picture.type === 'png' ? doc.embedPng(picture.bytes) : doc.embedJpg(picture.bytes)
}

/** How many items each recipient becomes, given copies for labels. */
function expanded(recipients: readonly Recipient[], copies: number): Recipient[] {
  const n = Math.max(1, Math.min(100, Math.floor(copies) || 1))
  return recipients.flatMap((r) => Array<Recipient>(n).fill(r))
}

/** One PDF for the given recipients. */
export async function renderPdf(input: RenderInput): Promise<Uint8Array> {
  const { settings: s, recipients } = input
  const doc = await PDFDocument.create()
  doc.setTitle(TITLES[s.product])
  doc.setCreator('Red Pen')
  doc.setProducer('Red Pen')
  const fonts = await fontSet(doc, input.fonts)
  const theme = themeById(s.theme)
  const colours: Colours = { main: hex(theme.main), accent: hex(theme.accent) }
  const logo = await embed(doc, input.pictures.logo)
  const fill = (template: string, r: Recipient) => fillTemplate(template, r)
  const newPage = (landscape = false) =>
    new Painter(doc.addPage(landscape ? [A4.height, A4.width] : [A4.width, A4.height]), fonts)

  switch (s.product) {
    case 'certificate': {
      const c = s.certificate
      const signature = await embed(doc, input.pictures.signature)
      for (const r of recipients) {
        const p = newPage(c.orientation === 'landscape')
        drawCertificate(
          p,
          c.design,
          colours,
          {
            school: fill(c.school, r),
            title: fill(c.title, r),
            intro: fill(c.intro, r),
            name: fill(c.name, r),
            body: fill(c.body, r),
            date: fill(c.date, r),
            signatories: c.signatories.map((g) => ({ name: fill(g.name, r), role: fill(g.role, r) })),
          },
          { ...(logo ? { logo } : {}), ...(signature ? { signature } : {}) },
          c.scriptName,
        )
      }
      break
    }
    case 'desk': {
      const cards = tentCards()
      let p: Painter | undefined
      recipients.forEach((r, i) => {
        const at = i % cards.length
        if (at === 0) {
          p = newPage()
          drawCutLine(p, cards[1].card.y)
        }
        drawTentCard(
          p!,
          cards[at],
          letteringFont(p!, s.lettering),
          fill(s.desk.line1, r),
          fill(s.desk.line2, r),
          s.desk.bothSides,
          colours,
        )
      })
      break
    }
    case 'labels':
    case 'book': {
      const l = s.product === 'labels' ? s.labels : s.book
      const cells = labelCells(l.layout)
      const items = expanded(recipients, l.copies)
      const pages: Painter[] = []
      placeItems(items.length, cells.length, l.skip).forEach(({ page, cell }, i) => {
        while (pages.length <= page) pages.push(newPage())
        const p = pages[page]
        const font = letteringFont(p, s.lettering)
        const r = items[i]
        if (s.product === 'labels')
          drawNameLabel(
            p,
            cells[cell],
            font,
            fill(s.labels.line1, r),
            fill(s.labels.line2, r),
            s.labels.outlines,
            colours,
          )
        else
          drawBookLabel(
            p,
            cells[cell],
            font,
            fill(s.book.heading, r),
            s.book.rows.map((row) => ({ label: fill(row.label, r), value: fill(row.value, r) })),
            s.book.outlines,
            colours,
            logo,
          )
      })
      break
    }
    case 'slips': {
      const cells = slipCells()
      let p: Painter | undefined
      recipients.forEach((r, i) => {
        const at = i % cells.length
        if (at === 0) {
          p = newPage()
          drawSlipCutLines(p, cells)
        }
        drawSlip(
          p!,
          cells[at],
          letteringFont(p!, s.lettering),
          {
            title: fill(s.slips.title, r),
            body: fill(s.slips.body, r),
            signedBy: fill(s.slips.signedBy, r),
            footer: fill(s.slips.footer, r),
          },
          colours,
          logo,
        )
      })
      break
    }
  }
  if (doc.getPageCount() === 0) newPage()
  return doc.save()
}

/** "Grade 8A certificates.pdf". */
export function combinedFileName(product: Product, listName: string): string {
  const base = safeFileBase(listName, 'class')
  return `${base} ${TITLES[product].toLowerCase()}.pdf`
}

/** A file name per recipient, from their name, made unique: "Thandi Mokoena.pdf", "Thandi Mokoena 2.pdf". */
export function perLearnerFileNames(recipients: readonly Recipient[]): string[] {
  const used = new Set<string>()
  return recipients.map((r, i) => {
    const base = safeFileBase(r.Name ?? '', `learner-${i + 1}`)
    let name = `${base}.pdf`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}.pdf`
    used.add(name.toLowerCase())
    return name
  })
}
