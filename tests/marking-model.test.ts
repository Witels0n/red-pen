import { describe, expect, it } from 'vitest'
import { createMarkingModel } from '../src/marking-model'

describe('marking model: placing Ticks', () => {
  it('starts with no Annotations', () => {
    expect(createMarkingModel().getAnnotations()).toEqual([])
  })

  it('placing a Tick adds a Tick Annotation at the given page position', () => {
    const model = createMarkingModel()
    const tick = model.placeTick(2, 120.5, 300)
    expect(tick).toMatchObject({ type: 'tick', page: 2, x: 120.5, y: 300 })
    expect(model.getAnnotations()).toEqual([tick])
  })

  it('gives each Annotation a distinct id', () => {
    const model = createMarkingModel()
    const a = model.placeTick(1, 10, 10)
    const b = model.placeTick(1, 10, 10)
    expect(a.id).not.toBe(b.id)
  })

  it('each Tick is worth exactly one Mark', () => {
    const model = createMarkingModel()
    model.placeTick(1, 10, 10)
    model.placeTick(3, 50, 90)
    expect(model.getMarks()).toBe(2)
  })

  it('returned annotations cannot be used to alter the model', () => {
    const model = createMarkingModel()
    model.placeTick(1, 10, 10)
    ;(model.getAnnotations() as unknown[]).length = 0
    expect(model.getAnnotations()).toHaveLength(1)
  })
})

describe('marking model: placing Crosses', () => {
  it('placing a Cross adds a Cross Annotation at the given page position', () => {
    const model = createMarkingModel()
    const cross = model.placeCross(3, 42, 77.5)
    expect(cross).toMatchObject({ type: 'cross', page: 3, x: 42, y: 77.5 })
    expect(model.getAnnotations()).toEqual([cross])
  })

  it('a Cross is worth no Marks, and does not change the count of Ticks', () => {
    const model = createMarkingModel()
    model.placeCross(1, 5, 5)
    expect(model.getMarks()).toBe(0)
    model.placeTick(1, 10, 10)
    model.placeCross(2, 20, 20)
    expect(model.getMarks()).toBe(1)
    expect(model.getAnnotations()).toHaveLength(3)
  })

  it('notifies subscribers and gives distinct ids', () => {
    const model = createMarkingModel()
    let calls = 0
    model.onChange(() => calls++)
    const a = model.placeCross(1, 1, 1)
    const b = model.placeTick(1, 1, 1)
    expect(calls).toBe(2)
    expect(a.id).not.toBe(b.id)
  })
})

describe('marking model: change notification', () => {
  it('notifies subscribers after a change, until they unsubscribe', () => {
    const model = createMarkingModel()
    let calls = 0
    const off = model.onChange(() => calls++)
    model.placeTick(1, 1, 1)
    expect(calls).toBe(1)
    off()
    model.placeTick(1, 2, 2)
    expect(calls).toBe(1)
  })

  it('subscribers see the new state when notified', () => {
    const model = createMarkingModel()
    let seen = -1
    model.onChange(() => (seen = model.getAnnotations().length))
    model.placeTick(1, 1, 1)
    expect(seen).toBe(1)
  })
})

describe('marking model: reset', () => {
  it('clears all Annotations and notifies', () => {
    const model = createMarkingModel()
    model.placeTick(1, 1, 1)
    let calls = 0
    model.onChange(() => calls++)
    model.reset()
    expect(model.getAnnotations()).toEqual([])
    expect(model.getMarks()).toBe(0)
    expect(calls).toBe(1)
  })
})

describe('marking model: Reasons on Crosses', () => {
  it('a new Cross has no Reason', () => {
    const cross = createMarkingModel().placeCross(1, 5, 5)
    expect(cross).not.toHaveProperty('reason')
  })

  it('setting a Reason attaches it to that Cross only, and notifies', () => {
    const model = createMarkingModel()
    const a = model.placeCross(1, 5, 5)
    const b = model.placeCross(1, 50, 50)
    let calls = 0
    model.onChange(() => calls++)
    model.setReason(a.id, 'RTQ')
    expect(model.getAnnotations()).toEqual([{ ...a, reason: 'RTQ' }, b])
    expect(calls).toBe(1)
  })

  it('a Reason can be changed and then cleared', () => {
    const model = createMarkingModel()
    const cross = model.placeCross(2, 9, 9)
    model.setReason(cross.id, 'RTQ')
    model.setReason(cross.id, 'Factual error')
    expect(model.getAnnotations()[0]).toMatchObject({ reason: 'Factual error' })
    model.setReason(cross.id, undefined)
    expect(model.getAnnotations()[0]).toEqual(cross)
    expect(model.getAnnotations()[0]).not.toHaveProperty('reason')
  })

  it('setting a Reason never changes position or Marks', () => {
    const model = createMarkingModel()
    const cross = model.placeCross(2, 9, 9)
    model.placeTick(1, 1, 1)
    model.setReason(cross.id, 'RTQ')
    expect(model.getAnnotations()[0]).toMatchObject({ type: 'cross', page: 2, x: 9, y: 9 })
    expect(model.getMarks()).toBe(1)
  })

  it('ignores unknown ids and Annotations that are not Crosses', () => {
    const model = createMarkingModel()
    const tick = model.placeTick(1, 1, 1)
    let calls = 0
    model.onChange(() => calls++)
    model.setReason(tick.id, 'RTQ')
    model.setReason('nope', 'RTQ')
    expect(model.getAnnotations()).toEqual([tick])
    expect(calls).toBe(0)
  })

  it('a blank Reason clears it', () => {
    const model = createMarkingModel()
    const cross = model.placeCross(1, 1, 1)
    model.setReason(cross.id, 'RTQ')
    model.setReason(cross.id, '   ')
    expect(model.getAnnotations()[0]).not.toHaveProperty('reason')
  })
})
