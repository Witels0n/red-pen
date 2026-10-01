import { describe, expect, it } from 'vitest'
import { INK_PRESETS, INK_STORAGE_KEY, createInk, type InkStorage } from '../src/ink'

function memoryStorage(initial: Record<string, string> = {}): InkStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const brokenStorage: InkStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
}

describe('Ink colour', () => {
  it('is red by default, and red is the first preset', () => {
    const ink = createInk(memoryStorage())
    expect(ink.get()).toBe('red')
    expect(Object.keys(INK_PRESETS)[0]).toBe('red')
    expect(ink.rgb()).toEqual({ r: 0.85, g: 0.1, b: 0.1 })
  })

  it('persists the chosen colour for the next session', () => {
    const storage = memoryStorage()
    createInk(storage).set('blue')
    expect(storage.data[INK_STORAGE_KEY]).toBe('blue')
    expect(createInk(storage).get()).toBe('blue')
  })

  it('falls back to red when the stored value is not a known preset', () => {
    expect(createInk(memoryStorage({ [INK_STORAGE_KEY]: 'chartreuse' })).get()).toBe('red')
  })

  it('ignores an unknown colour passed to set', () => {
    const ink = createInk(memoryStorage())
    ink.set('chartreuse' as never)
    expect(ink.get()).toBe('red')
  })

  it('still works for the session when storage is unavailable', () => {
    const ink = createInk(brokenStorage)
    expect(ink.get()).toBe('red')
    ink.set('green')
    expect(ink.get()).toBe('green')
  })

  it('tells subscribers when the colour changes, and not after unsubscribing', () => {
    const ink = createInk(memoryStorage())
    const seen: string[] = []
    const off = ink.subscribe((name) => seen.push(name))
    ink.set('black')
    ink.set('black') // unchanged: no notification
    off()
    ink.set('purple')
    expect(seen).toEqual(['black'])
  })
})
