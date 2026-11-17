// Decodes the sheet QR with jsQR: first from a straightened crop where the layout says it is
// (fast and reliable), then from the whole image as a fallback.
import jsQR from 'jsqr'
import type { Homography, Point } from './homography'
import { downscale, type GrayImage } from './image'
import { MM } from './layout'
import { grayToRgba, rectifyGray } from './rectify'
import type { Rect } from './types'

const QUIET = 5 * MM

/** Stretches contrast so the darkest 2% is black and the brightest 2% white. */
function stretch(g: GrayImage): GrayImage {
  const hist = new Uint32Array(256)
  for (const v of g.data) hist[v]++
  const cut = g.data.length * 0.02
  let lo = 0
  let acc = 0
  while (lo < 255 && (acc += hist[lo]) < cut) lo++
  let hi = 255
  acc = 0
  while (hi > 0 && (acc += hist[hi]) < cut) hi--
  if (hi - lo < 16) return g
  const out = new Uint8Array(g.data.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, ((g.data[i] - lo) * 255) / (hi - lo)))
  return { width: g.width, height: g.height, data: out }
}

function decode(g: GrayImage): { text: string; centre: Point } | null {
  const rgba = grayToRgba(g)
  const r = jsQR(rgba.data as Uint8ClampedArray, g.width, g.height, { inversionAttempts: 'dontInvert' })
  if (!r || !r.data) return null
  const l = r.location
  const centre = {
    x: (l.topLeftCorner.x + l.topRightCorner.x + l.bottomLeftCorner.x + l.bottomRightCorner.x) / 4,
    y: (l.topLeftCorner.y + l.topRightCorner.y + l.bottomLeftCorner.y + l.bottomRightCorner.y) / 4,
  }
  return { text: r.data, centre }
}

/** Tries the straightened QR area at two resolutions, plain and contrast-stretched. */
export function decodeQrCrop(g: GrayImage, h: Homography, qr: Rect): string | null {
  const rect = { x: qr.x - QUIET, y: qr.y - QUIET, w: qr.w + 2 * QUIET, h: qr.h + 2 * QUIET }
  for (const pxPerPt of [3, 2]) {
    const crop = rectifyGray(g, h, rect, pxPerPt)
    const hit = decode(crop) ?? decode(stretch(crop))
    if (hit) return hit.text
  }
  return null
}

/** Searches the whole image (downscaled for speed). Returns the QR centre in image pixels too. */
export function decodeQrAnywhere(g: GrayImage): { text: string; centre: Point } | null {
  const long = Math.max(g.width, g.height)
  for (const target of [1400, 900]) {
    const f = Math.max(1, Math.round(long / target))
    const small = downscale(g, f)
    const hit = decode(small) ?? decode(stretch(small))
    if (hit) return { text: hit.text, centre: { x: hit.centre.x * f, y: hit.centre.y * f } }
  }
  return null
}
