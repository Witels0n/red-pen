import { describe, expect, it } from 'vitest'
import { newClassList } from '../../src/shared/classes/class-list'
import { assessmentFromFile, assessmentToFile } from '../../src/mcq/core/assessment-file'
import { activeLearnerList, listFromCount, listFromNames, listFromRows, rosterFor } from '../../src/mcq/core/learners'
import { collate, markAll } from '../../src/mcq/core/marking'
import { marksheetRows } from '../../src/mcq/core/marksheet'
import type { Assessment, LearnerList } from '../../src/mcq/core/model'
import { printRun } from '../../src/mcq/core/sheets'
import { assessment, memoAnswers, pagesFor } from './fixtures'

function withList(list: LearnerList, mode: Assessment['print']['mode'] = 'named-qr'): Assessment {
  const a = assessment(6)
  return { ...a, learnerList: list, print: { ...a.print, mode, learnerSource: list.source, spares: 0 } }
}

describe('Learner lists from each source', () => {
  it('pasted names: one per line, blank lines skipped, IDs 1, 2, 3... with digits that fit', () => {
    const five = listFromNames('Thandi Mokoena\n\n  Sipho   Dlamini \nAyesha Patel\nLerato\tKhumalo\nPieter')
    expect(five.problems).toEqual([])
    expect(five.list).toEqual({
      source: 'pasted',
      idDigits: 1,
      learners: [
        { id: '1', name: 'Thandi Mokoena' },
        { id: '2', name: 'Sipho Dlamini' },
        { id: '3', name: 'Ayesha Patel' },
        { id: '4', name: 'Lerato Khumalo' },
        { id: '5', name: 'Pieter' },
      ],
    })
    const twelve = listFromNames(Array.from({ length: 12 }, (_, i) => `Learner ${i + 1}`).join('\n'))
    expect(twelve.list?.idDigits).toBe(2)
    expect(twelve.list?.learners.at(-1)).toEqual({ id: '12', name: 'Learner 12' })
    expect(listFromNames('  \n ').list).toBeNull()
  })

  it('numbers only: IDs 1 to N with no names', () => {
    const draft = listFromCount(120)
    expect(draft.list?.idDigits).toBe(3)
    expect(draft.list?.learners[0]).toEqual({ id: '001' })
    expect(draft.list?.learners).toHaveLength(120)
    expect(listFromCount(0).problems).toEqual(['Enter how many learners, 1 or more.'])
    expect(listFromCount(10_000).problems[0]).toMatch(/more than a list can hold/)
  })

  it('an imported file: name columns in order, an optional ID column, and row problems listed', () => {
    const rows = [
      ['No.', 'Surname', 'First name'],
      ['7', 'Mokoena', 'Thandi'],
      ['12', 'Dlamini', 'Sipho'],
      ['12', 'Patel', 'Ayesha'],
      ['x', 'Khumalo', 'Lerato'],
      ['', '', ''],
    ]
    const numbered = listFromRows(rows, { headerRow: true, nameColumns: [2, 1] }, 'Grade 7B.xlsx')
    expect(numbered.problems).toEqual([])
    expect(numbered.list).toMatchObject({ source: 'imported', idDigits: 1, fileName: 'Grade 7B.xlsx' })
    expect(numbered.list?.learners.map((l) => `${l.id} ${l.name}`)).toEqual([
      '1 Thandi Mokoena',
      '2 Sipho Dlamini',
      '3 Ayesha Patel',
      '4 Lerato Khumalo',
    ])
    const kept = listFromRows(rows, { headerRow: true, nameColumns: [2, 1], idColumn: 0 })
    expect(kept.list?.idDigits).toBe(2)
    expect(kept.list?.learners).toEqual([
      { id: '07', name: 'Thandi Mokoena' },
      { id: '12', name: 'Sipho Dlamini' },
    ])
    expect(kept.problems).toEqual(['Row 4: Learner ID 12 is also on row 3.', 'Row 5: "x" is not a number.'])
    expect(listFromRows(rows, { headerRow: true, nameColumns: [] }).problems).toEqual([
      'Tick at least one name column, or choose an ID column.',
    ])
  })
})

