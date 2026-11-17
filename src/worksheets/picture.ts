// Reads a picture for a labelling activity and shrinks it to a JPEG small enough to keep in the
// browser's storage. Everything happens on this device.
import type { DiagramPicture } from './core/model'

/** The longest side of a stored picture, in pixels: sharp enough for A4, small enough to store. */
export const MAX_PICTURE_SIDE = 1400

export class PictureError extends Error {
  override name = 'PictureError'
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to <img>, which reads a few more formats (for example SVG).
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The size to draw at so the longest side is at most `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function readPicture(file: File): Promise<DiagramPicture> {
  let image: CanvasImageSource & { width: number; height: number }
  try {
    image = await decode(file)
  } catch {
    throw new PictureError(`"${file.name}" could not be opened as a picture. Try a PNG or JPG.`)
  }
  if (!image.width || !image.height) throw new PictureError(`"${file.name}" has no size.`)
  const size = fitWithin(image.width, image.height, MAX_PICTURE_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PictureError('This browser could not prepare the picture.')
  // JPEG has no transparency: put see-through parts on white paper.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(image, 0, 0, size.width, size.height)
  if ('close' in image && typeof image.close === 'function') image.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: size.width, height: size.height }
}
