// The random pick behind the wheel: which entries are still on it, who was picked, and undo.
import type { Rng } from './random'

/** What happens to an entry once it is picked: it comes off the wheel, or it stays on for another turn. */
export type AfterPick = 'remove' | 'keep'

/** One slice of the wheel: a learner or an option on a custom wheel. */
export interface Entry {
  id: string
  label: string
  /** This entry's own choice. Leave out to use the wheel's default. */
  after?: AfterPick
}

/** One pick, in the history. */
export interface Pick {
  id: string
  label: string
  /** Whether the pick took the entry off the wheel (so undo puts it back). */
  removed: boolean
}

/** Everything the wheel remembers between spins. */
export interface DrawState {
  /** Ids taken off the wheel, in the order they came off. */
  removed: string[]
  /** Every pick, oldest first. */
  history: Pick[]
}

export function emptyDraw(): DrawState {
  return { removed: [], history: [] }
}

/** The entries still on the wheel, in their original order. */
export function onWheel(entries: readonly Entry[], state: DrawState): Entry[] {
  const removed = new Set(state.removed)
  return entries.filter((e) => !removed.has(e.id))
}

/** Whether an entry comes off the wheel when picked. */
export function removesOnPick(entry: Entry, defaultAfter: AfterPick): boolean {
  return (entry.after ?? defaultAfter) === 'remove'
}

/**
 * Chooses the winner first, fairly, from the entries still on the wheel.
 * Returns its position among `onWheel(entries, state)` (the slice the wheel must land on), or null
 * when the wheel is empty. The state does not change until `recordPick`, after the wheel stops.
 */
export function chooseWinner(entries: readonly Entry[], state: DrawState, rng: Rng): number | null {
  const remaining = onWheel(entries, state)
  return remaining.length === 0 ? null : rng(remaining.length)
}

/** Records a pick in the history and takes the entry off the wheel if it is set to be removed. */
export function recordPick(state: DrawState, entry: Entry, defaultAfter: AfterPick): DrawState {
  const removed = removesOnPick(entry, defaultAfter) && !state.removed.includes(entry.id)
  return {
    removed: removed ? [...state.removed, entry.id] : [...state.removed],
    history: [...state.history, { id: entry.id, label: entry.label, removed }],
  }
}

/** Chooses and records in one step. Returns null when the wheel is empty. */
export function pick(
  entries: readonly Entry[],
  state: DrawState,
  defaultAfter: AfterPick,
  rng: Rng,
): { index: number; entry: Entry; state: DrawState } | null {
  const index = chooseWinner(entries, state, rng)
  if (index === null) return null
  const entry = onWheel(entries, state)[index]
  return { index, entry, state: recordPick(state, entry, defaultAfter) }
}

/** Undoes the last pick: drops it from the history and, if it took the entry off, puts the entry back. */
export function undoPick(state: DrawState): DrawState {
  const last = state.history.at(-1)
  if (!last) return state
  const removed = [...state.removed]
  if (last.removed) {
    const at = removed.lastIndexOf(last.id)
    if (at >= 0) removed.splice(at, 1)
  }
  return { removed, history: state.history.slice(0, -1) }
}

/** Puts every entry back on the wheel and clears the history. */
export function resetDraw(): DrawState {
  return emptyDraw()
}

/** Keeps only the parts of a stored state that still match the entries (after learners change). */
export function tidyDraw(state: DrawState, entries: readonly Entry[]): DrawState {
  const ids = new Set(entries.map((e) => e.id))
  return { removed: state.removed.filter((id) => ids.has(id)), history: [...state.history] }
}
