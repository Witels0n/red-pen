import { describe, expect, it } from 'vitest'
import { createMarkingModel } from '../src/marking-model'

describe('Subtotals', () => {
  it('counts Ticks above it on the page, back to the start of the Test', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 100)
    m.placeTick(1, 100, 200)
    const s = m.placeSubtotal(1, 20, 300)
    expect(m.getSubtotalCount(s.id)).toBe(2)
  })

  it('counts in reading order, not placement order', () => {
    const m = createMarkingModel()
    const s = m.placeSubtotal(1, 20, 300) // placed first
    m.placeTick(1, 100, 100)
    m.placeTick(1, 100, 350) // below the Subtotal: not counted
    expect(m.getSubtotalCount(s.id)).toBe(1)
  })

  it('counts Ticks on earlier pages before Ticks on later pages', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 700)
    const s = m.placeSubtotal(2, 20, 50)
    m.placeTick(2, 100, 400)
    expect(m.getSubtotalCount(s.id)).toBe(1)
  })

  it('counts a Tick slightly lower than the Subtotal on the same line, even to its right', () => {
    const m = createMarkingModel()
    const s = m.placeSubtotal(1, 20, 300)
    m.placeTick(1, 400, 306)
    expect(m.getSubtotalCount(s.id)).toBe(1)
  })

  it('does not count a Tick a full line below', () => {
    const m = createMarkingModel()
    const s = m.placeSubtotal(1, 20, 300)
    m.placeTick(1, 400, 340)
    expect(m.getSubtotalCount(s.id)).toBe(0)
  })

  it('ignores Crosses', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 100)
    m.placeCross(1, 100, 150)
    const s = m.placeSubtotal(1, 20, 300)
    expect(m.getSubtotalCount(s.id)).toBe(1)
  })

  it('chains: each Subtotal counts from the one before', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 100)
    m.placeTick(1, 100, 150)
    const s1 = m.placeSubtotal(1, 20, 200)
    m.placeTick(1, 100, 250)
    const s2 = m.placeSubtotal(2, 20, 100)
    m.placeTick(2, 100, 50)
    expect(m.getSubtotalCount(s1.id)).toBe(2)
    expect(m.getSubtotalCount(s2.id)).toBe(2)
  })

  it('recalculates live when Ticks and Subtotals are added, moved or deleted', () => {
    const m = createMarkingModel()
    const t = m.placeTick(1, 100, 100)
    const s = m.placeSubtotal(1, 20, 300)
    expect(m.getSubtotalCount(s.id)).toBe(1)
    m.placeTick(1, 100, 200)
    expect(m.getSubtotalCount(s.id)).toBe(2)
    m.moveAnnotation(t.id, 100, 500) // now below the Subtotal
    expect(m.getSubtotalCount(s.id)).toBe(1)
    m.moveAnnotation(s.id, 20, 600)
    expect(m.getSubtotalCount(s.id)).toBe(2)
    m.deleteAnnotation(t.id)
    expect(m.getSubtotalCount(s.id)).toBe(1)
  })

  it('moving a Subtotal changes what the next one counts', () => {
    const m = createMarkingModel()
    const s1 = m.placeSubtotal(1, 20, 200)
    m.placeTick(1, 100, 100)
    m.placeTick(1, 100, 300)
    const s2 = m.placeSubtotal(1, 20, 400)
    expect(m.getSubtotalCount(s1.id)).toBe(1)
    expect(m.getSubtotalCount(s2.id)).toBe(1)
    m.moveAnnotation(s1.id, 20, 350)
    expect(m.getSubtotalCount(s1.id)).toBe(2)
    expect(m.getSubtotalCount(s2.id)).toBe(0)
  })

  it('two Subtotals at the same spot do not both count the same Ticks', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 100)
    const a = m.placeSubtotal(1, 20, 200)
    const b = m.placeSubtotal(1, 20, 200)
    expect(m.getSubtotalCount(a.id)).toBe(1)
    expect(m.getSubtotalCount(b.id)).toBe(0)
  })

  it('has no count for unknown ids or other annotations', () => {
    const m = createMarkingModel()
    const t = m.placeTick(1, 1, 1)
    expect(m.getSubtotalCount(t.id)).toBeUndefined()
    expect(m.getSubtotalCount('nope')).toBeUndefined()
  })
})

