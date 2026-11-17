// Reading order for counting: page, then top to bottom, then left to right.
// Pure, no DOM. Positions are PDF page units, top-left origin, y down.

/**
 * Height of one "line" of the Test, in PDF units (about one text line). Annotations whose y
 * differ by no more than half of it are on the same visual line, so a Tick a few pixels lower
 * than a margin Subtotal still counts towards it.
 */
export const LINE_BAND = 20

const SAME_LINE = LINE_BAND / 2

export interface Positioned {
  readonly page: number
  readonly x: number
  readonly y: number
}

/** Orders annotations for reading: page, then line (top to bottom), then left to right. */
export function compareReadingOrder(a: Positioned, b: Positioned): number {
  if (a.page !== b.page) return a.page - b.page
  if (Math.abs(a.y - b.y) <= SAME_LINE) return a.x - b.x
  return a.y - b.y
}

/**
 * True when `item` is read before, or on the same line as, `marker`. Same-line items count
 * whichever side of the marker they sit on, so margin Subtotals behave as they look.
 */
export function atOrBefore(item: Positioned, marker: Positioned): boolean {
  if (item.page !== marker.page) return item.page < marker.page
  return item.y <= marker.y + SAME_LINE
}
