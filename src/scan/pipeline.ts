// The steps from a photo to a finished page: decode, shrink, find the paper, straighten, turn,
// filter and encode. Runs in the scan worker (scan.worker.ts), or on the page itself in browsers
// without OffscreenCanvas in workers. Uses OffscreenCanvas where it exists, otherwise a <canvas>.
import { detectPaper } from './detect'
import { applyFilter, type ScanFilter } from './filters'
import { FULL_QUAD, scaleQuad, straightenedSize, type Quad, type Turns } from './geometry'
import { turnImage, warpQuad, type RgbaImage } from './warp'

/** Photos are kept at most this many pixels on the longer side, which keeps phones responsive. */
export const SOURCE_SIDE = 2400
/** The copy shown in the crop editor and used for thumbnails and size estimates. */
export const PREVIEW_SIDE = 1000
/** Thumbnails in the page grid. */
export const THUMB_SIDE = 360

/** A photo the browser cannot decode. */
export class DecodeError extends Error {
  override name = 'DecodeError'
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function context(c: AnyCanvas): AnyContext {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as AnyContext | null
  if (!ctx) throw new Error('This browser cannot draw images.')
  return ctx
}

function free(c: AnyCanvas): void {
  c.width = c.height = 0 // frees the backing store straight away (Safari keeps it otherwise)
}

async function encode(c: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality })
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The page could not be saved as a JPEG.'))),
      'image/jpeg',
      quality,
    ),
  )
}

async function decodeImage(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; done(): void }> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() }
  } catch {
    // Some browsers decode more formats (HEIC in Safari) through <img> than through createImageBitmap.
    if (typeof document === 'undefined') throw new DecodeError('decode')
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth) throw new Error('empty')
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new DecodeError('decode')
  }
}

/** Decodes an image file, upright, shrunk so the longer side is at most `maxSide`. */
async function decodeToCanvas(blob: Blob, maxSide: number): Promise<AnyCanvas> {
  const img = await decodeImage(blob)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = makeCanvas(width, height)
  const ctx = context(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img.source, 0, 0, width, height)
  img.done()
  return canvas
}

function pixels(c: AnyCanvas): RgbaImage {
  const d = context(c).getImageData(0, 0, c.width, c.height)
  return { width: d.width, height: d.height, data: d.data }
}

function toCanvas(img: RgbaImage): AnyCanvas {
  const c = makeCanvas(img.width, img.height)
  context(c).putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  return c
}

/** One photo, ready to edit. */
export interface IngestedPhoto {
  /** The photo at most SOURCE_SIDE on the longer side, as a JPEG. */
  source: Blob
  sourceWidth: number
  sourceHeight: number
  /** A smaller copy, at most PREVIEW_SIDE on the longer side. */
  preview: Blob
  /** The suggested crop (0 to 1 coordinates), or null when no sheet stood out. */
  corners: Quad | null
}

export async function ingestPhoto(file: Blob): Promise<IngestedPhoto> {
  const full = await decodeToCanvas(file, SOURCE_SIDE)
  const source = await encode(full, 0.92)
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(full.width, full.height))
  const small = makeCanvas(Math.max(1, Math.round(full.width * scale)), Math.max(1, Math.round(full.height * scale)))
  const sctx = context(small)
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(full, 0, 0, small.width, small.height)
  const result = {
    source,
    sourceWidth: full.width,
    sourceHeight: full.height,
    preview: await encode(small, 0.88),
    corners: detectPaper(pixels(small)),
  }
  free(full)
  free(small)
  return result
}

/** How one page is to be finished. */
export interface PageLook {
  corners: Quad
  turns: Turns
  filter: ScanFilter
}

/** Straightens, turns and filters a decoded photo, at most `maxSide` on the longer side. */
function finish(canvas: AnyCanvas, look: PageLook, maxSide: number): RgbaImage {
  const quad = scaleQuad(look.corners ?? FULL_QUAD, canvas.width, canvas.height)
  const size = straightenedSize(quad, maxSide)
  const img = pixels(canvas)
  free(canvas)
  return applyFilter(turnImage(warpQuad(img, quad, size.width, size.height), look.turns), look.filter)
}

/** A finished page as a JPEG. */
export interface RenderedPage {
  jpeg: Blob
  width: number
  height: number
}

/** The finished page at full size, encoded at `quality` (0 to 1). */
export async function renderPage(source: Blob, look: PageLook, quality: number): Promise<RenderedPage> {
  const img = finish(await decodeToCanvas(source, SOURCE_SIDE), look, SOURCE_SIDE)
  const c = toCanvas(img)
  const jpeg = await encode(c, quality)
  free(c)
  return { jpeg, width: img.width, height: img.height }
}

/** A small finished copy of the page, for the page grid and the editor's preview. */
export async function renderThumb(preview: Blob, look: PageLook, side: number): Promise<RgbaImage> {
  return finish(await decodeToCanvas(preview, PREVIEW_SIDE), look, side)
}

/** The size of the preview-sized finished page as a JPEG, with its pixel count. */
export async function sampleSize(
  preview: Blob,
  look: PageLook,
  quality: number,
): Promise<{ bytes: number; pixels: number }> {
  const img = finish(await decodeToCanvas(preview, PREVIEW_SIDE), look, PREVIEW_SIDE)
  const c = toCanvas(img)
  const blob = await encode(c, quality)
  free(c)
  return { bytes: blob.size, pixels: img.width * img.height }
}
