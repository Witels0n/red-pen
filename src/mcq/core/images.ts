// Pictures in questions and options: the pure parts. Pictures are stored in the Assessment as PNG
// or JPEG data URLs, downscaled when added (see ../ui/image-input.ts), and checked on import.
import type { QuestionImage } from './model'

/** The longer side of a stored picture, in pixels. */
export const MAX_IMAGE_SIDE = 1000
/** JPEG quality for pictures without transparency. */
export const JPEG_QUALITY = 0.85
/** The largest file a teacher can add (before downscaling). */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024
/** The largest stored picture (after downscaling), and the largest one an Assessment file may carry. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

export type ImageType = 'image/png' | 'image/jpeg'

/** A width and height scaled down (never up) so the longer side is at most `max`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** Whether any pixel of RGBA data is not fully opaque. */
export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
  return false
}

/** PNG keeps transparency; everything else is stored as JPEG, which is far smaller for photos. */
export function encodingFor(transparent: boolean): { type: ImageType; quality?: number } {
  return transparent ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY }
}

/** The size of a file in words: "2.4 MB", "350 KB". */
export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Why a chosen file cannot be used, before decoding it; null when it may be a picture. */
export function sourceProblem(file: { type: string; size: number; name: string }): string | null {
  const type = file.type.toLowerCase()
  const looksLikeImage = type.startsWith('image/') || (type === '' && /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name))
  if (!looksLikeImage || type === 'image/svg+xml') {
    return `"${file.name || 'That file'}" is not a picture. Use a PNG or JPEG (a photo or screenshot).`
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return `"${file.name || 'That picture'}" is too large (${sizeText(file.size)}). Use a picture under ${sizeText(MAX_SOURCE_BYTES)}.`
  }
  return null
}

const DATA_URL = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]*={0,2})$/

/** The bytes a base64 string holds. */
export function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A data URL for bytes of the given type. */
export function bytesToDataUrl(bytes: Uint8Array, type: ImageType): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
}

/** The type and size in pixels of PNG or JPEG bytes, read from the file header; null for anything else. */
export function imageInfo(bytes: Uint8Array): { type: ImageType; width: number; height: number } | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b)) {
    // The IHDR chunk comes first: width and height as big-endian 32-bit numbers.
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    return width > 0 && height > 0 ? { type: 'image/png', width, height } : null
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // Walk the segments to the first start-of-frame marker, which holds the size.
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3]
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        return width > 0 && height > 0 ? { type: 'image/jpeg', width, height } : null
      }
      if (length < 2) return null
      i += 2 + length
    }
  }
  return null
}

export type ImageCheck = { ok: true; image: QuestionImage; bytes: Uint8Array } | { ok: false; problem: string }

/**
 * Checks a stored picture: a PNG or JPEG data URL whose bytes really are that type, at most
 * MAX_IMAGE_BYTES, with a sensible size. The width and height come from the picture itself.
 */
export function checkImageSrc(src: unknown): ImageCheck {
  if (typeof src !== 'string') return { ok: false, problem: 'must be a picture' }
  if (src.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 40) {
    return { ok: false, problem: `must be a picture of at most ${sizeText(MAX_IMAGE_BYTES)}` }
  }
  const m = DATA_URL.exec(src)
  if (!m) return { ok: false, problem: 'must be a PNG or JPEG picture' }
  let bytes: Uint8Array
  try {
    bytes = base64Bytes(m[2])
  } catch {
    return { ok: false, problem: 'must be a PNG or JPEG picture' }
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, problem: `must be a picture of at most ${sizeText(MAX_IMAGE_BYTES)}` }
  }
  const info = imageInfo(bytes)
  if (!info || info.type !== m[1]) return { ok: false, problem: 'must be a PNG or JPEG picture' }
  if (info.width > 10_000 || info.height > 10_000) return { ok: false, problem: 'is too large a picture' }
  return { ok: true, image: { src, width: info.width, height: info.height }, bytes }
}

/** The bytes and type of a stored picture (already checked). */
export function imageBytes(image: Pick<QuestionImage, 'src'>): { type: ImageType; bytes: Uint8Array } {
  const m = DATA_URL.exec(image.src)
  if (!m) throw new Error('A picture in this assessment is not a PNG or JPEG.')
  return { type: m[1] as ImageType, bytes: base64Bytes(m[2]) }
}

/**
 * The size to draw a picture in a PDF, in points: as large as fits in `maxWidth` by `maxHeight`,
 * keeping the aspect ratio, and never larger than the picture at 150 dots per inch (so a small
 * picture is not blown up until it looks blurry).
 */
export function fitImage(
  image: Pick<QuestionImage, 'width' | 'height'>,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const natural = 72 / 150
  const scale = Math.min(natural, maxWidth / image.width, maxHeight / image.height)
  return { width: image.width * scale, height: image.height * scale }
}
