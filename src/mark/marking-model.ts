// Marking model: the current Annotations on a Test and the commands that change them.
// Pure TypeScript, no DOM or PDF libraries. Positions are PDF page units (1/72 in) at zoom 1,
// origin top-left, y down, so zoom and export need no conversion logic here.
//
// Extending: add a variant to `Annotation` and a command method that goes through `apply`.
// All state changes funnel through `apply`, which also records undo/redo history, so every new
// command is undoable automatically.

import { atOrBefore, compareReadingOrder } from './reading-order'

interface AnnotationBase {
  readonly id: string
  /** 1-based page number. */
  readonly page: number
  readonly x: number
  readonly y: number
}

export interface TickAnnotation extends AnnotationBase {
  readonly type: 'tick'
}

/** Worth no Marks. May carry a Reason (a short label saying why the answer was wrong). */
export interface CrossAnnotation extends AnnotationBase {
  readonly type: 'cross'
  readonly reason?: string
}

/** Shows the Ticks since the previous Subtotal; the count is derived, see `getSubtotalCount`. */
export interface SubtotalAnnotation extends AnnotationBase {
  readonly type: 'subtotal'
}

/** Shows every Tick in the Test out of `outOf`. At most one per Test. */
export interface TotalAnnotation extends AnnotationBase {
  readonly type: 'total'
  readonly outOf: number
}

/** Free text typed by the teacher. */
export interface TextAnnotation extends AnnotationBase {
  readonly type: 'text'
  readonly text: string
}

/** Discriminated by `type`. */
export type Annotation = TickAnnotation | CrossAnnotation | SubtotalAnnotation | TotalAnnotation | TextAnnotation

export interface TotalSummary {
  readonly id: string
  readonly count: number
  readonly outOf: number
  /** More Ticks than the out-of value. A warning only; never blocks marking. */
  readonly over: boolean
}

export type AnnotationType = Annotation['type']

