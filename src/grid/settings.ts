// The teacher's own level targets (and custom level names) per taxonomy, remembered in this
// browser so every new grid starts from them. Stored under the red-pen.grid. key prefix.
import { defaultTaxonomy, TAXONOMY_IDS, type Level, type Taxonomy, type TaxonomyId } from './core/taxonomy'

const KEY = 'red-pen.grid.taxonomies'
const LAST_KEY = 'red-pen.grid.last-taxonomy'

type Saved = Partial<Record<TaxonomyId, Level[]>>

function read(storage?: Storage): Saved {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {}
  } catch {
    return {}
  }
}

function validLevels(levels: unknown): levels is Level[] {
  return (
    Array.isArray(levels) &&
    levels.length > 0 &&
    levels.every((l) => l && typeof l.id === 'string' && typeof l.name === 'string' && typeof l.target === 'number')
  )
}

/** The teacher's saved version of a taxonomy, or the built-in default. Built-in level names never change. */
export function savedTaxonomy(id: TaxonomyId, storage?: Storage): Taxonomy {
  const base = defaultTaxonomy(id)
  const levels = read(storage)[id]
  if (!validLevels(levels)) return base
  if (id === 'custom') return { id, levels: structuredClone(levels) }
  return {
    id,
    levels: base.levels.map((l) => ({ ...l, target: levels.find((s) => s.id === l.id)?.target ?? l.target })),
  }
}

export function rememberTaxonomy(t: Taxonomy, storage?: Storage): void {
  try {
    const saved = read(storage)
    saved[t.id] = structuredClone(t.levels)
    const s = storage ?? globalThis.localStorage
    s?.setItem(KEY, JSON.stringify(saved))
    s?.setItem(LAST_KEY, t.id)
  } catch {
    // Storage blocked: the grid still keeps its own copy of the levels.
  }
}

export function lastTaxonomyId(storage?: Storage): TaxonomyId {
  try {
    const id = (storage ?? globalThis.localStorage)?.getItem(LAST_KEY)
    return TAXONOMY_IDS.includes(id as TaxonomyId) ? (id as TaxonomyId) : 'caps'
  } catch {
    return 'caps'
  }
}
