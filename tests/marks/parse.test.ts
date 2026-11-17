import { describe, expect, it } from 'vitest'
import {
  detectLayout,
  parseHeading,
  parsePasted,
  readCell,
  readColumn,
  splitTable,
  toPasteText,
} from '../../src/marks/core/parse'

describe('readCell', () => {
  it('reads marks with a decimal point or comma', () => {
    expect(readCell('34')).toEqual({ kind: 'number', value: 34 })
    expect(readCell('34.5')).toEqual({ kind: 'number', value: 34.5 })
    expect(readCell(' 34,5 ')).toEqual({ kind: 'number', value: 34.5 })
  })

  it('reads fractions and percentages', () => {
    expect(readCell('34/50')).toEqual({ kind: 'fraction', score: 34, outOf: 50 })
    expect(readCell('34 / 50')).toEqual({ kind: 'fraction', score: 34, outOf: 50 })
    expect(readCell('68%')).toEqual({ kind: 'percent', value: 68 })
    expect(readCell('68,5 %')).toEqual({ kind: 'percent', value: 68.5 })
  })

  it('treats blanks and absence words as absent, in any case', () => {
    for (const s of ['', '  ', 'ABS', 'abs', 'A', 'ab', '-', 'x', 'X']) expect(readCell(s).kind).toBe('absent')
  })

  it('treats words as text', () => {
    expect(readCell('sick').kind).toBe('text')
    expect(readCell('3a').kind).toBe('text')
  })
})

describe('parseHeading', () => {
  it('reads an out of in brackets, after a slash or after a spaced dash', () => {
    expect(parseHeading('Test 1 (40)')).toEqual({ name: 'Test 1', outOf: 40, calculated: false, percent: false })
    expect(parseHeading('Test 1 /40')).toEqual({ name: 'Test 1', outOf: 40, calculated: false, percent: false })
    expect(parseHeading('Test 1/40').outOf).toBe(40)
    expect(parseHeading('Test 1 - 40')).toEqual({ name: 'Test 1', outOf: 40, calculated: false, percent: false })
    expect(parseHeading('Essay (out of 25)').outOf).toBe(25)
  })

  it('reads (%) or a trailing % as percentages', () => {
    expect(parseHeading('June exam (%)')).toEqual({ name: 'June exam', outOf: null, calculated: false, percent: true })
    expect(parseHeading('June exam %').percent).toBe(true)
    expect(readColumn('June (%)', ['45']).outOfSource).toBe('heading')
  })

  it('leaves headings without a total alone', () => {
    expect(parseHeading('Test 1')).toEqual({ name: 'Test 1', outOf: null, calculated: false, percent: false })
    expect(parseHeading('Grade 8-2').outOf).toBeNull()
  })

  it('tags Average, Avg, Total and Term mark as calculated', () => {
    for (const h of ['Average', 'Term 1 avg', 'Total (100)', 'Term mark']) expect(parseHeading(h).calculated).toBe(true)
    expect(parseHeading('Totally new test').calculated).toBe(false)
  })
})

describe('parsePasted', () => {
  it('splits Excel pastes on tabs', () => {
    expect(parsePasted('Name\tTest 1\nThandi Mokoena\t34,5\n')).toEqual([
      ['Name', 'Test 1'],
      ['Thandi Mokoena', '34,5'],
    ])
  })

  it('keeps a column of decimal commas as one column', () => {
    expect(parsePasted('34,5\n40\n12,25')).toEqual([['34,5'], ['40'], ['12,25']])
  })

  it('splits comma and semicolon lists', () => {
    expect(parsePasted('Name,Test\nSipho,40')).toEqual([
      ['Name', 'Test'],
      ['Sipho', '40'],
    ])
    expect(parsePasted('Sipho;34,5')).toEqual([['Sipho', '34,5']])
  })

  it('round-trips through the paste text', () => {
    const rows = [
      ['Name', 'Test 1'],
      ['Ayesha Patel', '45'],
    ]
    expect(parsePasted(toPasteText(rows))).toEqual(rows)
  })
})

