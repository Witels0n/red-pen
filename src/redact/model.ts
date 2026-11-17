import type { FracRect } from './geometry'

// The box layout: what to hide, on which pages. One layout is used for every file in a batch.

export type Fill = 'black' | 'white'

/** One redaction box. Its rectangle is in fractions of the displayed page (see geometry.ts). */
export interface RedactionBox extends FracRect {
  id: number
  /** The 1-based page it was drawn on. */
  page: number
  /** Repeated on every page of every file. */
  everyPage: boolean
  fill: Fill
  /** Write the file's anonymised name ("Learner 07") in the box. */
  label: boolean
}

export type BoxPatch = Partial<Omit<RedactionBox, 'id'>>

/** The boxes that cover 1-based page `page`. */
export function boxesOnPage(boxes: readonly RedactionBox[], page: number): RedactionBox[] {
  return boxes.filter((b) => b.everyPage || b.page === page)
}

/** The 1-based pages, of a file with `pageCount` pages, that have at least one box. */
export function redactedPages(boxes: readonly RedactionBox[], pageCount: number): number[] {
  if (boxes.some((b) => b.everyPage)) return Array.from({ length: pageCount }, (_, i) => i + 1)
  return [...new Set(boxes.map((b) => b.page))].filter((p) => p <= pageCount).sort((a, b) => a - b)
}

export interface LayoutModel {
  boxes(): readonly RedactionBox[]
  get(id: number): RedactionBox | undefined
  add(box: Omit<RedactionBox, 'id'>): RedactionBox
  /** Change a box. `record: false` changes it without an undo step (while dragging). */
  update(id: number, patch: BoxPatch, record?: boolean): void
  remove(id: number): void
  /** Replace every box (a saved layout, or none). One undo step. */
  replace(boxes: readonly Omit<RedactionBox, 'id'>[]): void
  /** Mark the start of a drag, so the whole drag undoes in one step. */
  checkpoint(): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  onChange(listener: () => void): void
}

const LIMIT = 100

export function createLayoutModel(): LayoutModel {
  let boxes: RedactionBox[] = []
  let nextId = 1
  const past: RedactionBox[][] = []
  const future: RedactionBox[][] = []
  const listeners: Array<() => void> = []
  const changed = () => listeners.forEach((l) => l())
  const snapshot = () => boxes.map((b) => ({ ...b }))
  const record = () => {
    past.push(snapshot())
    if (past.length > LIMIT) past.shift()
    future.length = 0
  }

  return {
    boxes: () => boxes,
    get: (id) => boxes.find((b) => b.id === id),
    add(box) {
      record()
      const added = { ...box, id: nextId++ }
      boxes = [...boxes, added]
      changed()
      return added
    },
    update(id, patch, rec = true) {
      if (!boxes.some((b) => b.id === id)) return
      if (rec) record()
      boxes = boxes.map((b) => (b.id === id ? { ...b, ...patch, id } : b))
      changed()
    },
    remove(id) {
      if (!boxes.some((b) => b.id === id)) return
      record()
      boxes = boxes.filter((b) => b.id !== id)
      changed()
    },
    replace(next) {
      record()
      boxes = next.map((b) => ({ ...b, id: nextId++ }))
      changed()
    },
    checkpoint: record,
    undo() {
      const prev = past.pop()
      if (!prev) return
      future.push(snapshot())
      boxes = prev
      changed()
    },
    redo() {
      const next = future.pop()
      if (!next) return
      past.push(snapshot())
      boxes = next
      changed()
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    onChange(listener) {
      listeners.push(listener)
    },
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A saved layout read back from storage; anything malformed is dropped. */
export function parseLayout(raw: unknown): Omit<RedactionBox, 'id'>[] {
  if (!Array.isArray(raw)) return []
  const out: Omit<RedactionBox, 'id'>[] = []
  for (const b of raw as Record<string, unknown>[]) {
    if (typeof b !== 'object' || b === null) continue
    const { x, y, w, h, page } = b
    if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h) || !isNum(page)) continue
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001 || page < 1) continue
    out.push({
      x,
      y,
      w,
      h,
      page: Math.floor(page),
      everyPage: b.everyPage === true,
      fill: b.fill === 'white' ? 'white' : 'black',
      label: b.label === true,
    })
  }
  return out
}
