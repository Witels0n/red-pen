import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  describeChange,
  firstAttempt,
  formatBytes,
  loadSettings,
  MAX_ATTEMPTS,
  MIN_DPI,
  MIN_QUALITY,
  nextAttempt,
  preferredChoice,
  renderScale,
  sanitiseSettings,
  searchSettings,
  targetBytes,
  uniqueFileNames,
  type Attempt,
} from '../src/compress/settings'

const MB = 1024 * 1024

/** A rough stand-in for a scan: size grows with pixels and with quality. */
const model = (base: number) => (a: Attempt) => base * (a.dpi / 150) ** 2 * (0.3 + a.quality)

describe('formatBytes', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(900)).toBe('900 bytes')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(850 * 1024)).toBe('850 KB')
    expect(formatBytes(1000 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1.44 * MB)).toBe('1.4 MB')
    expect(formatBytes(9.96 * MB)).toBe('10.0 MB')
    expect(formatBytes(12.4 * MB)).toBe('12 MB')
    expect(formatBytes(-1)).toBe('?')
    expect(formatBytes(NaN)).toBe('?')
  })

  it('describes the change in size', () => {
    expect(describeChange(1000, 360)).toBe('64% smaller')
    expect(describeChange(1000, 1020)).toBe('2% larger')
    expect(describeChange(1000, 1001)).toBe('About the same size')
    expect(describeChange(0, 10)).toBe('')
  })
})

describe('targetBytes', () => {
  it('converts a target to bytes', () => {
    expect(targetBytes(2, 'MB')).toBe(2 * MB)
    expect(targetBytes(500, 'KB')).toBe(500 * 1024)
    expect(targetBytes(1.5, 'MB')).toBe(Math.floor(1.5 * MB))
  })

  it('refuses nonsense', () => {
    expect(targetBytes(0, 'MB')).toBeNull()
    expect(targetBytes(-3, 'KB')).toBeNull()
    expect(targetBytes(NaN, 'MB')).toBeNull()
  })
})

describe('nextAttempt', () => {
  it('stops once the file fits', () => {
    expect(nextAttempt({ dpi: 150, quality: 0.7 }, 1.9 * MB, 2 * MB)).toBeNull()
    expect(nextAttempt({ dpi: 150, quality: 0.7 }, 2 * MB, 2 * MB)).toBeNull()
  })

  it('lowers quality first when only a little too big', () => {
    expect(nextAttempt({ dpi: 150, quality: 0.7 }, 2.4 * MB, 2 * MB)).toEqual({ dpi: 150, quality: 0.55 })
    expect(nextAttempt({ dpi: 150, quality: 0.55 }, 2.4 * MB, 2 * MB)).toEqual({ dpi: 150, quality: 0.5 })
  })

  it('lowers resolution by the square root of the overshoot when far too big', () => {
    // Four times too big: half the resolution, less a margin.
    expect(nextAttempt({ dpi: 200, quality: 0.7 }, 8 * MB, 2 * MB)).toEqual({ dpi: 95, quality: 0.7 })
    expect(nextAttempt({ dpi: 100, quality: 0.7 }, 100 * MB, 2 * MB)).toEqual({ dpi: MIN_DPI, quality: 0.7 })
  })

  it('always makes progress, and gives up at the lowest settings', () => {
    expect(nextAttempt({ dpi: 73, quality: 0.5 }, 2.01 * MB, 2 * MB)).toEqual({ dpi: 72, quality: 0.5 })
    expect(nextAttempt({ dpi: MIN_DPI, quality: 0.5 }, 3 * MB, 2 * MB)).toEqual({ dpi: MIN_DPI, quality: 0.35 })
    expect(nextAttempt({ dpi: MIN_DPI, quality: 0.35 }, 3 * MB, 2 * MB)).toEqual({ dpi: MIN_DPI, quality: 0.3 })
    expect(nextAttempt({ dpi: MIN_DPI, quality: MIN_QUALITY }, 3 * MB, 2 * MB)).toBeNull()
  })

  it('every step is smaller than the last, until it ends', () => {
    let a: Attempt | null = { dpi: 200, quality: 0.95 }
    let steps = 0
    while (a && steps < 50) {
      const next: Attempt | null = nextAttempt(a, 1e12, 1)
      if (next) expect(next.dpi < a.dpi || next.quality < a.quality).toBe(true)
      a = next
      steps++
    }
    expect(a).toBeNull()
    expect(steps).toBeLessThan(20)
  })
})

