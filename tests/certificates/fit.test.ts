import { describe, expect, it } from 'vitest'
import { fitBlock, fitName, fitSize, truncate, wrapLines, type Measure } from '../../src/certificates/fit'
import { testFonts } from './fonts'

/** Every character is half the font size wide, so widths are easy to work out. */
const mono: Measure = { widthOf: (t, size) => t.length * size * 0.5 }

describe('fitSize', () => {
  it('keeps the largest size when the text fits', () => {
    expect(fitSize(mono, 'Thandi', 40, 200)).toBe(40) // 120 wide
  })

  it('shrinks a long name to fit, in half points', () => {
    const size = fitSize(mono, 'Bartholomew Montgomery', 40, 200) // 22 characters: 440 wide at 40
    expect(size).toBe(18)
    expect(mono.widthOf('Bartholomew Montgomery', size)).toBeLessThanOrEqual(200)
  })

  it('never goes below the smallest size', () => {
    expect(fitSize(mono, 'x'.repeat(500), 40, 100, 8)).toBe(8)
  })

  it('works with a real font', () => {
    const font = testFonts.script
    const name = 'Bartholomew Montgomery-Featherstonehaugh'
    const size = fitSize(font, name, 66, 500)
    expect(size).toBeLessThan(66)
    expect(font.widthOf(name, size)).toBeLessThanOrEqual(500)
    expect(font.widthOf(name, size + 1)).toBeGreaterThan(500)
  })
})

describe('fitName', () => {
  it('keeps a short name on one line', () => {
    expect(fitName(mono, 'Mia van Wyk', 40, 400)).toEqual({ lines: ['Mia van Wyk'], size: 40 })
  })

  it('breaks a long name over two balanced lines when that makes it much larger', () => {
    const fitted = fitName(mono, 'Bartholomew Montgomery Featherstonehaugh', 60, 300)
    expect(fitted.lines).toEqual(['Bartholomew Montgomery', 'Featherstonehaugh'])
    expect(fitted.size).toBeGreaterThan(fitSize(mono, 'Bartholomew Montgomery Featherstonehaugh', 60, 300) * 1.25)
  })

  it('stays on one line when the box is too short for two', () => {
    expect(fitName(mono, 'Bartholomew Montgomery Featherstonehaugh', 60, 300, 20).lines).toHaveLength(1)
  })
})

describe('wrapping', () => {
  it('wraps at spaces and keeps line breaks', () => {
    expect(wrapLines(mono, 'one two three\nfour', 10, 40)).toEqual(['one two', 'three', 'four']) // 8 characters a line
  })

  it('cuts a word that is wider than the line', () => {
    expect(truncate(mono, 'Featherstonehaugh', 10, 50)).toBe('Feather...')
    expect(wrapLines(mono, 'Featherstonehaugh', 10, 50)).toEqual(['Feather...'])
  })

  it('shrinks a block until its lines fit the box', () => {
    const text = 'for outstanding effort and achievement in Mathematics this term'
    const block = fitBlock(mono, text, { width: 200, height: 60 }, 20, 8)
    expect(block.size).toBeLessThan(20)
    expect(block.lines.length * block.lineHeight).toBeLessThanOrEqual(60)
    expect(block.lines.join(' ')).toBe(text)
  })

  it('drops lines that still do not fit at the smallest size, ending in an ellipsis', () => {
    const block = fitBlock(mono, 'word '.repeat(200), { width: 100, height: 30 }, 12, 10)
    expect(block.size).toBe(10)
    expect(block.lines).toHaveLength(2)
    expect(block.lines[1].endsWith('...')).toBe(true)
  })
})
