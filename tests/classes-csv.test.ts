import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv, writeCsv } from '../src/shared/classes/csv'

describe('parseCsv', () => {
  it('splits plain rows and fields', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('ignores one line break at the very end', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads CRLF, LF and lone CR line ends', () => {
    expect(parseCsv('a\r\nb\nc\rd')).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('keeps commas, line breaks and doubled quotes inside quotes', () => {
    expect(parseCsv('"Mokoena, Thandi","line one\r\nline two","say ""hi"""\r\nx,y,z')).toEqual([
      ['Mokoena, Thandi', 'line one\r\nline two', 'say "hi"'],
      ['x', 'y', 'z'],
    ])
  })

  it('reads empty fields, including quoted ones and a trailing one', () => {
    expect(parseCsv('a,,""\n,b,')).toEqual([
      ['a', '', ''],
      ['', 'b', ''],
    ])
  })

  it('keeps an empty line in the middle as a row with one empty field', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']])
  })

  it('strips a byte order mark', () => {
    expect(parseCsv('﻿Learner ID,Name\n01,Ann')).toEqual([
      ['Learner ID', 'Name'],
      ['01', 'Ann'],
    ])
  })

  it('detects semicolon-separated files (Excel with a decimal comma)', () => {
    expect(parseCsv('Surname;First name;Mark\r\nMokoena;Thandi;7,5\r\n')).toEqual([
      ['Surname', 'First name', 'Mark'],
      ['Mokoena', 'Thandi', '7,5'],
    ])
  })

  it('detects tab-separated text', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('uses a given delimiter instead of detecting one', () => {
    expect(parseCsv('a;b,c', { delimiter: ',' })).toEqual([['a;b', 'c']])
  })

  it('is lenient with broken quoting', () => {
    expect(parseCsv('ab"c,d')).toEqual([['ab"c', 'd']])
    expect(parseCsv('"open,ended\nstill')).toEqual([['open,ended\nstill']])
  })

  it('returns no rows for empty text', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('﻿')).toEqual([])
  })
})

describe('detectDelimiter', () => {
  it('only counts delimiters outside quotes on the first line', () => {
    expect(detectDelimiter('"a;b;c",d\n;;;;;')).toBe(',')
    expect(detectDelimiter('a;b,c;d')).toBe(';')
    expect(detectDelimiter('just one column')).toBe(',')
  })
})

describe('writeCsv', () => {
  it('quotes only what needs it and round-trips', () => {
    const rows = [
      ['Learner ID', 'Name'],
      ['01', 'Mokoena, Thandi'],
      ['02', 'Sipho "Spoon" Dlamini'],
      ['03', ''],
      ['04', ' padded '],
    ]
    const text = writeCsv(rows)
    expect(text).toBe(
      'Learner ID,Name\r\n01,"Mokoena, Thandi"\r\n02,"Sipho ""Spoon"" Dlamini"\r\n03,\r\n04," padded "\r\n',
    )
    expect(parseCsv(text)).toEqual(rows)
  })
})
