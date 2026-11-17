// Where each photo goes on its PDF page. Pure (tests/scan-layout.test.ts).

export type PageSize = 'a4' | 'letter' | 'fit'

export const PAGE_SIZES: readonly { value: PageSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'fit', label: 'Fit to photo' },
]

/** Margins around the photo, in millimetres. */
export const MARGINS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 5, label: 'Narrow (5 mm)' },
  { value: 12, label: 'Normal (12 mm)' },
]

export function isPageSize(v: unknown): v is PageSize {
  return PAGE_SIZES.some((s) => s.value === v)
}

/** PDF points per millimetre (72 points to the inch). */
export const PT_PER_MM = 72 / 25.4

/** Portrait sizes in points. */
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const

export interface Placement {
  pageWidth: number
  pageHeight: number
  /** The photo's rectangle on the page, in points from the bottom left (as pdf-lib draws). */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The page size and where the photo sits on it. A4 and Letter turn landscape for a landscape
 * photo; the photo is scaled to fit inside the margins and centred. "Fit to photo" makes the
 * page the photo's shape, its longer side as long as A4's, plus the margins.
 */
export function placeImage(imageWidth: number, imageHeight: number, size: PageSize, marginMm: number): Placement {
  const margin = Math.max(0, marginMm) * PT_PER_MM
  const landscape = imageWidth > imageHeight
  if (size === 'fit') {
    const long = SIZES.a4[1] - 2 * margin
    const scale = long / Math.max(imageWidth, imageHeight)
    const width = imageWidth * scale
    const height = imageHeight * scale
    return { pageWidth: width + 2 * margin, pageHeight: height + 2 * margin, x: margin, y: margin, width, height }
  }
  const [short, long] = SIZES[size]
  const pageWidth = landscape ? long : short
  const pageHeight = landscape ? short : long
  const boxW = pageWidth - 2 * margin
  const boxH = pageHeight - 2 * margin
  const scale = Math.min(boxW / imageWidth, boxH / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height }
}

/** "about 850 KB", "about 3.4 MB". */
export function describeBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `about ${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/**
 * Estimates the size of the whole PDF from a few sample pages encoded at preview size:
 * JPEG size grows roughly with the number of pixels, a little less than in proportion.
 */
export function estimatePdfBytes(
  samples: readonly { bytes: number; pixels: number; fullPixels: number }[],
  pageCount: number,
): number {
  if (samples.length === 0 || pageCount === 0) return 0
  let perPage = 0
  for (const s of samples) perPage += s.bytes * Math.pow(s.fullPixels / Math.max(1, s.pixels), 0.85)
  perPage /= samples.length
  // A few hundred bytes of PDF structure per page, plus the file's own.
  return Math.round((perPage + 400) * pageCount + 1000)
}
