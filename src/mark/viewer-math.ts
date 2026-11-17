// Pure zoom / layout / visibility math for the viewer. No DOM, no pdf.js.
// "Scale" everywhere means CSS pixels per PDF page unit (1/72 inch).

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5
export const ZOOM_STEP = 1.25

export interface PageSize {
  width: number
  height: number
}

export interface PageBox {
  top: number
  height: number
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** Scale at which a page `pageWidth` units wide fills the container, less a gutter on each side. */
export function fitToWidthScale(containerWidth: number, pageWidth: number, gutter: number): number {
  const available = Math.max(containerWidth - 2 * gutter, 1)
  return available / pageWidth
}

export function stepZoom(scale: number, direction: 'in' | 'out'): number {
  return clampZoom(direction === 'in' ? scale * ZOOM_STEP : scale / ZOOM_STEP)
}

/** Vertical position and height of each page (CSS px) when stacked with `gap` between them. */
export function layoutPages(pages: PageSize[], scale: number, gap: number): PageBox[] {
  let top = 0
  return pages.map((p) => {
    const box = { top, height: p.height * scale }
    top += box.height + gap
    return box
  })
}

/** Indexes of pages that intersect the viewport extended by `margin` px above and below. */
export function visiblePages(layout: PageBox[], scrollTop: number, viewportHeight: number, margin: number): number[] {
  const from = scrollTop - margin
  const to = scrollTop + viewportHeight + margin
  const out: number[] = []
  layout.forEach((box, i) => {
    if (box.top + box.height > from && box.top < to) out.push(i)
  })
  return out
}