describe('detectLayout', () => {
  it('finds headings and a names column', () => {
    expect(
      detectLayout([
        ['Name', 'Test 1', 'Test 2'],
        ['Thandi', '34', '40'],
        ['Sipho', 'ABS', '22'],
      ]),
    ).toEqual({ headerRow: true, namesColumn: true })
  })

  it('finds neither in a block of numbers', () => {
    expect(
      detectLayout([
        ['34', '40'],
        ['12', 'ABS'],
      ]),
    ).toEqual({ headerRow: false, namesColumn: false })
  })

  it('finds names without headings', () => {
    expect(
      detectLayout([
        ['Thandi', '34'],
        ['Sipho', '22'],
      ]),
    ).toEqual({ headerRow: false, namesColumn: true })
  })
})

describe('splitTable', () => {
  it('names columns, keeps row numbers and skips empty rows', () => {
    const t = splitTable(
      [
        ['Name', 'Test 1', ''],
        ['Thandi', '34', '1'],
        ['', '', ''],
        ['Sipho', '22', '2'],
      ],
      { headerRow: true, namesColumn: true },
    )
    expect(t.names).toEqual(['Thandi', 'Sipho'])
    expect(t.rowNumbers).toEqual([2, 4])
    expect(t.columns.map((c) => c.heading)).toEqual(['Test 1', 'Assessment 2'])
    expect(t.columns[0].cells).toEqual(['34', '22'])
  })
})

describe('readColumn', () => {
  it('uses the out of in the heading', () => {
    const c = readColumn('Test 1 (40)', ['20', '40', '30/50', '68%'])
    expect(c.outOf).toBe(40)
    expect(c.outOfSource).toBe('heading')
    expect(c.cells.map((x) => x.percent)).toEqual([50, 100, 60, 68])
  })

  it('assumes percentages when every value is 0 to 100 and there is no total', () => {
    const c = readColumn('Test', ['45', '100', '0'])
    expect(c.outOfSource).toBe('assumed')
    expect(c.outOf).toBeNull()
    expect(c.analysed).toBe(true)
    expect(c.cells.map((x) => x.percent)).toEqual([45, 100, 0])
  })

  it('waits for an out of when a value is above 100', () => {
    const c = readColumn('Test', ['45', '120', 'oops'])
    expect(c.outOfSource).toBe('missing')
    expect(c.analysed).toBe(false)
    expect(c.cells.map((x) => x.percent)).toEqual([null, null, null])
    expect(c.counts.unreadable).toBe(1)
    const fixed = readColumn('Test', ['45', '120', 'oops'], { outOf: 150 })
    expect(fixed.analysed).toBe(true)
    expect(fixed.cells[1].percent).toBe(80)
  })

  it('takes the teacher out of over the heading, and null as percentages', () => {
    expect(readColumn('Test (40)', ['20'], { outOf: 50 }).cells[0].percent).toBe(40)
    expect(readColumn('Test (40)', ['20'], { outOf: null }).cells[0].percent).toBe(20)
  })

  it('counts absent and unreadable cells and leaves them out', () => {
    const c = readColumn('Test (40)', ['ABS', '', '-3', '41', '30/20', 'sick', '20'])
    expect(c.counts).toEqual({ marks: 1, absent: 2, unreadable: 4 })
    expect(c.cells.map((x) => x.reason ?? null)).toEqual([
      null,
      null,
      'negative',
      'more than 40',
      'more than 20',
      'not a mark',
      null,
    ])
  })

  it('needs no prompt when every cell carries its own total', () => {
    expect(readColumn('Test', ['3/4', '50%']).outOfSource).toBe('cells')
  })

  it('uses the teacher name when given', () => {
    expect(readColumn('Test 1 (40)', [], { name: ' June exam ' }).name).toBe('June exam')
  })
})
