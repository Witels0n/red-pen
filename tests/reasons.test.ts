import { describe, expect, it } from 'vitest'
import { DEFAULT_REASONS, REASONS_STORAGE_KEY, createReasonsList, type ReasonsStorage } from '../src/reasons'

/** A plain in-memory stand-in for localStorage. */
function memoryStorage(initial: Record<string, string> = {}): ReasonsStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const brokenStorage: ReasonsStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
}

describe('Reasons list', () => {
  it('starts with the defaults, which include Factual error, RTQ and Repeated fact', () => {
    const list = createReasonsList(memoryStorage())
    expect(list.get()).toEqual(DEFAULT_REASONS)
    expect(list.get()).toEqual(expect.arrayContaining(['Factual error', 'RTQ', 'Repeated fact']))
    expect(list.get().length).toBeGreaterThan(3)
  })

  it('remembers an edited list across sessions, storing only that list under one key', () => {
    const storage = memoryStorage()
    createReasonsList(storage).set(['Units', 'Method'])
    expect(Object.keys(storage.data)).toEqual([REASONS_STORAGE_KEY])
    expect(createReasonsList(storage).get()).toEqual(['Units', 'Method'])
  })

  it('tidies edits: trims, drops blanks and duplicates, keeps order', () => {
    const list = createReasonsList(memoryStorage())
    list.set(['  Units ', '', 'Method', 'units'.replace('u', 'U'), '   '])
    expect(list.get()).toEqual(['Units', 'Method'])
  })

  it('an empty list is allowed (the teacher may want no Reasons)', () => {
    const storage = memoryStorage()
    createReasonsList(storage).set([])
    expect(createReasonsList(storage).get()).toEqual([])
  })

  it('restoring defaults brings the default list back', () => {
    const list = createReasonsList(memoryStorage())
    list.set(['Units'])
    list.restoreDefaults()
    expect(list.get()).toEqual(DEFAULT_REASONS)
  })

  it('falls back to defaults when stored data is corrupt', () => {
    for (const junk of ['not json', '{"a":1}', '[1,2]', 'null']) {
      expect(createReasonsList(memoryStorage({ [REASONS_STORAGE_KEY]: junk })).get()).toEqual(DEFAULT_REASONS)
    }
  })

  it('still works for the session when storage is unavailable', () => {
    const list = createReasonsList(brokenStorage)
    expect(list.get()).toEqual(DEFAULT_REASONS)
    list.set(['Units'])
    expect(list.get()).toEqual(['Units'])
  })

  it('works when there is no storage at all', () => {
    const list = createReasonsList(undefined)
    list.set(['Units'])
    expect(list.get()).toEqual(['Units'])
  })

  it('returned lists cannot alter the stored list', () => {
    const list = createReasonsList(memoryStorage())
    ;(list.get() as string[]).length = 0
    expect(list.get()).toEqual(DEFAULT_REASONS)
  })
})
