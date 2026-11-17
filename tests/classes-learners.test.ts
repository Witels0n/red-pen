import { describe, expect, it } from 'vitest'
import { buildLearners, numberedLearners, rowsFromNames } from '../src/shared/classes/build-learners'
import {
  addLearner,
  changeIdDigits,
  classListProblems,
  duplicateClassList,
  moveLearner,
  newClassList,
  nextLearnerId,
  removeLearner,
  renameLearner,
  sortByName,
} from '../src/shared/classes/class-list'
import { classFileName, classFromCsv, classToCsv } from '../src/shared/classes/class-csv'
import { digitsNeeded, formatLearnerId, learnerNumber, maxLearnerNumber } from '../src/shared/classes/types'

describe('Learner IDs', () => {
  it('pads to the digit count', () => {
    expect(formatLearnerId(7, 1)).toBe('7')
    expect(formatLearnerId(7, 3)).toBe('007')
    expect(formatLearnerId(9999, 4)).toBe('9999')
  })

  it('refuses IDs that do not fit, are not whole or are below 1', () => {
    expect(() => formatLearnerId(10, 1)).toThrow(RangeError)
    expect(() => formatLearnerId(0, 2)).toThrow(RangeError)
    expect(() => formatLearnerId(1.5, 2)).toThrow(RangeError)
    expect(() => formatLearnerId(1, 5)).toThrow(RangeError)
    expect(() => formatLearnerId(1, 0)).toThrow(RangeError)
  })

  it('reads IDs back and knows the limits', () => {
    expect(learnerNumber(' 007 ')).toBe(7)
    expect(learnerNumber('7a')).toBeNull()
    expect(learnerNumber('')).toBeNull()
    expect(maxLearnerNumber(2)).toBe(99)
    expect(digitsNeeded(0)).toBe(1)
    expect(digitsNeeded(120)).toBe(3)
  })
})

const roster = [
  ['First name', 'Surname', 'Number'],
  ['  Thandi ', 'Mokoena', '3'],
  ['', '', ''],
  ['Sipho', '  van  der Merwe', '12'],
  ['Ayesha', '', '007'],
]

describe('buildLearners', () => {
  it('joins name columns in the order given and numbers learners 1, 2, 3', () => {
    const r = buildLearners(roster, { headerRow: true, nameColumns: [1, 0], idDigits: 2 })
    expect(r.problems).toEqual([])
    expect(r.learners).toEqual([
      { id: '01', name: 'Mokoena Thandi' },
      { id: '02', name: 'van der Merwe Sipho' },
      { id: '03', name: 'Ayesha' },
    ])
    expect(r.rows.map((x) => x.sourceRow)).toEqual([2, 4, 5])
  })

  it('treats row 1 as a learner when there is no header', () => {
    const r = buildLearners(roster, { headerRow: false, nameColumns: [0], idDigits: 1 })
    expect(r.learners[0]).toEqual({ id: '1', name: 'First name' })
    expect(r.learners).toHaveLength(4)
  })

  it('keeps imported IDs, padded to the digit count', () => {
    const r = buildLearners(roster, { headerRow: true, nameColumns: [0, 1], idColumn: 2, idDigits: 3 })
    expect(r.problems).toEqual([])
    expect(r.learners.map((l) => l.id)).toEqual(['003', '012', '007'])
  })

  it('reports IDs that are missing, not numbers, too long, zero or repeated, per row', () => {
    const rows = [
      ['Ann', '1'],
      ['Ben', ''],
      ['Cara', 'x9'],
      ['Dan', '100'],
      ['Eve', '0'],
      ['Fay', '01'],
      ['Gus', '2'],
    ]
    const r = buildLearners(rows, { headerRow: false, nameColumns: [0], idColumn: 1, idDigits: 2 })
    expect(r.problems).toEqual([
      'Row 2: No Learner ID.',
      'Row 3: "x9" is not a number.',
      'Row 4: 100 does not fit in 2 digits.',
      'Row 5: A Learner ID must be 1 or more.',
      'Row 6: Learner ID 01 is also on row 1.',
    ])
    expect(r.learners).toEqual([
      { id: '01', name: 'Ann' },
      { id: '02', name: 'Gus' },
    ])
    expect(r.rows.find((x) => x.sourceRow === 4)).toMatchObject({ id: '100', problems: ['100 does not fit in 2 digits.'] })
  })

  it('keeps an ID with no name, and skips rows with neither', () => {
    const r = buildLearners(
      [
        ['', '4'],
        ['', ''],
      ],
      { headerRow: false, nameColumns: [0], idColumn: 1, idDigits: 1 },
    )
    expect(r.learners).toEqual([{ id: '4' }])
  })

  it('reports when there are more learners than the digits allow', () => {
    const rows = Array.from({ length: 11 }, (_, i) => [`L${i}`])
    const r = buildLearners(rows, { headerRow: false, nameColumns: [0], idDigits: 1 })
    expect(r.learners).toHaveLength(9)
    expect(r.problems).toEqual(['Row 10: Too many learners for 1-digit IDs (the most is 9).', 'Row 11: Too many learners for 1-digit IDs (the most is 9).'])
  })

  it('handles short rows and a custom joiner', () => {
    const r = buildLearners([['Ann']], { headerRow: false, nameColumns: [0, 3], idDigits: 2, joiner: ', ' })
    expect(r.learners).toEqual([{ id: '01', name: 'Ann' }])
    const s = buildLearners([['Ann', 'Lee']], { headerRow: false, nameColumns: [1, 0], idDigits: 2, joiner: ', ' })
    expect(s.learners[0].name).toBe('Lee, Ann')
  })
})