export interface MarkingModel {
  /** A snapshot of the Annotations, in the order they were placed. */
  getAnnotations(): readonly Annotation[]
  /** Place a Tick (one Mark) on a page. */
  placeTick(page: number, x: number, y: number): TickAnnotation
  /** Place a Cross (no Marks) on a page. */
  placeCross(page: number, x: number, y: number): CrossAnnotation
  /** Place a Subtotal on a page. */
  placeSubtotal(page: number, x: number, y: number): SubtotalAnnotation
  /** Place the Total. Returns undefined (placing nothing) if the Test already has one. */
  placeTotal(page: number, x: number, y: number, outOf: number): TotalAnnotation | undefined
  /** Change the out-of value of the Total. Unknown ids are ignored. */
  setTotalOutOf(id: string, outOf: number): void
  /** Place a Text note. */
  placeText(page: number, x: number, y: number, text: string): TextAnnotation
  /** Change a Text note's text. Ignored for unknown ids and other types. */
  editText(id: string, text: string): void
  /** Ticks since the previous Subtotal in reading order; undefined if `id` is not a Subtotal. */
  getSubtotalCount(id: string): number | undefined
  /** The Total's count against its out-of value, or undefined if there is no Total. */
  getTotal(): TotalSummary | undefined
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** Set, change or (with undefined or blank text) clear a Cross's Reason. Other ids are ignored. */
  setReason(id: string, reason: string | undefined): void
  /** Move any Annotation (optionally to another page). Unknown ids are ignored. */
  moveAnnotation(id: string, x: number, y: number, page?: number): void
  /** Remove any Annotation. Unknown ids are ignored. */
  deleteAnnotation(id: string): void
  /** Total Marks awarded: one per Tick; Crosses count for nothing. */
  getMarks(): number
  /** Remove every Annotation (used when another Test is opened). */
  reset(): void
  /** Subscribe to changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** `initial` seeds the model without history (used to compute derived values for export). */
export function createMarkingModel(initial: readonly Annotation[] = []): MarkingModel {
  let annotations: readonly Annotation[] = initial
  let nextId = 1 + initial.length
  const listeners = new Set<() => void>()

  // Annotations are immutable plain data, so history is just a stack of earlier states.
  let past: Array<readonly Annotation[]> = []
  let future: Array<readonly Annotation[]> = []

  function notify(): void {
    listeners.forEach((l) => l())
  }

  /** Every command goes through here: record history, swap in the new state, then notify. */
  function apply(next: readonly Annotation[]): void {
    past.push(annotations)
    future = []
    annotations = next
    notify()
  }

  const ticks = () => annotations.filter((a) => a.type === 'tick')

  return {
    getAnnotations: () => annotations.slice(),
    placeTick(page, x, y) {
      const tick: TickAnnotation = { id: `a${nextId++}`, type: 'tick', page, x, y }
      apply([...annotations, tick])
      return tick
    },
    placeCross(page, x, y) {
      const cross: CrossAnnotation = { id: `a${nextId++}`, type: 'cross', page, x, y }
      apply([...annotations, cross])
      return cross
    },
    setReason(id, reason) {
      const target = annotations.find((a) => a.id === id)
      if (target?.type !== 'cross') return
      const text = reason?.trim()
      const { reason: _old, ...rest } = target
      apply(annotations.map((a) => (a === target ? (text ? { ...rest, reason: text } : rest) : a)))
    },
    moveAnnotation(id, x, y, page) {
      if (!annotations.some((a) => a.id === id)) return
      apply(annotations.map((a) => (a.id === id ? { ...a, x, y, page: page ?? a.page } : a)))
    },
    deleteAnnotation(id) {
      if (!annotations.some((a) => a.id === id)) return
      apply(annotations.filter((a) => a.id !== id))
    },
    placeSubtotal(page, x, y) {
      const subtotal: SubtotalAnnotation = { id: `a${nextId++}`, type: 'subtotal', page, x, y }
      apply([...annotations, subtotal])
      return subtotal
    },
    placeTotal(page, x, y, outOf) {
      if (annotations.some((a) => a.type === 'total')) return undefined
      const total: TotalAnnotation = { id: `a${nextId++}`, type: 'total', page, x, y, outOf }
      apply([...annotations, total])
      return total
    },
    setTotalOutOf(id, outOf) {
      if (!annotations.some((a) => a.id === id && a.type === 'total')) return
      apply(annotations.map((a) => (a.id === id && a.type === 'total' ? { ...a, outOf } : a)))
    },
    placeText(page, x, y, text) {
      const note: TextAnnotation = { id: `a${nextId++}`, type: 'text', page, x, y, text }
      apply([...annotations, note])
      return note
    },
    editText(id, text) {
      if (!annotations.some((a) => a.id === id && a.type === 'text')) return
      apply(annotations.map((a) => (a.id === id && a.type === 'text' ? { ...a, text } : a)))
    },
    getSubtotalCount(id) {
      const subtotal = annotations.find((a) => a.id === id)
      if (!subtotal || subtotal.type !== 'subtotal') return undefined
      // Subtotals at the same spot are ordered by placement, so each still counts a distinct set.
      const order = (a: Annotation, b: Annotation) =>
        compareReadingOrder(a, b) || annotations.indexOf(a) - annotations.indexOf(b)
      const before = annotations
        .filter((a) => a.type === 'subtotal' && order(a, subtotal) < 0)
        .sort(order)
        .pop()
      const upTo = (marker: Annotation) => ticks().filter((t) => atOrBefore(t, marker)).length
      return upTo(subtotal) - (before ? upTo(before) : 0)
    },
    getTotal() {
      const total = annotations.find((a): a is TotalAnnotation => a.type === 'total')
      if (!total) return undefined
      const count = ticks().length
      return { id: total.id, count, outOf: total.outOf, over: count > total.outOf }
    },
    undo() {
      const previous = past.pop()
      if (!previous) return
      future.push(annotations)
      annotations = previous
      notify()
    },
    redo() {
      const next = future.pop()
      if (!next) return
      past.push(annotations)
      annotations = next
      notify()
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    getMarks: () => ticks().length,
    reset() {
      past = []
      future = []
      annotations = []
      notify()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
