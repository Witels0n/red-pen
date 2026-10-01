// Marking model: the current Annotations on a Test and the commands that change them.
// Pure TypeScript, no DOM or PDF libraries. Positions are PDF page units (1/72 in) at zoom 1,
// origin top-left, y down, so zoom and export need no conversion logic here.
//
// Extending: add a variant to `Annotation` (e.g. `CrossAnnotation` with type 'cross') and a
// command method that goes through `apply`. All state changes funnel through `apply`, which is
// the single place an undo/redo history can later wrap (record the before/after of each command).

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

/** Discriminated by `type`. Later tickets add 'cross' | 'subtotal' | 'total' | 'text'. */
export type Annotation = TickAnnotation

export type AnnotationType = Annotation['type']

export interface MarkingModel {
  /** A snapshot of the Annotations, in the order they were placed. */
  getAnnotations(): readonly Annotation[]
  /** Place a Tick (one Mark) on a page. */
  placeTick(page: number, x: number, y: number): TickAnnotation
  /** Move any Annotation (optionally to another page). Unknown ids are ignored. */
  moveAnnotation(id: string, x: number, y: number, page?: number): void
  /** Remove any Annotation. Unknown ids are ignored. */
  deleteAnnotation(id: string): void
  /** Total Marks awarded: one per Tick. */
  getMarks(): number
  /** Remove every Annotation (used when another Test is opened). */
  reset(): void
  /** Subscribe to changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

export function createMarkingModel(): MarkingModel {
  let annotations: readonly Annotation[] = []
  let nextId = 1
  const listeners = new Set<() => void>()

  /** Every change goes through here: swap in the new state, then notify. */
  function apply(next: readonly Annotation[]): void {
    annotations = next
    listeners.forEach((l) => l())
  }

  return {
    getAnnotations: () => annotations.slice(),
    placeTick(page, x, y) {
      const tick: TickAnnotation = { id: `a${nextId++}`, type: 'tick', page, x, y }
      apply([...annotations, tick])
      return tick
    },
    moveAnnotation(id, x, y, page) {
      if (!annotations.some((a) => a.id === id)) return
      apply(annotations.map((a) => (a.id === id ? { ...a, x, y, page: page ?? a.page } : a)))
    },
    deleteAnnotation(id) {
      if (!annotations.some((a) => a.id === id)) return
      apply(annotations.filter((a) => a.id !== id))
    },
    getMarks: () => annotations.filter((a) => a.type === 'tick').length,
    reset: () => apply([]),
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