describe('rowsFromNames and numberedLearners', () => {
  it('takes one name per line and joins pasted spreadsheet cells', () => {
    const rows = rowsFromNames('Thandi Mokoena\r\n\n  Sipho\tDlamini \n')
    const r = buildLearners(rows, { headerRow: false, nameColumns: [0], idDigits: 2 })
    expect(r.learners).toEqual([
      { id: '01', name: 'Thandi Mokoena' },
      { id: '02', name: 'Sipho Dlamini' },
    ])
  })

  it('makes a numbers-only class', () => {
    expect(numberedLearners(3, 2)).toEqual([{ id: '01' }, { id: '02' }, { id: '03' }])
  })
})

describe('editing a Class list', () => {
  const base = () => newClassList(' Grade 8A ', 2, [{ id: '01', name: 'Zola' }, { id: '03' }, { id: '02', name: 'ann' }], 1000)

  it('makes a new list with an id and times', () => {
    const list = base()
    expect(list.name).toBe('Grade 8A')
    expect(list.id).toMatch(/^[0-9a-f-]{16,}$/)
    expect(list.createdAt).toBe(1000)
    expect(classListProblems(list)).toEqual([])
  })

  it('adds with the next free ID, never reusing a higher one', () => {
    const list = addLearner(base(), '  New   Learner ')
    expect(list.learners.at(-1)).toEqual({ id: '04', name: 'New Learner' })
    expect(nextLearnerId(removeLearner(list, '04'))).toBe('04')
    const full = newClassList('Full', 1, numberedLearners(9, 1))
    expect(nextLearnerId(full)).toBeNull()
    expect(addLearner(full)).toBe(full)
  })

  it('renames, clears a name, removes and moves', () => {
    let list = renameLearner(base(), '03', 'Bongi')
    expect(list.learners[1]).toEqual({ id: '03', name: 'Bongi' })
    list = renameLearner(list, '03', '   ')
    expect(list.learners[1]).toEqual({ id: '03' })
    list = moveLearner(list, 0, 2)
    expect(list.learners.map((l) => l.id)).toEqual(['03', '02', '01'])
    expect(moveLearner(list, 0, 9)).toBe(list)
    expect(removeLearner(list, '02').learners.map((l) => l.id)).toEqual(['03', '01'])
  })

  it('sorts by name, ignoring case, with unnamed learners last; IDs stay', () => {
    expect(sortByName(base()).learners).toEqual([{ id: '02', name: 'ann' }, { id: '01', name: 'Zola' }, { id: '03' }])
  })

  it('re-pads IDs when the digit count changes, and refuses when they would not fit', () => {
    const wider = changeIdDigits(base(), 4)
    expect(wider.ok && wider.list.learners.map((l) => l.id)).toEqual(['0001', '0003', '0002'])
    const narrower = changeIdDigits(base(), 1)
    expect(narrower.ok && narrower.list.idDigits).toBe(1)
    const big = newClassList('Big', 2, [{ id: '05' }, { id: '42' }])
    expect(changeIdDigits(big, 1)).toEqual({ ok: false, tooLong: ['42'] })
  })

  it('duplicates with a new id and name', () => {
    const list = base()
    const copy = duplicateClassList(list, 2000)
    expect(copy.id).not.toBe(list.id)
    expect(copy.name).toBe('Grade 8A (copy)')
    expect(copy.learners).toEqual(list.learners)
    expect(copy.learners).not.toBe(list.learners)
  })

  it('finds problems that would stop a save', () => {
    const list = base()
    expect(classListProblems({ ...list, idDigits: 5 })).toEqual(['Learner IDs must have 1 to 4 digits.'])
    expect(classListProblems({ ...list, name: ' ', learners: [{ id: '1' }, { id: '02' }, { id: '02' }] })).toEqual([
      'The class needs a name.',
      '"1" is not a 2-digit Learner ID.',
      'Learner ID 02 is used twice.',
    ])
  })
})

describe('class files (CSV)', () => {
  it('round-trips a Class list through its CSV', () => {
    const list = newClassList('Grade 8A', 3, [{ id: '001', name: 'Mokoena, Thandi' }, { id: '002' }, { id: '010', name: 'Sipho' }])
    const csv = classToCsv(list)
    expect(csv.startsWith('﻿Learner ID,Name\r\n001,"Mokoena, Thandi"\r\n002,\r\n')).toBe(true)
    expect(classFromCsv(csv)).toEqual({ learners: list.learners, idDigits: 3, problems: [] })
  })

  it('reads a class file Excel saved with semicolons and stripped zeros', () => {
    const r = classFromCsv('Learner ID;Name\r\n1;Ann\r\n12;Ben\r\n')
    expect(r).toEqual({ learners: [{ id: '01', name: 'Ann' }, { id: '12', name: 'Ben' }], idDigits: 2, problems: [] })
  })

  it('rejects other CSV files and reports bad rows', () => {
    expect(classFromCsv('Name,Surname\nAnn,Lee').problems).toEqual(['This is not a class file: the first column must be "Learner ID".'])
    expect(classFromCsv('Learner ID,Name\n1,Ann\n1,Ben').problems).toEqual(['Row 3: Learner ID 1 is also on row 2.'])
    expect(classFromCsv('Learner ID,Name\n').problems).toEqual(['The class file has no learners.'])
    expect(classFromCsv('Learner ID,Name\n12345,Ann').problems).toEqual(['Row 2: 12345 does not fit in 4 digits.'])
  })

  it('names the file after the class', () => {
    expect(classFileName(newClassList('Grade 8A / Maths: Term 1', 2, []))).toBe('Grade 8A Maths Term 1.csv')
    expect(classFileName(newClassList('???', 2, []))).toBe('class.csv')
  })
})
