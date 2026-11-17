import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, fitToWidthScale, layoutPages, stepZoom, visiblePages } from '../src/mark/viewer-math'

// Seam: pure zoom / layout / visibility math. Scale = CSS pixels per PDF page unit.

describe('fitToWidthScale', () => {
  it('makes the page exactly as wide as the container minus gutters', () => {
    // A4 portrait is 595 units wide; 1000px container with 20px gutters either side.
    expect(fitToWidthScale(1000, 500, 20)).toBeCloseTo(960 / 500)
  })

  it('never returns a non-positive scale for a tiny container', () => {
    expect(fitToWidthScale(10, 500, 20)).toBeGreaterThan(0)
  })
})

describe('stepZoom', () => {
  it('zooms in and out by a fixed factor', () => {
    expect(stepZoom(1, 'in')).toBeCloseTo(1.25)
    expect(stepZoom(1.25, 'out')).toBeCloseTo(1)
  })

  it('is clamped to the allowed range', () => {
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM)
  })
})

describe('layoutPages', () => {
  it('stacks pages top to bottom with a gap, at the given scale', () => {
    const layout = layoutPages(
      [
        { width: 100, height: 200 },
        { width: 100, height: 100 },
      ],
      2,
      10,
    )
    expect(layout).toEqual([
      { top: 0, height: 400 },
      { top: 410, height: 200 },
    ])
  })
})

describe('visiblePages', () => {
  const layout = [
    { top: 0, height: 100 },
    { top: 110, height: 100 },
    { top: 220, height: 100 },
    { top: 330, height: 100 },
  ]

  it('returns pages intersecting the viewport', () => {
    expect(visiblePages(layout, 0, 150, 0)).toEqual([0, 1])
  })

  it('includes pages within the margin beyond the viewport', () => {
    expect(visiblePages(layout, 0, 100, 50)).toEqual([0, 1])
    expect(visiblePages(layout, 0, 100, 0)).toEqual([0])
  })

  it('handles scrolling to the end', () => {
    expect(visiblePages(layout, 340, 100, 0)).toEqual([3])
  })
})
