// The Ink colour: the single colour in which every Annotation of a Test is drawn on screen and
// in the export. Not marking data, so it lives outside the Marking model and its undo history.
// Only the colour's name is kept in browser storage, so the next Test opens in the last-used one.

export const INK_PRESETS = {
  red: { r: 0.85, g: 0.1, b: 0.1 },
  blue: { r: 0.1, g: 0.25, b: 0.85 },
  green: { r: 0.05, g: 0.5, b: 0.15 },
  black: { r: 0, g: 0, b: 0 },
  purple: { r: 0.5, g: 0.15, b: 0.7 },
} as const

export type InkName = keyof typeof INK_PRESETS
export type InkRgb = { readonly r: number; readonly g: number; readonly b: number }

export const DEFAULT_INK: InkName = 'red'
export const INK_STORAGE_KEY = 'pdf-marker.inkColour'

export type InkStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface Ink {
  get(): InkName
  /** Change the colour. Unknown names are ignored. */
  set(name: InkName): void
  rgb(): InkRgb
  css(): string
  /** Called with the new colour whenever it changes. Returns an unsubscribe function. */
  subscribe(fn: (name: InkName) => void): () => void
}

export function isInkName(value: unknown): value is InkName {
  return typeof value === 'string' && Object.hasOwn(INK_PRESETS, value)
}

export function inkCss({ r, g, b }: InkRgb): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

export function createInk(storage: InkStorage): Ink {
  const listeners = new Set<(name: InkName) => void>()
  let current: InkName = DEFAULT_INK
  try {
    const stored = storage.getItem(INK_STORAGE_KEY)
    if (isInkName(stored)) current = stored
  } catch {
    // Storage unavailable: start from the default.
  }
  return {
    get: () => current,
    set(name) {
      if (!isInkName(name) || name === current) return
      current = name
      try {
        storage.setItem(INK_STORAGE_KEY, name)
      } catch {
        // Storage unavailable: the colour just is not remembered.
      }
      for (const fn of listeners) fn(name)
    },
    rgb: () => INK_PRESETS[current],
    css: () => inkCss(INK_PRESETS[current]),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** The app's Ink colour, backed by localStorage (whose access throws when storage is blocked). */
export function createBrowserInk(): Ink {
  return createInk({
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
  })
}
