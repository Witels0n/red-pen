// Saved worksheets live in this browser's localStorage under red-pen.worksheets. keys (ADR 0002), and
// nowhere else. Pictures for labelling are stored downscaled, so a few worksheets fit comfortably.
import { sanitiseWorksheet, type Worksheet } from './core/model'

export const LIST_KEY = 'red-pen.worksheets.saved'
export const OPEN_KEY = 'red-pen.worksheets.open'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function store(s?: Store): Store | undefined {
  try {
    return s ?? globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Every saved worksheet, most recently changed first. Broken entries are skipped. */
export function loadWorksheets(s?: Store): Worksheet[] {
  try {
    const raw = store(s)?.getItem(LIST_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((w) => {
        const ok = sanitiseWorksheet(w)
        return ok ? [ok] : []
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export type SaveResult = 'saved' | 'full' | 'blocked'

/** Saves the whole list. 'full' means the browser's storage is full (usually pictures). */
export function saveWorksheets(list: readonly Worksheet[], s?: Store): SaveResult {
  const target = store(s)
  if (!target) return 'blocked'
  try {
    target.setItem(LIST_KEY, JSON.stringify(list))
    return 'saved'
  } catch (e) {
    return e instanceof DOMException && /quota/i.test(e.name) ? 'full' : 'blocked'
  }
}

export function loadOpenId(s?: Store): string | null {
  try {
    return store(s)?.getItem(OPEN_KEY) ?? null
  } catch {
    return null
  }
}

export function saveOpenId(id: string, s?: Store): void {
  try {
    store(s)?.setItem(OPEN_KEY, id)
  } catch {
    // Not remembered: the most recent worksheet opens next time instead.
  }
}

/** Replaces (or adds) one worksheet in a list, keeping the rest. */
export function upsert(list: readonly Worksheet[], w: Worksheet): Worksheet[] {
  const i = list.findIndex((x) => x.id === w.id)
  if (i < 0) return [w, ...list]
  const out = [...list]
  out[i] = w
  return out
}
