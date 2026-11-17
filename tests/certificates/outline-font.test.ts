import { describe, expect, it } from 'vitest'
import { FontError, OutlineFont } from '../../src/certificates/font/outline-font'
import { testFonts } from './fonts'

const { script, sans } = testFonts

describe('OutlineFont', () => {
  it('reads metrics and maps characters to glyphs', () => {
    expect(sans.unitsPerEm).toBeGreaterThan(0)
    expect(sans.glyphIndex('A'.codePointAt(0)!)).toBeGreaterThan(0)
    expect(sans.has('é'.codePointAt(0)!)).toBe(true)
  })

  it('measures text in proportion to the font size', () => {
    const w = sans.widthOf('Thandi Mokoena', 20)
    expect(w).toBeGreaterThan(50)
    expect(sans.widthOf('Thandi Mokoena', 40)).toBeCloseTo(w * 2, 5)
    expect(sans.widthOf('', 20)).toBe(0)
  })

  it('draws glyphs as closed SVG paths', () => {
    const path = script.svgPath('Ayesha', 30)
    expect(path.startsWith('M')).toBe(true)
    expect(path).toContain('C')
    expect(path.endsWith('Z')).toBe(true)
    expect(path).not.toMatch(/NaN/)
    expect(script.svgPath(' ', 30)).toBe('')
  })

  it('keeps accents it has and drops characters it cannot draw', () => {
    expect(sans.encodable('Zoë')).toBe('Zoë')
    expect(sans.encodable('a\u0007b')).toBe('ab')
  })

  it('refuses a file that is not a WOFF font', () => {
    expect(() => new OutlineFont(new Uint8Array(64))).toThrow(FontError)
  })
})