describe('searchSettings', () => {
  it('runs once without a target', async () => {
    const tried = await searchSettings({ dpi: 150, quality: 0.7 }, null, async (a) => model(MB)(a))
    expect(tried).toHaveLength(1)
  })

  it('stops at the first result that fits', async () => {
    const run = async (a: Attempt) => model(3 * MB)(a)
    const tried = await searchSettings({ dpi: 150, quality: 0.7 }, 2 * MB, run)
    expect(tried.at(-1)!.size).toBeLessThanOrEqual(2 * MB)
    expect(tried.slice(0, -1).every((t) => t.size > 2 * MB)).toBe(true)
    expect(tried.length).toBeGreaterThan(1)
  })

  it('reaches a far target within the attempt limit', async () => {
    const tried = await searchSettings({ dpi: 200, quality: 0.9 }, 2 * MB, async (a) => model(10 * MB)(a))
    expect(tried.length).toBeLessThanOrEqual(MAX_ATTEMPTS)
    expect(tried.at(-1)!.size).toBeLessThanOrEqual(2 * MB)
  })

  it('gives up after the limit when the target cannot be reached', async () => {
    const tried = await searchSettings({ dpi: 200, quality: 0.9 }, 1, async () => 5 * MB)
    expect(tried).toHaveLength(MAX_ATTEMPTS)
  })

  it('passes the attempt number to the runner', async () => {
    const seen: number[] = []
    const tried = await searchSettings({ dpi: 150, quality: 0.7 }, 1, async (_a, i) => {
      seen.push(i)
      return 10
    })
    // 150 dpi, then 72 dpi, then quality 0.55, 0.4 and 0.3: nothing smaller is left to try.
    expect(tried.map((t) => [t.dpi, t.quality])).toEqual([
      [150, 0.7],
      [72, 0.7],
      [72, 0.55],
      [72, 0.4],
      [72, 0.3],
    ])
    expect(seen).toEqual([0, 1, 2, 3, 4])
  })
})

describe('choices', () => {
  it('keeps the original when compressing does not help', () => {
    expect(preferredChoice(1000, 400)).toBe('compressed')
    expect(preferredChoice(1000, 1000)).toBe('original')
    expect(preferredChoice(1000, 1400)).toBe('original')
  })

  it('starts from the preset resolution', () => {
    expect(firstAttempt({ ...DEFAULT_SETTINGS, preset: 'small', quality: 2 })).toEqual({ dpi: 100, quality: 0.95 })
    expect(firstAttempt({ ...DEFAULT_SETTINGS, preset: 'sharp' }).dpi).toBe(200)
  })

  it('caps the canvas size for huge pages', () => {
    expect(renderScale(595, 842, 144)).toBe(2)
    const s = renderScale(3000, 3000, 300)
    expect(3000 * s * 3000 * s).toBeCloseTo(16_000_000, -2)
  })
})

describe('uniqueFileNames', () => {
  it('numbers repeated names, ignoring case', () => {
    expect(uniqueFileNames(['a.pdf', 'b.pdf', 'A.pdf', 'a.pdf', 'notes'])).toEqual([
      'a.pdf',
      'b.pdf',
      'A (2).pdf',
      'a (3).pdf',
      'notes',
    ])
  })
})

describe('settings', () => {
  it('fills in defaults and clamps', () => {
    expect(sanitiseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    const s = sanitiseSettings({ preset: 'huge', quality: 0.1, targetValue: -2, targetUnit: 'GB', greyscale: true })
    expect(s).toEqual({ ...DEFAULT_SETTINGS, quality: MIN_QUALITY, greyscale: true })
  })

  it('survives broken storage', () => {
    expect(loadSettings({ getItem: () => 'nope' })).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings({ getItem: () => '{"preset":"sharp"}' }).preset).toBe('sharp')
  })
})
