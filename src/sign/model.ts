// What the teacher has added to the document, with undo and redo. Pure: no DOM.
// Positions are in displayed page units (see geometry.ts).

export type Ink = 'black' | 'blue'

export const INK_RGB: Record<Ink, { r: number; g: number; b: number }> = {
  black: { r: 0.07, g: 0.07, b: 0.09 },
  blue: { r: 0.1, g: 0.23, b: 0.67 },
}

export const INK_CSS: Record<Ink, string> = {
  black: '#121217',
  blue: '#1a3bab',
}

interface Base {
  id: string
  /** 1-based page number. */
  page: number
}

/** Text the teacher types. `x`, `y` is the start of the baseline. */
export interface TextItem extends Base {
  type: 'text'
  x: number
  y: number
  /** Font size in points. */
  size: number
  text: string
  ink: Ink
  /** Width of the field it was fitted to, so the editor is at least that wide. */
  width?: number
}

interface MarkFields extends Base {
  x: number
  y: number
  size: number
  ink: Ink
}

/** A tick or cross. `x`, `y` is the top-left of its square. */
export type MarkItem = (MarkFields & { type: 'tick' }) | (MarkFields & { type: 'cross' })

interface ImageFields extends Base {
  x: number
  y: number
  width: number
  height: number
  /** PNG data URL with a transparent background. */
  src: string
}

/** A signature or initials image. `x`, `y` is its top-left. */
export type ImageItem = (ImageFields & { type: 'signature' }) | (ImageFields & { type: 'initials' })

export type Item = TextItem | MarkItem | ImageItem

/** An Item before the model gives it an id. */
export type NewItem = Item extends infer I ? (I extends Item ? Omit<I, 'id'> : never) : never

/** Fields that `update` may change. */
export type ItemPatch =
  Partial<Omit<TextItem, 'id' | 'type'>> | Partial<Omit<MarkFields, 'id'>> | Partial<Omit<ImageFields, 'id'>>

export interface SignModel {
  items(): readonly Item[]
  get(id: string): Item | undefined
  add(item: NewItem): string
  update(id: string, patch: ItemPatch): void
  remove(id: string): void
  /** Replace everything and clear history (a new document). */
  reset(): void
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  onChange(listener: () => void): () => void
}

const LIMIT = 200

export function createSignModel(): SignModel {
  let current: readonly Item[] = []
  let past: (readonly Item[])[] = []
  let future: (readonly Item[])[] = []
  let nextId = 1
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  const commit = (next: readonly Item[]) => {
    past.push(current)
    if (past.length > LIMIT) past.shift()
    future = []
    current = next
    emit()
  }

  return {
    items: () => current,
    get: (id) => current.find((i) => i.id === id),
    add(item) {
      const id = `i${nextId++}`
      commit([...current, { ...item, id } as Item])
      return id
    },
    update(id, patch) {
      const at = current.findIndex((i) => i.id === id)
      if (at < 0) return
      const before = current[at]
      const after = { ...before, ...patch } as Item
      if (
        Object.keys(patch).every(
          (k) => (before as unknown as Record<string, unknown>)[k] === (after as unknown as Record<string, unknown>)[k],
        )
      )
        return
      commit(current.map((i, n) => (n === at ? after : i)))
    },
    remove(id) {
      if (!current.some((i) => i.id === id)) return
      commit(current.filter((i) => i.id !== id))
    },
    reset() {
      current = []
      past = []
      future = []
      emit()
    },
    undo() {
      const prev = past.pop()
      if (!prev) return false
      future.push(current)
      current = prev
      emit()
      return true
    },
    redo() {
      const next = future.pop()
      if (!next) return false
      past.push(current)
      current = next
      emit()
      return true
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
