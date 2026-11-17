import { describe, expect, it } from 'vitest'
import {
  TAU,
  easeOut,
  edgesBetween,
  landingRotation,
  normaliseAngle,
  sliceAt,
  sliceFontSize,
  spinAt,
  tickerAt,
  tickerLanding,
} from '../src/picker/spin'
import { seededRng } from '../src/picker/random'

describe('wheel landing angle', () => {
  it('slice 0 is under the pointer at rotation 0, and turning clockwise brings the last slice next', () => {
    expect(sliceAt(0, 4)).toBe(0)
    expect(sliceAt(0.01, 4)).toBe(3)
    expect(sliceAt(-0.01, 4)).toBe(0)
    expect(sliceAt(TAU / 4 + 0.01, 4)).toBe(2)
  })

  it('lands on the chosen slice for every count from 1 to 60, from any start, at any offset', () => {
    const rng = seededRng(42)
    for (let count = 1; count <= 60; count++) {
      for (let trial = 0; trial < 20; trial++) {
        const current = (rng(100_000) / 1000) * (rng(2) ? 1 : -1)
        const index = rng(count)
        const offset = 0.05 + rng(900) / 1000
        const end = landingRotation(current, index, count, { turns: 5, offset })
        expect(sliceAt(end, count)).toBe(index)
        expect(end - current).toBeGreaterThanOrEqual(5 * TAU)
        expect(end - current).toBeLessThan(6 * TAU)
      }
    }
  })

  it('stops in the middle of the slice with offset 0.5', () => {
    const end = landingRotation(0, 1, 4, { turns: 0, offset: 0.5 })
    // Slice 1 covers 90 to 180 degrees from the pointer, so its middle (135) must come to the top.
    expect(normaliseAngle(-end)).toBeCloseTo((3 * TAU) / 8)
  })

  it('clamps offsets at the edges so floating point never lands on the neighbour', () => {
    for (const offset of [0, 1]) {
      const end = landingRotation(1.234, 7, 12, { turns: 3, offset })
      expect(sliceAt(end, 12)).toBe(7)
    }
  })

  it('eases from start to finish without overshooting', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.9)
    expect(spinAt(2, 10, 1)).toBe(10)
    let last = -1
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOut(t)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })

  it('counts one tick per slice edge passed', () => {
    expect(edgesBetween(0, TAU, 8)).toBe(8)
    expect(edgesBetween(0.1, 0.2, 8)).toBe(0)
  })

  it('shrinks label text as slices get thinner, within limits', () => {
    const few = sliceFontSize(300, 6, 10, 40)
    const many = sliceFontSize(300, 60, 10, 40)
    expect(few).toBe(40)
    expect(many).toBeLessThan(few)
    expect(sliceFontSize(50, 60, 10, 40)).toBe(10)
  })
})

describe('ticker landing', () => {
  it('stops with the chosen entry in the middle row, at least the given loops ahead', () => {
    const rng = seededRng(7)
    for (let count = 1; count <= 60; count++) {
      const current = rng(500)
      const index = rng(count)
      const end = tickerLanding(current, index, count, 3)
      expect(tickerAt(end, count)).toBe(index)
      expect(end - current).toBeGreaterThanOrEqual(3 * count)
      expect(end - current).toBeLessThan(4 * count + 1)
    }
  })

  it('wraps negative positions', () => {
    expect(tickerAt(-1, 5)).toBe(4)
  })
})
