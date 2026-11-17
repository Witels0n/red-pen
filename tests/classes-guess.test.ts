import { describe, expect, it } from 'vitest'
import { columnLetter, guessColumns } from '../src/shared/classes/guess-columns'

describe('guessColumns', () => {
  it('finds first name then surname, and an ID column', () => {
    expect(
      guessColumns([
        ['Learner no', 'Surname', 'First name', 'Gender'],
        ['1', 'Mokoena', 'Thandi', 'F'],
      ]),
    ).toEqual({
      headerRow: true,
      nameColumns: [2, 1],
      idColumn: 0,
    })
  })

  it('reads its own class files', () => {
    expect(
      guessColumns([
        ['Learner ID', 'Name'],
        ['01', 'Ann'],
      ]),
    ).toEqual({ headerRow: true, nameColumns: [1], idColumn: 0 })
  })

  it('with no titles, takes the first column of words', () => {
    expect(
      guessColumns([
        ['1', 'Thandi Mokoena'],
        ['2', 'Sipho'],
      ]),
    ).toEqual({ headerRow: false, nameColumns: [1] })
  })

  it('with unknown titles, takes the first column', () => {
    expect(
      guessColumns([
        ['Learner', 'Class'],
        ['Ann', '8A'],
      ]),
    ).toEqual({ headerRow: true, nameColumns: [0] })
  })
})

describe('columnLetter', () => {
  it('counts like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })
})
