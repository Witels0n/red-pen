import type { Logo } from './stamp'

// The logo is redrawn on a canvas as a PNG at most 600 px on its longer side, so any picture
// format the browser can show works, transparency is kept and the saved copy stays small.

const MAX_SIDE = 600
const STORAGE_KEY = 'red-pen.stamp.logo'

export class LogoError extends Error {
  override name = 'LogoError'
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new LogoError('That picture could not be read. Try a PNG or JPEG.'))
    img.src = url
  })
}

/** Turn a chosen picture file into a Logo. Throws LogoError with a teacher-facing message. */
export async function readLogo(file: File): Promise<Logo> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new LogoError('That picture is empty.')
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new LogoError('That picture could not be read. Try a PNG or JPEG.')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', aspect: canvas.width / canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A data: URL for showing the logo on the page. */
export function logoDataUrl(logo: Logo): string {
  let binary = ''
  for (const b of logo.bytes) binary += String.fromCharCode(b)
  return `data:image/${logo.type};base64,${btoa(binary)}`
}

/** Keep the logo on this device for next time. Storage may be full or blocked; that is fine. */
export function saveLogo(logo: Logo | null): void {
  try {
    if (!logo) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ src: logoDataUrl(logo), aspect: logo.aspect }))
  } catch {
    // Not remembered, but still used for this visit.
  }
}

export function loadSavedLogo(): Logo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { src, aspect } = JSON.parse(raw) as { src: unknown; aspect: unknown }
    if (typeof src !== 'string' || typeof aspect !== 'number' || !(aspect > 0)) return null
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(src)
    if (!m) return null
    const binary = atob(m[2])
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return { bytes, type: m[1] as 'png' | 'jpeg', aspect }
  } catch {
    return null
  }
}
