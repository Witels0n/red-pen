import { describe, expect, it } from 'vitest'
import { safeFileBase } from '../src/shared/pdf/file-names'
import {
  learnerFileBase,
  planCoverSplit,
  type CoverPlanClass,
  type CoverPlanResult,
  type ScannedPage,
} from '../src/split/cover-plan'

const P: ScannedPage = { kind: 'page' }
const U: ScannedPage = { kind: 'unreadable' }
const C = (learnerId: string): ScannedPage => ({ kind: 'cover', learnerId })

const grade8: CoverPlanClass = {
  name: 'Grade 8A',
  learners: [{ id: '01', name: 'Thandi Mokoena' }, { id: '02', name: 'Sipho Dlamini' }, { id: '03' }],
}

function ok(r: CoverPlanResult) {
  if (!r.ok) throw new Error(r.error)
  return r
}

/** [file name, first page, last page] per part. */
function summary(r: CoverPlanResult): [string, number, number][] {
  return ok(r).parts.map((p) => [p.fileName, p.start, p.end])
}

describe('planCoverSplit', () => {
  it('starts a part at each Cover sheet, with the cover as page 1', () => {
    const r = planCoverSplit({ pages: [C('01'), P, P, C('02'), P, C('03'), P, P, P], includeCovers: true })
    expect(summary(r)).toEqual([
      ['learner-01.pdf', 1, 3],
      ['learner-02.pdf', 4, 5],
      ['learner-03.pdf', 6, 9],
    ])
    expect(ok(r).warnings).toEqual([])
    expect(ok(r).parts.map((p) => [p.learnerId, p.coverPage, p.unassigned])).toEqual([
      ['01', 1, false],
      ['02', 4, false],
      ['03', 6, false],
    ])
  })

  it('leaves the Cover sheets out when asked', () => {
    const r = planCoverSplit({ pages: [C('01'), P, P, C('02'), P], includeCovers: false })
    expect(summary(r)).toEqual([
      ['learner-01.pdf', 2, 3],
      ['learner-02.pdf', 5, 5],
    ])
  })

  it('puts pages before the first Cover sheet in an unassigned part and says so', () => {
    const r = planCoverSplit({ pages: [P, P, C('01'), P], includeCovers: false })
    expect(summary(r)).toEqual([
      ['unassigned.pdf', 1, 2],
      ['learner-01.pdf', 4, 4],
    ])
    expect(ok(r).parts[0].unassigned).toBe(true)
    expect(ok(r).warnings).toEqual([
      "Pages 1-2 come before the first Cover sheet, so they are in unassigned.pdf. Check whether a learner's Cover sheet is missing.",
    ])
    const one = planCoverSplit({ pages: [P, C('01'), P], includeCovers: true })
    expect(ok(one).warnings[0]).toMatch(/^Page 1 comes before the first Cover sheet, so it is in unassigned\.pdf/)
  })

  it('handles a Cover sheet on the last page', () => {
    const kept = planCoverSplit({ pages: [C('01'), P, C('02')], includeCovers: true })
    expect(summary(kept)).toEqual([
      ['learner-01.pdf', 1, 2],
      ['learner-02.pdf', 3, 3],
    ])
    expect(ok(kept).warnings).toEqual([
      'Learner ID 02: the Cover sheet on page 3 has no pages after it, so the file holds only the Cover sheet.',
    ])

    const left = planCoverSplit({ pages: [C('01'), P, C('02')], includeCovers: false })
    expect(summary(left)).toEqual([['learner-01.pdf', 2, 2]])
    expect(ok(left).warnings).toEqual([
      'Learner ID 02: the Cover sheet on page 3 has no pages after it, so there is no file for it.',
    ])
  })

  it('handles two Cover sheets next to each other', () => {
    const r = planCoverSplit({ pages: [C('01'), C('02'), P], includeCovers: false })
    expect(summary(r)).toEqual([['learner-02.pdf', 3, 3]])
    expect(ok(r).warnings[0]).toMatch(/^Learner ID 01: the Cover sheet on page 1 has no pages after it/)
  })

  it('refuses a PDF without Cover sheets', () => {
    const r = planCoverSplit({ pages: [P, P, U], includeCovers: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^No Cover sheets were found in this PDF\./)
  })

  it('names parts after learners on the chosen Class list, matching by Learner ID', () => {
    const r = planCoverSplit({ pages: [C('02'), P, C('1'), P, C('03'), P], includeCovers: true, classList: grade8 })
    // "1" on an older Cover sheet still matches "01"; a learner without a name keeps the ID.
    expect(summary(r)).toEqual([
      ['Sipho Dlamini.pdf', 1, 2],
      ['Thandi Mokoena.pdf', 3, 4],
      ['learner-03.pdf', 5, 6],
    ])
    expect(ok(r).parts.map((p) => p.learnerName)).toEqual(['Sipho Dlamini', 'Thandi Mokoena', undefined])
    expect(ok(r).warnings).toEqual([])
  })

  it('names unknown Learner IDs by number and lists them', () => {
    const r = planCoverSplit({ pages: [C('01'), P, C('07'), P, C('12'), P], includeCovers: true, classList: grade8 })
    expect(summary(r).map((p) => p[0])).toEqual(['Thandi Mokoena.pdf', 'learner-07.pdf', 'learner-12.pdf'])
    expect(ok(r).warnings).toContain(
      'Learner IDs 07 and 12 are not on Grade 8A, so their files are named by Learner ID.',
    )
    const one = planCoverSplit({ pages: [C('01'), C('09'), P], includeCovers: true, classList: grade8 })
    expect(ok(one).warnings).toContain('Learner ID 09 is not on Grade 8A, so its file is named learner-09.pdf.')
  })

  it('lists learners on the Class list who have no Cover sheet in the scan', () => {
    const r = planCoverSplit({ pages: [C('01'), P], includeCovers: true, classList: grade8 })
    expect(ok(r).warnings).toEqual([
      '2 learners on Grade 8A have no Cover sheet in this scan: Sipho Dlamini (02) and 03.',
    ])
    // No match at all is a different class, not missing learners.
    const none = planCoverSplit({ pages: [C('55'), P], includeCovers: true, classList: grade8 })
    expect(ok(none).warnings.some((w) => w.includes('no Cover sheet'))).toBe(false)
  })

  it('numbers the files when a learner is scanned twice, and warns', () => {
    const r = planCoverSplit({
      pages: [C('01'), P, C('02'), P, C('01'), P, P],
      includeCovers: true,
      classList: grade8,
    })
    expect(summary(r)).toEqual([
      ['Thandi Mokoena-1.pdf', 1, 2],
      ['Sipho Dlamini.pdf', 3, 4],
      ['Thandi Mokoena-2.pdf', 5, 7],
    ])
    expect(ok(r).warnings).toContain(
      'Thandi Mokoena (Learner ID 01) has 2 Cover sheets, on pages 1 and 5. Each one starts a numbered file.',
    )
    const ids = planCoverSplit({ pages: [C('4'), P, C('4'), C('4'), P], includeCovers: true })
    expect(summary(ids).map((p) => p[0])).toEqual(['learner-4-1.pdf', 'learner-4-2.pdf', 'learner-4-3.pdf'])
    expect(ok(ids).warnings).toContain(
      'Learner ID 4 has 3 Cover sheets, on pages 1, 3 and 4. Each one starts a numbered file.',
    )
  })

  it('keeps file names distinct when two learners share a name, ignoring case', () => {
    const twins: CoverPlanClass = {
      name: 'Grade 9',
      learners: [
        { id: '1', name: 'Lee Smith' },
        { id: '2', name: 'LEE SMITH' },
        { id: '3', name: 'Lee Smith-1' },
      ],
    }
    const r = planCoverSplit({ pages: [C('1'), C('2'), C('3')], includeCovers: true, classList: twins })
    const names = summary(r).map((p) => p[0])
    expect(names).toEqual(['Lee Smith-2.pdf', 'LEE SMITH-3.pdf', 'Lee Smith-1.pdf'])
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3)
  })

  it('sanitises names into safe file names', () => {
    const odd: CoverPlanClass = {
      name: 'Grade 10',
      learners: [
        { id: '1', name: 'Zoë / "Zee" O\'Neil' },
        { id: '2', name: '...' },
        { id: '3', name: 'CON' },
      ],
    }
    const r = planCoverSplit({ pages: [C('1'), C('2'), C('3')], includeCovers: true, classList: odd })
    expect(summary(r).map((p) => p[0])).toEqual(["Zoë Zee O'Neil.pdf", 'learner-2.pdf', 'learner-3.pdf'])
  })

  it('warns about pages that look like Red Pen sheets but could not be read', () => {
    const r = planCoverSplit({ pages: [C('01'), P, U, P, U], includeCovers: true })
    expect(summary(r)).toEqual([['learner-01.pdf', 1, 5]])
    expect(ok(r).warnings).toEqual([
      'Pages 3 and 5 look like a Red Pen sheet, but the code could not be read, so they stay in the file before. If any is a Cover sheet, scan them again more clearly.',
    ])
  })
})

describe('safeFileBase', () => {
  it.each([
    ['Thandi Mokoena', 'Thandi Mokoena'],
    ['  Sipho\t\tDlamini  ', 'Sipho Dlamini'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a b c d e f g h i j'],
    ['line\nbreak\u0000', 'line break'],
    ['.hidden.', 'hidden'],
    ['Nomvula Nkosi-Ndlovu', 'Nomvula Nkosi-Ndlovu'],
    ['', 'fallback'],
    ['???', 'fallback'],
    ['nul', 'fallback'],
    ['LPT1', 'fallback'],
  ])('%j becomes %j', (input, expected) => {
    expect(safeFileBase(input, 'fallback')).toBe(expected)
  })

  it('keeps names short', () => {
    expect([...safeFileBase('x'.repeat(200), 'f')]).toHaveLength(80)
  })

  it('names a learner without a name by Learner ID', () => {
    expect(learnerFileBase('0042')).toBe('learner-0042')
  })
})