describe('using a Learner list like a Class list', () => {
  const pasted = listFromNames('Thandi Mokoena\nSipho Dlamini\nAyesha Patel').list!

  it('prints a named sheet per learner without a saved Class list', () => {
    const a = withList(pasted)
    const roster = rosterFor(a, null)
    expect(roster?.learners).toEqual(pasted.learners)
    const run = printRun(a, roster)
    expect(run.specs.map((s) => [s.identity.learnerId, s.identity.learnerName, s.identity.idDigits])).toEqual([
      ['1', 'Thandi Mokoena', 1],
      ['2', 'Sipho Dlamini', 1],
      ['3', 'Ayesha Patel', 1],
    ])
  })

  it('marks against the list and gives names in the results', () => {
    const a = withList(pasted, 'id-qr')
    const roster = rosterFor(a, null)!
    const scans = [...pagesFor(a, '2', 'A', memoAnswers(a)), ...pagesFor(a, '9', 'A', memoAnswers(a))]
    const collation = collate({ ...a, scans }, new Set(roster.learners.map((l) => l.id)))
    // A Learner ID that is not on the list goes to Review.
    expect(collation.review).toEqual([
      expect.objectContaining({ kind: 'identity', reason: 'not-on-list', readId: '9' }),
    ])
    const names = new Map(roster.learners.flatMap((l) => (l.name ? [[l.id, l.name] as const] : [])))
    const rows = marksheetRows(a, markAll(a, collation.learners), names)
    expect(rows.find((r) => r.learnerId === '2')?.name).toBe('Sipho Dlamini')
  })

  it('gives names to Bubbled IDs when a list is there, and works with no list at all', () => {
    const bubbled = withList(pasted, 'bubbled-id')
    expect(rosterFor(bubbled, null)?.learners).toHaveLength(3)
    const none = { ...bubbled, print: { ...bubbled.print, learnerSource: 'none' as const, copies: 4 } }
    expect(rosterFor(none, null)).toBeNull()
    expect(printRun(none, null).specs).toHaveLength(4)
  })

  it('uses the source the sheets were printed from: a saved Class list only when that is the source', () => {
    const saved = newClassList('Grade 7B', 2, [{ id: '01', name: 'Somebody Else' }])
    const a = withList(pasted)
    expect(rosterFor({ ...a, print: { ...a.print, classId: saved.id } }, saved)?.learners).toEqual(pasted.learners)
    const fromClass = { ...a, print: { ...a.print, learnerSource: 'class' as const, classId: saved.id } }
    expect(rosterFor(fromClass, saved)?.learners).toEqual(saved.learners)
    // A list from another source is kept but not used.
    const numbers = { ...a, print: { ...a.print, learnerSource: 'numbers' as const } }
    expect(activeLearnerList(numbers)).toBeNull()
    expect(rosterFor(numbers, null)).toBeNull()
  })
})

describe('Learner lists in the Assessment file', () => {
  it('round-trip with the names', () => {
    const a = withList(listFromNames('Thandi Mokoena\nSipho Dlamini').list!)
    expect(assessmentFromFile(assessmentToFile(a))).toEqual({ ok: true, assessment: a })
    const numbers = withList(listFromCount(3).list!)
    expect(assessmentFromFile(assessmentToFile(numbers))).toEqual({ ok: true, assessment: numbers })
  })

  it('are checked: Learner IDs of the right digits, each used once', () => {
    const a = withList({
      source: 'pasted',
      idDigits: 2,
      learners: [{ id: '01', name: 'A' }, { id: '1' }, { id: '01' }],
    })
    const back = assessmentFromFile(assessmentToFile(a))
    expect(back.ok).toBe(false)
    if (back.ok) return
    expect(back.problems).toEqual([
      'This Assessment file has problems:',
      'Learner 2 in the Learner list: id must be a Learner ID of 2 digits.',
      'Learner 3 in the Learner list: id is used twice (01).',
    ])
  })
})
