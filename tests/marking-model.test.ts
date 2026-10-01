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

describe('marking model: move', () => {
  it('moves an Annotation to a new position, keeping its identity and page', () => {
    const model = createMarkingModel()
    const tick = model.placeTick(2, 10, 20)
    model.moveAnnotation(tick.id, 55, 66)
    expect(model.getAnnotations()).toEqual([{ id: tick.id, type: 'tick', page: 2, x: 55, y: 66 }])
  })

  it('can move an Annotation onto another page', () => {
    const model = createMarkingModel()
    const tick = model.placeTick(1, 10, 20)
    model.moveAnnotation(tick.id, 5, 6, 3)
    expect(model.getAnnotations()[0]).toMatchObject({ page: 3, x: 5, y: 6 })
  })

  it('leaves the Marks unchanged and notifies once', () => {
    const model = createMarkingModel()
    const tick = model.placeTick(1, 10, 20)
    let calls = 0
    model.onChange(() => calls++)
    model.moveAnnotation(tick.id, 1, 1)
    expect(model.getMarks()).toBe(1)
    expect(calls).toBe(1)
  })

  it('ignores an unknown id without notifying', () => {
    const model = createMarkingModel()
    model.placeTick(1, 10, 20)
    let calls = 0
    model.onChange(() => calls++)
    model.moveAnnotation('nope', 1, 1)
    expect(model.getAnnotations()[0]).toMatchObject({ x: 10, y: 20 })
    expect(calls).toBe(0)
  })
})

describe('marking model: delete', () => {
  it('removes only that Annotation and its Mark', () => {
    const model = createMarkingModel()
    const a = model.placeTick(1, 10, 20)
    const b = model.placeTick(1, 30, 40)
    model.deleteAnnotation(a.id)
    expect(model.getAnnotations().map((x) => x.id)).toEqual([b.id])
    expect(model.getMarks()).toBe(1)
  })

  it('ignores an unknown id without notifying', () => {
    const model = createMarkingModel()
    model.placeTick(1, 10, 20)
    let calls = 0
    model.onChange(() => calls++)
    model.deleteAnnotation('nope')
    expect(model.getAnnotations()).toHaveLength(1)
    expect(calls).toBe(0)
  })
})
