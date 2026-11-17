// Turns uploads into pixels for the reader: copier PDFs page by page, and phone photos.
// Main thread only (uses pdf.js and the DOM).
import { loadPdf, type PdfDocument } from '../pdf/pdf-worker'
import { WORKING_LONG_SIDE } from './image'

/** Copier scans are rendered at this resolution: bubbles about 36 pixels across. */
export const SCAN_DPI = 200

export class PhotoDecodeError extends Error {
  override name = 'PhotoDecodeError'
}

/** Renders one page (1-based) of an opened PDF at `dpi`, white background. */
export async function pageToImageData(pdf: PdfDocument, pageNumber: number, dpi = SCAN_DPI): Promise<ImageData> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  // Very large pages (A3 scans) are capped so memory stays sane on phones.
  const scale = Math.min(dpi / 72, WORKING_LONG_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot draw the page.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  page.cleanup()
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 0 // frees the backing store straight away (Safari keeps it otherwise)
  return data
}

/** Every page of a PDF, one at a time, so a 40-page scan never holds 40 images in memory. */
export async function* pdfPagesToImageData(
  bytes: Uint8Array,
  dpi = SCAN_DPI,
): AsyncGenerator<{ page: number; pages: number; image: ImageData }> {
  const pdf = await loadPdf(bytes)
  try {
    for (let n = 1; n <= pdf.numPages; n++)
      yield { page: n, pages: pdf.numPages, image: await pageToImageData(pdf, n, dpi) }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/**
 * Decodes a photo (JPG or PNG; HEIC where the browser can), upright according to its EXIF
 * orientation, downscaled so its longer side is at most `maxSide`.
 */
export async function photoToImageData(file: Blob, maxSide = WORKING_LONG_SIDE): Promise<ImageData> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const heic = /heic|heif/i.test(file.type) || ('name' in file && /\.hei[cf]$/i.test(String(file.name)))
    throw new PhotoDecodeError(
      heic
        ? 'This browser cannot open HEIC photos. On the iPhone, choose Settings, Camera, Formats, Most Compatible, or share the photo as a JPG.'
        : 'This photo could not be opened. Use a JPG or PNG photo.',
    )
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot draw the photo.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const data = ctx.getImageData(0, 0, width, height)
  canvas.width = canvas.height = 0
  return data
}

/** Whether a file is something the reader can take: a PDF, or an image the browser may decode. */
export function isReadableUpload(file: File): 'pdf' | 'photo' | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) return 'photo'
  return null
}
