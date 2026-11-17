// Pure geometry for Sign and fill: mapping between displayed page units and PDF user space,
// and fitting new annotations to detected boxes. No DOM, no pdf.js, no pdf-lib.
//
// "Displayed page units" are points with the origin at the top-left of the page as it is shown
// (after its /Rotate), y down. This is what pdf.js gives at viewport scale 1.

import type { DetectedBox } from './detect'

export interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

export function normaliseRotation(rotation: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
}

/**
 * Displayed page units to PDF user space. `box` is the unrotated visible box (CropBox, else
 * MediaBox), which may have a non-zero origin.
 */
export function toPageSpace(box: PageBox, rotation: number, x: number, y: number): { x: number; y: number } {
  switch (normaliseRotation(rotation)) {
    case 90:
      return { x: box.x + y, y: box.y + x }
    case 180:
      return { x: box.x + box.width - x, y: box.y + y }
    case 270:
      return { x: box.x + box.width - y, y: box.y + box.height - x }
    default:
      return { x: box.x + x, y: box.y + box.height - y }
  }
}

/** The inverse of `toPageSpace`. */
export function fromPageSpace(box: PageBox, rotation: number, px: number, py: number): { x: number; y: number } {
  switch (normaliseRotation(rotation)) {
    case 90:
      return { x: py - box.y, y: px - box.x }
    case 180:
      return { x: box.x + box.width - px, y: py - box.y }
    case 270:
      return { x: box.y + box.height - py, y: box.x + box.width - px }
    default:
      return { x: px - box.x, y: box.y + box.height - py }
  }
}

/** Size of the page as displayed (width and height swap for quarter turns). */
export function displayedSize(box: PageBox, rotation: number): { width: number; height: number } {
  const r = normaliseRotation(rotation)
  return r === 90 || r === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
}

/**
 * Where to draw something that is upright on the displayed page: the PDF user-space point for
 * its displayed bottom-left corner (x, y + height) and the angle, in degrees, to rotate it by.
 */
export function placeUpright(
  box: PageBox,
  rotation: number,
  x: number,
  bottomY: number,
): { x: number; y: number; angle: number } {
  const origin = toPageSpace(box, rotation, x, bottomY)
  const along = toPageSpace(box, rotation, x + 1, bottomY)
  const angle = Math.round((Math.atan2(along.y - origin.y, along.x - origin.x) * 180) / Math.PI)
  return { ...origin, angle: ((angle % 360) + 360) % 360 }
}

/** Default text size, in points, when not fitted to a box. */
export const DEFAULT_TEXT_SIZE = 12
/** Height above a detected line given to the text written on it. */
export const LINE_FIELD_HEIGHT = 16

/** A text field fitted to a detected line or box: where its baseline starts and its size. */
export function fitText(box: DetectedBox): { x: number; y: number; size: number; width: number } {
  if (box.kind === 'line') {
    return { x: box.x + 2, y: box.y - 2.5, size: DEFAULT_TEXT_SIZE, width: box.width - 4 }
  }
  const size = clamp(Math.round(box.height * 0.6 * 2) / 2, 6, 16)
  const pad = Math.min(4, box.width * 0.05)
  // Centre the text's cap height in the box.
  const baseline = box.y + box.height / 2 + size * 0.35
  return { x: box.x + pad, y: baseline, size, width: box.width - pad * 2 }
}

/** The area a detected box offers for clicking and for showing its outline. */
export function hitArea(box: DetectedBox): PageBox {
  if (box.kind === 'line')
    return { x: box.x, y: box.y - LINE_FIELD_HEIGHT, width: box.width, height: LINE_FIELD_HEIGHT + box.height }
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** The detected box at a point, the smallest if several overlap. */
export function boxAt(boxes: readonly DetectedBox[], x: number, y: number): DetectedBox | undefined {
  let best: DetectedBox | undefined
  for (const b of boxes) {
    const a = hitArea(b)
    if (x < a.x || x > a.x + a.width || y < a.y || y > a.y + a.height) continue
    if (!best || a.width * a.height < hitArea(best).width * hitArea(best).height) best = b
  }
  return best
}

/** A square mark (tick or cross) filling a tick box with a little margin. */
export function fitMark(box: DetectedBox): { x: number; y: number; size: number } {
  const size = Math.min(box.width, box.height) * 0.9
  return { x: box.x + (box.width - size) / 2, y: box.y + (box.height - size) / 2, size }
}

/**
 * An image (signature or initials) of the given aspect ratio (width / height) fitted to a detected
 * line (sitting on it) or box (inside it), or centred on a point with a default width.
 */
export function fitImage(aspect: number, defaultWidth: number, at: { x: number; y: number } | DetectedBox): PageBox {
  if ('kind' in at) {
    if (at.kind === 'line') {
      const height = Math.min(36, (at.width * 0.8) / aspect)
      const width = height * aspect
      return { x: at.x + 4, y: at.y - height + 2, width, height }
    }
    const scale = Math.min((at.width * 0.9) / aspect, at.height * 0.85)
    const width = scale * aspect
    const height = scale
    return { x: at.x + (at.width - width) / 2, y: at.y + (at.height - height) / 2, width, height }
  }
  const width = defaultWidth
  const height = width / aspect
  return { x: at.x - width / 2, y: at.y - height / 2, width, height }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
