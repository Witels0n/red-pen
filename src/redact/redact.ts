import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { placeUpright, type PageBox } from '../shared/pdf/page-geometry'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { boxToPixels, fractionToDisplay, renderScale } from './geometry'
import { boxesOnPage, redactedPages, type RedactionBox } from './model'

// True redaction. A page with a box is drawn as a picture by pdf.js, the boxes are painted onto
// the picture, and the page is replaced by that picture alone: the text, images and form fields
// under a box are not in the file any more, so they cannot be copied, searched or uncovered.
// Pages without a box are copied as they are.

export interface RedactOptions {
  /** Resolution of the picture a redacted page becomes. */
  dpi: number
  /** The anonymised name written in labelled boxes ("Learner 07"). */
  label: string
  /** The new file's title. The original's title, author and other details are not copied. */
  title: string
  /** Called before each page, with its 0-based index and the page count. */
  onPage?: (index: number, count: number) => void
}

const JPEG_QUALITY = 0.9

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('The page could not be turned into a picture.'))
        else void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/** Write `text` centred in a box, upright on the displayed page, as large as fits. */
function drawLabel(page: PDFPage, font: PDFFont, box: RedactionBox, size: PageBox, rotation: number, text: string) {
  const r = fractionToDisplay(box, size, rotation)
  const widthAtOne = font.widthOfTextAtSize(text, 1)
  const fontSize = Math.min(r.height * 0.6, (r.width * 0.9) / Math.max(widthAtOne, 0.01), 36)
  if (fontSize < 3) return
  const cap = font.heightAtSize(fontSize, { descender: false })
  const width = widthAtOne * fontSize
  const o = placeUpright(size, rotation, r.x + (r.width - width) / 2, r.y + r.height / 2 + cap / 2)
  const ink = box.fill === 'black' ? rgb(1, 1, 1) : rgb(0, 0, 0)
  page.drawText(text, { x: o.x, y: o.y, size: fontSize, font, color: ink, rotate: degrees(o.angle) })
}

/** A redacted copy of the PDF in `bytes`, with `boxes` applied to every page they cover. */
export async function redactPdf(
  bytes: Uint8Array,
  boxes: readonly RedactionBox[],
  options: RedactOptions,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false })
  const count = source.getPageCount()
  const pdf = await loadPdf(bytes)
  try {
    const out = await PDFDocument.create()
    out.setTitle(options.title)
    out.setProducer('Red Pen')
    out.setCreator('Red Pen')
    const font = await out.embedFont(StandardFonts.HelveticaBold)
    const redact = new Set(redactedPages(boxes, count))

    for (let i = 0; i < count; i++) {
      options.onPage?.(i, count)
      if (!redact.has(i + 1)) {
        const [copied] = await out.copyPages(source, [i])
        out.addPage(copied)
        continue
      }
      const original = source.getPage(i)
      const box = original.getCropBox()
      const rotation = original.getRotation().angle
      const onPage = boxesOnPage(boxes, i + 1)

      // Render without the page's rotation, so the picture lines up with the page's own space.
      const page = await pdf.getPage(i + 1)
      const scale = renderScale(box, options.dpi)
      const viewport = page.getViewport({ scale, rotation: 0 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      await page.render({ canvas, viewport }).promise
      const ctx = canvas.getContext('2d')!
      for (const b of onPage) {
        const px = boxToPixels(b, box, rotation, scale)
        ctx.fillStyle = b.fill === 'black' ? '#000' : '#fff'
        ctx.fillRect(px.x, px.y, px.width, px.height)
      }
      const jpeg = await canvasToJpeg(canvas)
      canvas.width = 0 // let the browser free the pixels now
      page.cleanup()

      const image = await out.embedJpg(jpeg)
      const redacted = out.addPage([box.width, box.height])
      redacted.drawImage(image, { x: 0, y: 0, width: box.width, height: box.height })
      redacted.setRotation(degrees(rotation))
      const size = { x: 0, y: 0, width: box.width, height: box.height }
      const supported = new Set(font.getCharacterSet())
      const label = [...options.label.trim()].filter((ch) => supported.has(ch.codePointAt(0)!)).join('')
      if (label) for (const b of onPage) if (b.label) drawLabel(redacted, font, b, size, rotation, label)
    }
    return await out.save()
  } finally {
    void pdf.loadingTask.destroy()
  }
}
