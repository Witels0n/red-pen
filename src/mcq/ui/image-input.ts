// Turning a chosen, dropped or pasted file into a stored picture: decoded by the browser, downscaled
// to at most MAX_IMAGE_SIDE on the longer side and re-encoded through a canvas (PNG when it has
// transparency, otherwise JPEG). Nothing leaves the page.
import { encodingFor, fitWithin, hasTransparency, MAX_IMAGE_BYTES, sizeText, sourceProblem } from '../core/images'
import type { QuestionImage } from '../core/model'

export class ImageInputError extends Error {
  override name = 'ImageInputError'
}

function dataUrlSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4)
}

/** A stored picture from a file. Throws ImageInputError with a sentence for the teacher. */
export async function pictureFromFile(file: File): Promise<QuestionImage> {
  const problem = sourceProblem(file)
  if (problem) throw new ImageInputError(problem)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageInputError(
      `"${file.name || 'That picture'}" could not be opened. Save it as a PNG or JPEG and try again.`,
    )
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new ImageInputError('This browser could not prepare the picture.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const transparent = hasTransparency(ctx.getImageData(0, 0, width, height).data)
    let encoding = encodingFor(transparent)
    let src = canvas.toDataURL(encoding.type, encoding.quality)
    if (encoding.type === 'image/png' && dataUrlSize(src) > MAX_IMAGE_BYTES) {
      // A large picture with transparency: flatten it onto white and store it as JPEG instead.
      encoding = encodingFor(false)
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      src = canvas.toDataURL(encoding.type, encoding.quality)
    } else if (encoding.type === 'image/jpeg') {
      // JPEG has no transparency; draw on white so nothing turns black.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      src = canvas.toDataURL(encoding.type, encoding.quality)
    }
    if (dataUrlSize(src) > MAX_IMAGE_BYTES) {
      throw new ImageInputError(`This picture is still too large after shrinking (over ${sizeText(MAX_IMAGE_BYTES)}).`)
    }
    return { src, width, height }
  } finally {
    bitmap.close()
  }
}

/** The first picture file in a paste or drop, if any. */
export function pictureFile(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return data.files?.[0] ?? null
}
