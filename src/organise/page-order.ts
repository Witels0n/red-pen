import { moveItem } from '../shared/pdf/list-order'

/**
 * One page of the organised PDF: which page of the original it is, and how far the teacher
 * turned it. `turn` is added to the page's existing rotation when saving, so a page that was
 * already rotated keeps that rotation plus the teacher's turn.
 */
export interface PageSlot {
  /** 0-based index of the page in the original PDF. */
  source: number
  /** Clockwise degrees added by the teacher: 0, 90, 180 or 270. */
  turn: number
}

export type Direction = 'left' | 'right'

/** Normalise any multiple of 90 to 0, 90, 180 or 270. */
export function normaliseRotation(degrees: number): number {
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360
}

/** Every page of a `pageCount`-page PDF, in order and unturned. */
export function initialPages(pageCount: number): PageSlot[] {
  return Array.from({ length: pageCount }, (_, source) => ({ source, turn: 0 }))
}

function turned(slot: PageSlot, direction: Direction): PageSlot {
  return { ...slot, turn: normaliseRotation(slot.turn + (direction === 'right' ? 90 : -90)) }
}

/** Turn one page a quarter left (anticlockwise) or right (clockwise). */
export function rotatePage(pages: readonly PageSlot[], index: number, direction: Direction): PageSlot[] {
  return pages.map((slot, i) => (i === index ? turned(slot, direction) : slot))
}

/** Turn every page a quarter left or right. */
export function rotateAll(pages: readonly PageSlot[], direction: Direction): PageSlot[] {
  return pages.map((slot) => turned(slot, direction))
}

/** Leave one page out of the organised PDF. */
export function removePage(pages: readonly PageSlot[], index: number): PageSlot[] {
  return pages.filter((_, i) => i !== index)
}

/** Move one page to a new position. */
export function movePage(pages: readonly PageSlot[], from: number, to: number): PageSlot[] {
  return moveItem(pages, from, to)
}

/** The /Rotate to store for a page: its existing rotation plus the teacher's turn. */
export function savedRotation(existing: number, turn: number): number {
  return normaliseRotation(existing + turn)
}
