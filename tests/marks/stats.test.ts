import { describe, expect, it } from 'vitest'
import { bandIndex, bandScheme, oneDp, parseCutoffs, pct, quantile, summarise } from '../../src/marks/core/stats'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  sanitiseSettings,
  saveSettings,
  STORAGE_KEY,
} from '../../src/marks/core/settings'

const caps = bandScheme('caps')

describe('band schemes', () => {
  it('CAPS has seven levels from 0-29 to 80-100', () => {
    expect(caps.bands.map((b) => b.range)).toEqual(['0-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-100'])
    expect(caps.bands[0].label).toBe('Level 1')
  })

  it('10% bands and symbols', () => {
    expect(bandScheme('tens').bands).toHaveLength(10)
    expect(bandScheme('tens').bands[9].range).toBe('90-100')
    expect(bandScheme('symbols').bands.map((b) => b.label)).toEqual(['H', 'G', 'FF', 'F', 'E', 'D', 'C', 'B', 'A'])
  })

  it('custom cut-offs', () => {
    expect(bandScheme('custom', [50, 75]).bands.map((b) => b.range)).toEqual(['0-49', '50-74', '75-100'])
    expect(parseCutoffs('75, 50 50')).toEqual([50, 75])
    expect(typeof parseCutoffs('0, 50')).toBe('string')
    expect(typeof parseCutoffs('fifty')).toBe('string')
    expect(typeof parseCutoffs('')).toBe('string')
  })

  it('bands use the exact percentage before rounding', () => {
    expect(bandIndex(caps, 29.6)).toBe(0)
    expect(bandIndex(caps, 30)).toBe(1)
    expect(bandIndex(caps, 100)).toBe(6)
    expect(bandIndex(caps, 0)).toBe(0)
  })
})

describe('summarise', () => {
  it('returns null without marks', () => {
    expect(summarise([], caps, 50)).toBeNull()
  })

  it('works out the summary in percentages', () => {
    const s = summarise([40, 50, 60, 70, 80], caps, 50, 2, 1)!
    expect(s.count).toBe(5)
    expect(s.absent).toBe(2)
    expect(s.unreadable).toBe(1)
    expect(s.mean).toBe(60)
    expect(s.median).toBe(60)
    expect(s.sd).toBeCloseTo(14.142, 3) // population SD
    expect([s.min, s.max, s.range]).toEqual([40, 80, 40])
    expect([s.q1, s.q3]).toEqual([50, 70])
    expect(s.passCount).toBe(4)
    expect(s.passRate).toBe(80)
    expect(s.bands.map((b) => b.count)).toEqual([0, 0, 1, 1, 1, 1, 1])
    expect(s.bands[2].share).toBe(20)
  })

  it('finds outliers beyond 1.5 x IQR and stops the whiskers at the last mark inside', () => {
    const s = summarise([5, 50, 52, 54, 56, 58, 60, 99], caps, 50)!
    expect(s.outliers).toEqual([5, 99])
    expect(s.whiskerLow).toBe(50)
    expect(s.whiskerHigh).toBe(60)
  })

  it('interpolates quartiles like QUARTILE.INC', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  })
})

describe('formatting', () => {
  it('shows one decimal place', () => {
    expect(pct(54.25)).toBe('54.3%')
    expect(oneDp(12)).toBe('12.0')
    expect(oneDp(-0.01)).toBe('0.0')
  })
})

describe('settings', () => {
  it('fills in bad values with defaults', () => {
    expect(sanitiseSettings({ scheme: 'odd', passMark: 400, customCutoffs: ['x'] })).toEqual(DEFAULT_SETTINGS)
    expect(sanitiseSettings({ scheme: 'custom', passMark: 40, customCutoffs: [70, 30] })).toEqual({
      scheme: 'custom',
      passMark: 40,
      customCutoffs: [30, 70],
    })
  })

  it('round-trips through storage under red-pen.marks.', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }
    saveSettings({ scheme: 'tens', passMark: 30, customCutoffs: [50] }, storage)
    expect(STORAGE_KEY.startsWith('red-pen.marks.')).toBe(true)
    expect(loadSettings(storage)).toEqual({ scheme: 'tens', passMark: 30, customCutoffs: [50] })
  })
})