describe('Total', () => {
  it('counts every Tick, including those after the last Subtotal', () => {
    const m = createMarkingModel()
    m.placeTick(1, 100, 100)
    m.placeSubtotal(1, 20, 200)
    m.placeTick(1, 100, 300)
    m.placeTick(3, 100, 300)
    const total = m.placeTotal(3, 20, 500, 40)
    expect(total).toBeDefined()
    expect(m.getTotal()).toEqual({ id: total!.id, count: 3, outOf: 40, over: false })
  })

  it('allows only one Total', () => {
    const m = createMarkingModel()
    m.placeTotal(1, 10, 10, 40)
    expect(m.placeTotal(1, 50, 50, 20)).toBeUndefined()
    expect(m.getAnnotations().filter((a) => a.type === 'total')).toHaveLength(1)
  })

  it('allows a new Total once the old one is deleted', () => {
    const m = createMarkingModel()
    const t = m.placeTotal(1, 10, 10, 40)!
    m.deleteAnnotation(t.id)
    expect(m.getTotal()).toBeUndefined()
    expect(m.placeTotal(1, 10, 10, 30)).toBeDefined()
  })

  it('flags over-maximum without blocking Ticks', () => {
    const m = createMarkingModel()
    m.placeTotal(1, 10, 10, 2)
    m.placeTick(1, 50, 50)
    m.placeTick(1, 60, 60)
    expect(m.getTotal()?.over).toBe(false)
    m.placeTick(1, 70, 70)
    expect(m.getTotal()).toMatchObject({ count: 3, outOf: 2, over: true })
  })

  it('the out-of value can be edited afterwards', () => {
    const m = createMarkingModel()
    const t = m.placeTotal(1, 10, 10, 2)!
    m.placeTick(1, 50, 50)
    m.placeTick(1, 60, 60)
    m.placeTick(1, 70, 70)
    m.setTotalOutOf(t.id, 40)
    expect(m.getTotal()).toMatchObject({ outOf: 40, over: false })
  })

  it('updates live as Ticks change', () => {
    const m = createMarkingModel()
    m.placeTotal(1, 10, 10, 40)
    const t = m.placeTick(1, 50, 50)
    expect(m.getTotal()?.count).toBe(1)
    m.deleteAnnotation(t.id)
    expect(m.getTotal()?.count).toBe(0)
  })
})

describe('Text notes', () => {
  it('can be added, edited and deleted', () => {
    const m = createMarkingModel()
    const n = m.placeText(2, 30, 40, '-1 for units')
    expect(n).toMatchObject({ type: 'text', page: 2, x: 30, y: 40, text: '-1 for units' })
    m.editText(n.id, 'no working')
    expect(m.getAnnotations()).toEqual([expect.objectContaining({ id: n.id, text: 'no working' })])
    m.deleteAnnotation(n.id)
    expect(m.getAnnotations()).toEqual([])
  })

  it('are worth no Marks', () => {
    const m = createMarkingModel()
    m.placeText(1, 1, 1, 'hi')
    expect(m.getMarks()).toBe(0)
  })

  it('editing something that is not a Text note is ignored', () => {
    const m = createMarkingModel()
    const t = m.placeTick(1, 1, 1)
    m.editText(t.id, 'x')
    expect(m.getAnnotations()).toEqual([t])
  })
})

describe('undo and redo', () => {
  it('undoes and redoes place, move and delete', () => {
    const m = createMarkingModel()
    const t = m.placeTick(1, 10, 10)
    m.moveAnnotation(t.id, 50, 60)
    m.deleteAnnotation(t.id)
    expect(m.getAnnotations()).toEqual([])

    m.undo()
    expect(m.getAnnotations()).toEqual([{ ...t, x: 50, y: 60 }])
    m.undo()
    expect(m.getAnnotations()).toEqual([t])
    m.undo()
    expect(m.getAnnotations()).toEqual([])

    m.redo()
    expect(m.getAnnotations()).toEqual([t])
    m.redo()
    m.redo()
    expect(m.getAnnotations()).toEqual([])
  })

  it('covers every kind of command', () => {
    const m = createMarkingModel()
    m.placeCross(1, 1, 1)
    m.placeSubtotal(1, 2, 2)
    const total = m.placeTotal(1, 3, 3, 10)!
    m.setTotalOutOf(total.id, 20)
    const note = m.placeText(1, 4, 4, 'a')
    m.editText(note.id, 'b')
    for (let i = 0; i < 6; i++) m.undo()
    expect(m.getAnnotations()).toEqual([])
    for (let i = 0; i < 6; i++) m.redo()
    expect(m.getAnnotations()).toHaveLength(4)
    expect(m.getTotal()?.outOf).toBe(20)
  })

  it('a new command after undo clears the redo history', () => {
    const m = createMarkingModel()
    m.placeTick(1, 1, 1)
    m.undo()
    expect(m.canRedo()).toBe(true)
    m.placeCross(1, 2, 2)
    expect(m.canRedo()).toBe(false)
    m.redo()
    expect(m.getAnnotations()).toHaveLength(1)
  })

  it('does nothing when there is nothing to undo or redo, and notifies on change', () => {
    const m = createMarkingModel()
    let calls = 0
    m.onChange(() => calls++)
    m.undo()
    m.redo()
    expect(calls).toBe(0)
    expect(m.canUndo()).toBe(false)
    m.placeTick(1, 1, 1)
    m.undo()
    expect(calls).toBe(2)
  })

  it('ids stay unique after undo', () => {
    const m = createMarkingModel()
    const a = m.placeTick(1, 1, 1)
    m.undo()
    const b = m.placeTick(1, 1, 1)
    expect(b.id).not.toBe(a.id)
  })

  it('reset clears the history', () => {
    const m = createMarkingModel()
    m.placeTick(1, 1, 1)
    m.reset()
    expect(m.canUndo()).toBe(false)
    m.undo()
    expect(m.getAnnotations()).toEqual([])
  })
})
