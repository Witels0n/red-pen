// The teacher's list of Reasons for Crosses. This list is the ONLY thing this module (and, with
// the last-used Total out-of value, the app) keeps in browser storage: never a PDF or any
// annotation (ADR 0001). Storage is injected so the logic is testable without a browser.

export const REASONS_STORAGE_KEY = 'pdf-marker.reasons'

export const DEFAULT_REASONS: readonly string[] = [
  'Factual error',
  'RTQ',
  'Repeated fact',
  'Incomplete',
  'Not relevant',
  'Unclear',
  'Wrong term',
]

export type ReasonsStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface ReasonsList {
  get(): readonly string[]
  /** Replace the list. Entries are trimmed; blanks and duplicates are dropped. */
  set(reasons: readonly string[]): void
  restoreDefaults(): void
}

function tidy(reasons: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of reasons) {
    const t = r.trim()
    const key = t.toLowerCase()
    if (!t || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function read(storage: ReasonsStorage | undefined): string[] | null {
  try {
    const raw = storage?.getItem(REASONS_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'string')) return null
    return tidy(parsed)
  } catch {
    return null
  }
}

export function createReasonsList(storage: ReasonsStorage | undefined): ReasonsList {
  let current: string[] = read(storage) ?? [...DEFAULT_REASONS]

  function set(reasons: readonly string[]): void {
    current = tidy(reasons)
    try {
      storage?.setItem(REASONS_STORAGE_KEY, JSON.stringify(current))
    } catch {
      // Storage blocked or full: the list still works for this session.
    }
  }

  return {
    get: () => current.slice(),
    set,
    restoreDefaults: () => set(DEFAULT_REASONS),
  }
}

/** The list backed by the browser's localStorage (which may be unavailable). */
export function createBrowserReasonsList(): ReasonsList {
  let storage: ReasonsStorage | undefined
  try {
    storage = window.localStorage
  } catch {
    storage = undefined
  }
  return createReasonsList(storage)
}
