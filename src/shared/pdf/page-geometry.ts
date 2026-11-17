// Pure page geometry shared by the Tools that place things on PDF pages: mapping between
// displayed page units and PDF user space. No DOM, no pdf.js, no pdf-lib.
//
// "Displayed page units" are points with the origin at the top-left of the page as it is shown
// (after its /Rotate), y down. This is what pdf.js gives at viewport scale 1.

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
