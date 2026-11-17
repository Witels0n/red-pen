import { describe, expect, it } from 'vitest'
import {
  chooseWinner,
  emptyDraw,
  onWheel,
  pick,
  recordPick,
  resetDraw,
  tidyDraw,
  undoPick,
  type Entry,
} from '../src/picker/draw'
import { cryptoRng, seededRng, shuffle, type Rng } from '../src/picker/random'

const entries: Entry[] = [
  { id: 'a', label: 'Thandi Mokoena' },
  { id: 'b', label: 'Sipho Dlamini', after: 'keep' },
  { id: 'c', label: 'Ayesha Patel', after: 'remove' },
  { id: 'd', label: 'Lerato Nkosi' },
]

/** Always picks position `i` of what is left. */
const always =
  (i: number): Rng =>
  (n) =>
    Math.min(i, n - 1)

describe('cryptoRng', () => {
  it('only returns whole numbers from 0 to n - 1 and reaches every one', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const x = cryptoRng(7)
      expect(Number.isInteger(x) && x >= 0 && x < 7).toBe(true)
      seen.add(x)
    }
    expect(seen.size).toBe(7)
    expect(cryptoRng(1)).toBe(0)
  })

  it('is roughly even', () => {
    const counts = [0, 0, 0]
    for (let i = 0; i < 9000; i++) counts[cryptoRng(3)]++
    for (const c of counts) expect(c).toBeGreaterThan(2700)
  })

  it('refuses an empty range', () => {
    expect(() => cryptoRng(0)).toThrow(RangeError)
  })
})

describe('shuffle', () => {
  it('keeps every item', () => {
    const out = shuffle([1, 2, 3, 4, 5], seededRng(3))
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('picking', () => {
  it('removes after a pick by default, and never picks a removed entry again', () => {
    let state = emptyDraw()
    const picked: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = pick(entries, state, 'remove', always(0))!
      state = r.state
      picked.push(r.entry.id)
    }
    // b is set to keep in, so once it is first it stays first.
    expect(picked).toEqual(['a', 'b', 'b', 'b'])
    expect(onWheel(entries, state).map((e) => e.id)).toEqual(['b', 'c', 'd'])
  })

  it('a learner set to remove comes off even when the default is keep in', () => {
    const r = pick(entries, emptyDraw(), 'keep', always(2))!
    expect(r.entry.id).toBe('c')
    expect(r.state.removed).toEqual(['c'])
    expect(r.state.history).toEqual([{ id: 'c', label: 'Ayesha Patel', removed: true }])
    const again = pick(entries, r.state, 'keep', always(0))!
    expect(again.state.removed).toEqual(['c'])
    expect(again.state.history.at(-1)).toEqual({ id: 'a', label: 'Thandi Mokoena', removed: false })
  })

  it('the index is the position among the entries still on the wheel', () => {
    const state = recordPick(emptyDraw(), entries[0], 'remove')
    expect(chooseWinner(entries, state, always(0))).toBe(0)
    expect(pick(entries, state, 'remove', always(0))!.entry.id).toBe('b')
  })

  it('returns null once everyone is off the wheel', () => {
    let state = emptyDraw()
    const two = entries.slice(2)
    for (let i = 0; i < 2; i++) state = pick(two, state, 'remove', always(0))!.state
    expect(pick(two, state, 'remove', always(0))).toBeNull()
    expect(chooseWinner(two, state, always(0))).toBeNull()
  })

  it('undo puts a removed entry back and drops the pick from the history', () => {
    let state = pick(entries, emptyDraw(), 'remove', always(0))!.state
    state = pick(entries, state, 'remove', always(1))!.state // c, removed
    expect(state.removed).toEqual(['a', 'c'])
    state = undoPick(state)
    expect(state.removed).toEqual(['a'])
    expect(state.history.map((p) => p.id)).toEqual(['a'])
    state = undoPick(state)
    expect(state).toEqual(emptyDraw())
    expect(undoPick(state)).toEqual(emptyDraw())
  })

  it('undo of a kept-in pick only drops it from the history', () => {
    let state = pick(entries, emptyDraw(), 'keep', always(0))!.state
    state = pick(entries, state, 'keep', always(0))!.state
    expect(state.removed).toEqual([])
    state = undoPick(state)
    expect(state.history).toHaveLength(1)
  })

  it('reset puts everyone back', () => {
    const state = pick(entries, emptyDraw(), 'remove', always(0))!.state
    expect(onWheel(entries, resetDraw()).length).toBe(4)
    expect(state.removed.length).toBe(1)
  })

  it('tidy drops removed ids that are no longer entries', () => {
    expect(tidyDraw({ removed: ['a', 'zz'], history: [] }, entries).removed).toEqual(['a'])
  })

  it('every entry can win with the real generator', () => {
    const won = new Set<string>()
    for (let i = 0; i < 400; i++) won.add(pick(entries, emptyDraw(), 'remove', cryptoRng)!.entry.id)
    expect(won.size).toBe(4)
  })
})
