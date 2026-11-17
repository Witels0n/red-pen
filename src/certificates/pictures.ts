// Logos and signature pictures chosen by the teacher, turned into PNG bytes for the PDF.
// Any image the browser can open works (PNG, JPEG, WebP, GIF, SVG); big ones are scaled down.
import { inkBounds, whiteToTransparent } from '../sign/image-utils'
import type { Picture } from './render'

const MAX_SIDE = 1200

export class PictureError extends Error {
  override name = 'PictureError'
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new PictureError('This picture could not be opened. Try a PNG or JPEG file.'))
    img.src = src
  })
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export interface LoadedPicture {
  picture: Picture
  /** A PNG data URL, for the thumbnail and for remembering the logo. */
  dataUrl: string
}

/**
 * Reads an image into a PNG, at most 1200 pixels on its longest side. With `clearWhite`, white
 * paper becomes see-through and the picture is cropped to the ink, as for a photographed signature.
 */
export async function loadPicture(source: Blob | string, clearWhite = false): Promise<LoadedPicture> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = await loadImage(url)
    const w0 = img.naturalWidth || 300
    const h0 = img.naturalHeight || 150
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w0 * scale))
    canvas.height = Math.max(1, Math.round(h0 * scale))
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let out = canvas
    if (clearWhite) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      whiteToTransparent(data.data)
      const box = inkBounds(data.data, canvas.width, canvas.height)
      if (!box) throw new PictureError('No signature could be found in this picture.')
      ctx.putImageData(data, 0, 0)
      out = document.createElement('canvas')
      out.width = box.width
      out.height = box.height
      out.getContext('2d')!.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
    }
    const dataUrl = out.toDataURL('image/png')
    return { picture: { bytes: dataUrlBytes(dataUrl), type: 'png' }, dataUrl }
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}
