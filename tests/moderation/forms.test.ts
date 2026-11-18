import { describe, expect, it } from 'vitest'
import {
  FORMS,
  J1_SECTIONS,
  J2_SECTIONS,
  commentKey,
  formFileName,
  freshValues,
  parseSavedForms,
  parseValues,
  showDate,
  upsertForm,
} from '../../src/moderation/core/forms'

describe('the wording of the forms', () => {
  it('has the sections of the official J1 and J2', () => {
    expect(J1_SECTIONS.map((s) => [s.title, s.rows.length])).toEqual([
      ['1. TECHNICAL CRITERIA', 6],
      ['2. CONTENT COVERAGE AND COGNITIVE DEMANDS', 7],
      ['3. MARKING GUIDELINE', 2],
      ['4. LANGUAGE', 3],
    ])
    expect(J2_SECTIONS.map((s) => [s.title, s.rows.length])).toEqual([
      ['TECHNICAL ASPECTS', 7],
      ['STANDARD OF THE TEST', 5],
      ['MARKING', 9],
      ['RECORDING', 3],
      ['LEARNER PERFORMANCE', 5],
      ['SCHOOL BASED MODERATION', 6],
      ['COMPUTER GENERATED MARKSHEETS (For last phase of moderation)', 3],
    ])
    expect(J2_SECTIONS[0]!.rows[0]!.no).toBe('1.')
    expect(J1_SECTIONS[0]!.rows.map((r) => r.no)).toEqual(['1.1', '1.2', '1.3', '1.4', '', ''])
  })

  it('has no em dashes', () => {
    expect(JSON.stringify([FORMS, J1_SECTIONS, J2_SECTIONS])).not.toContain('—')
  })

  it('keys comments by section and row, from 1', () => {
    expect(commentKey(0, 0)).toBe('c1.1')
    expect(commentKey(3, 2)).toBe('c4.3')
  })
})

describe('showDate', () => {
  it('writes a date out, in full or short', () => {
    expect(showDate('2026-11-18')).toBe('18 November 2026')
    expect(showDate('2026-02-03', true)).toBe('3 Feb 2026')
  })

  it('leaves anything else as typed', () => {
    expect(showDate('next week')).toBe('next week')
    expect(showDate('2026-13-01')).toBe('2026-13-01')
    expect(showDate(undefined)).toBe('')
  })
})

describe('formFileName', () => {
  it('joins the parts that are there and drops characters a file name cannot have', () => {
    expect(formFileName(FORMS.j1, ['Mathematics', '', 'Gr 10: Term 2/test'])).toBe(
      'J1 Pre-moderation - Mathematics - Gr 10 Term 2 test.pdf',
    )
    expect(formFileName(FORMS.j3, [undefined, ' '])).toBe('J3 Evidence of moderation.pdf')
  })
})

describe('saving', () => {
  it('keeps only short strings', () => {
    expect(parseValues({ school: 'A', empty: '', n: 4, list: ['x'], long: 'y'.repeat(3000) })).toEqual({
      school: 'A',
      long: 'y'.repeat(2000),
    })
    expect(parseValues(['a'])).toEqual({})
    expect(parseValues(null)).toEqual({})
  })

  it('starts a fresh form with the shared details only', () => {
    expect(freshValues({ school: 'A', subject: 'IT', 'c1.1': 'old comment', task: 'old task' })).toEqual({
      school: 'A',
      subject: 'IT',
    })
  })

  it('keeps saved forms newest first, one per name', () => {
    const a = { name: 'Test 1', savedAt: 1, values: { school: 'A' } }
    const b = { name: 'test 1 ', savedAt: 2, values: { school: 'B' } }
    expect(upsertForm([a], b)).toEqual([b])
    expect(parseSavedForms([a, { name: '', values: {} }, 7, { name: 'X', values: 'bad' }])).toEqual([
      a,
      { name: 'X', savedAt: 0, values: {} },
    ])
    expect(parseSavedForms('nothing')).toEqual([])
  })
})
