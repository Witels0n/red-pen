// Pure geometry for Redact and anonymise. No DOM, no pdf.js, no pdf-lib.
//
// A box is kept as fractions (0 to 1) of the page as it is displayed (after its /Rotate, origin
// top-left, y down), so one layout fits every scan in a class set, whatever its size or
// resolution. It becomes displayed page units, then PDF user space, only when a page is redacted.

import { displayedSize, toPageSpace, type PageBox } from '../shared/pdf/page-geometry'

/** A rectangle in fractions of the displayed page. */
export interface FracRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** Smallest box, as a fraction of the page's width or height, so a box can always be grabbed. */
export const MIN_SIZE = 0.01

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** A point on screen as fractions of an element's bounding box (the page overlay), kept on the page. */
export function clientToFraction(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
): Point {
  return {
    x: clamp01((clientX - bounds.left) / Math.max(bounds.width, 1)),
    y: clamp01((clientY - bounds.top) / Math.max(bounds.height, 1)),
  }
}

/** The box dragged out from `a` to `b`, in any direction, kept on the page. */
export function rectFromDrag(a: Point, b: Point): FracRect {
  const x1 = clamp01(Math.min(a.x, b.x))
  const y1 = clamp01(Math.min(a.y, b.y))
  const x2 = clamp01(Math.max(a.x, b.x))
  const y2 = clamp01(Math.max(a.y, b.y))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** `r` moved by (dx, dy), stopping at the edges of the page. */
export function moveRect(r: FracRect, dx: number, dy: number): FracRect {
  return {
    x: Math.min(1 - r.w, Math.max(0, r.x + dx)),
    y: Math.min(1 - r.h, Math.max(0, r.y + dy)),
    w: r.w,
    h: r.h,
  }
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se'

/** `r` resized by dragging one corner by (dx, dy). The opposite corner stays put. */
export function resizeRect(r: FracRect, handle: Handle, dx: number, dy: number): FracRect {
  let left = r.x
  let top = r.y
  let right = r.x + r.w
  let bottom = r.y + r.h
  if (handle === 'nw' || handle === 'sw') left = Math.min(right - MIN_SIZE, Math.max(0, left + dx))
  else right = Math.max(left + MIN_SIZE, Math.min(1, right + dx))
  if (handle === 'nw' || handle === 'ne') top = Math.min(bottom - MIN_SIZE, Math.max(0, top + dy))
  else bottom = Math.max(top + MIN_SIZE, Math.min(1, bottom + dy))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** A rectangle in displayed page units (points, origin top-left, y down). */
export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/** A box on a page whose visible box is `box` and whose stored rotation is `rotation`. */
export function fractionToDisplay(r: FracRect, box: PageBox, rotation: number): DisplayRect {
  const size = displayedSize(box, rotation)
  return { x: r.x * size.width, y: r.y * size.height, width: r.w * size.width, height: r.h * size.height }
}

/**
 * A rectangle on the displayed page as a rectangle in PDF user space (origin bottom-left, y up),
 * on a page with visible box `box` and rotation `rotation`. Quarter turns keep it axis-aligned.
 */
export function displayRectToPdf(box: PageBox, rotation: number, r: DisplayRect): PageBox {
  const a = toPageSpace(box, rotation, r.x, r.y)
  const b = toPageSpace(box, rotation, r.x + r.width, r.y + r.height)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/**
 * A PDF user-space rectangle as pixels on a canvas of the page rendered without its rotation
 * (`scale` pixels per point, origin top-left of the visible box), rounded outwards so the box
 * covers every pixel it touches.
 */
export function pdfRectToPixels(
  box: PageBox,
  r: PageBox,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const left = Math.floor((r.x - box.x) * scale)
  const top = Math.floor((box.y + box.height - (r.y + r.height)) * scale)
  const right = Math.ceil((r.x + r.width - box.x) * scale)
  const bottom = Math.ceil((box.y + box.height - r.y) * scale)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** A box in fractions of the displayed page, as pixels on the unrotated render of that page. */
export function boxToPixels(r: FracRect, box: PageBox, rotation: number, scale: number) {
  return pdfRectToPixels(box, displayRectToPdf(box, rotation, fractionToDisplay(r, box, rotation)), scale)
}

/** Pixels per point for a render at `dpi`, lowered if needed so neither side passes `maxPixels`. */
export function renderScale(box: PageBox, dpi: number, maxPixels = 5000): number {
  const scale = dpi / 72
  const longest = Math.max(box.width, box.height) * scale
  return longest > maxPixels ? scale * (maxPixels / longest) : scale
}
