import { describe, expect, it } from 'vitest'
import {
  checkDesign,
  parseDesign,
  parseSavedDesigns,
  presetDesign,
  upsertSaved,
  type MarkbookDesign,
} from '../src/markbook/design'
import { buildLayout, columnLetter, learnerFormula, summaryFormula, type Layout } from '../src/markbook/layout'
import { capsLevel, excelRound, learnerRow, sampleMarks, summaryValue } from '../src/markbook/maths'
import { buildMarkbook, markbookFileName, sheetName } from '../src/markbook/sheet'

function simple(): MarkbookDesign {
  const d = presetDesign('blank')
  d.assessments = [
    { id: 'a1', name: 'Test 1', outOf: 50, weight: 40, categoryId: null },
    { id: 'a2', name: 'Exam', outOf: 100, weight: 60, categoryId: null },
  ]
  return d
}

function col(layout: Layout, header: string) {
  const c = layout.columns.find((x) => x.header === header)
  if (!c) throw new Error(`No column ${header}`)
  return c
}

describe('columnLetter', () => {
  it('counts like Excel', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
  })
})

describe('buildLayout', () => {
  it('places marks with their percentages, then the calculated columns', () => {
    const layout = buildLayout(simple(), 30)
    expect(layout.columns.map((c) => `${c.letter}:${c.header}`)).toEqual([
      'A:Learner ID',
      'B:Learner',
      'C:Test 1',
      'D:Test 1 (%)',
      'E:Exam',
      'F:Exam (%)',
      'G:Term mark (%)',
      'H:Rounded (%)',
      'I:Level',
      'J:Result',
    ])
    expect(layout.firstRow).toBe(4)
    expect(layout.lastRow).toBe(33)
    expect(layout.summary.map((s) => s.row)).toEqual([35, 36, 37, 38, 39])
  })

  it('groups assessments by Category with a Category average after each group', () => {
    const d = presetDesign('term')
    d.showPercentages = false
    d.rounding = 'none'
    const layout = buildLayout(d, 3)
    expect(layout.columns.map((c) => `${c.letter}:${c.header}`)).toEqual([
      'A:Learner ID',
      'B:Learner',
      'C:Test 1',
      'D:Test 2',
      'E:Tests (%)',
      'F:Assignment',
      'G:Assignments (%)',
      'H:Exam',
      'I:Exam average (%)',
      'J:Term mark (%)',
      'K:Level',
      'L:Result',
    ])
    expect(col(layout, 'Tests (%)').weight).toBe(40)
  })

  it('leaves out optional columns and the summary when asked', () => {
    const d = simple()
    Object.assign(d, { showPercentages: false, rounding: 'none', showLevel: false, showResult: false })
    d.showSummary = false
    const layout = buildLayout(d, 2)
    expect(layout.columns.map((c) => c.header)).toEqual(['Learner ID', 'Learner', 'Test 1', 'Exam', 'Term mark (%)'])
    expect(layout.summary).toEqual([])
  })
})

describe('learner formulas', () => {
  const d = simple()
  const layout = buildLayout(d, 30)
  const f = (header: string, row = 4) => learnerFormula(d, layout, col(layout, header), row)

  it('leaves mark cells for the teacher', () => {
    expect(f('Test 1')).toBeNull()
    expect(f('Learner')).toBeNull()
  })

  it('works out a percentage that skips blanks and ABS', () => {
    expect(f('Test 1 (%)')).toBe('=IF(ISNUMBER(C4),C4/C$2*100,"")')
    expect(f('Exam (%)', 9)).toBe('=IF(ISNUMBER(E9),E9/E$2*100,"")')
  })

  it('weighs the marks that are there, with out of and weights from rows 2 and 3', () => {
    expect(f('Term mark (%)')).toBe(
      '=IFERROR((IF(ISNUMBER(C4),C4/C$2*C$3,0)+IF(ISNUMBER(E4),E4/E$2*E$3,0))/(IF(ISNUMBER(C4),C$3,0)+IF(ISNUMBER(E4),E$3,0))*100,IF(ISTEXT(C4)*(C4<>"")+ISTEXT(E4)*(E4<>"")>0,"a",""))',
    )
  })

  it('rounds, levels and passes from the unrounded mark', () => {
    expect(f('Rounded (%)')).toBe('=IF(ISNUMBER(G4),ROUND(G4,0),G4)')
    expect(f('Level')).toBe('=IFERROR(LOOKUP(G4,{0,30,40,50,60,70,80},{1,2,3,4,5,6,7}),"")')
    expect(f('Result')).toBe('=IF(ISNUMBER(G4),IF(G4>=50,"Pass","Fail"),"")')
    const one = { ...d, rounding: 'one' as const, passMark: 40 }
    const l = buildLayout(one, 30)
    expect(learnerFormula(one, l, col(l, 'Rounded (%)'), 5)).toBe('=IF(ISNUMBER(G5),ROUND(G5,1),G5)')
    expect(learnerFormula(one, l, col(l, 'Result'), 5)).toBe('=IF(ISNUMBER(G5),IF(G5>=40,"Pass","Fail"),"")')
  })

  it('averages each Category and weighs the Category averages', () => {
    const t = presetDesign('term')
    t.showPercentages = false
    const l = buildLayout(t, 3)
    const g = (header: string) => learnerFormula(t, l, col(l, header), 6)
    expect(g('Tests (%)')).toBe(
      '=IFERROR((IF(ISNUMBER(C6),C6/C$2*C$3,0)+IF(ISNUMBER(D6),D6/D$2*D$3,0))/(IF(ISNUMBER(C6),C$3,0)+IF(ISNUMBER(D6),D$3,0))*100,IF(ISTEXT(C6)*(C6<>"")+ISTEXT(D6)*(D6<>"")>0,"a",""))',
    )
    expect(g('Assignments (%)')).toBe(
      '=IFERROR((IF(ISNUMBER(F6),F6/F$2*F$3,0))/(IF(ISNUMBER(F6),F$3,0))*100,IF(ISTEXT(F6)*(F6<>"")>0,"a",""))',
    )
    expect(g('Term mark (%)')).toBe(
      '=IFERROR((IF(ISNUMBER(E6),E6*E$3,0)+IF(ISNUMBER(G6),G6*G$3,0)+IF(ISNUMBER(I6),I6*I$3,0))/(IF(ISNUMBER(E6),E$3,0)+IF(ISNUMBER(G6),G$3,0)+IF(ISNUMBER(I6),I$3,0)),IF(ISTEXT(E6)*(E6<>"")+ISTEXT(G6)*(G6<>"")+ISTEXT(I6)*(I6<>"")>0,"a",""))',
    )
  })
})

describe('summary formulas', () => {
  const d = simple()
  const layout = buildLayout(d, 30)
  const s = (header: string, kind: Parameters<typeof summaryFormula>[3]) =>
    summaryFormula(d, layout, col(layout, header), kind)

  it('summarises a column over every learner row, skipping text', () => {
    expect(s('Test 1 (%)', 'average')).toBe('=IFERROR(AVERAGE(D4:D33),"")')
    expect(s('Test 1 (%)', 'highest')).toBe('=IF(COUNT(D4:D33)=0,"",MAX(D4:D33))')
    expect(s('Test 1 (%)', 'lowest')).toBe('=IF(COUNT(D4:D33)=0,"",MIN(D4:D33))')
    expect(s('Test 1 (%)', 'count')).toBe('=COUNT(D4:D33)')
    expect(s('Test 1 (%)', 'passRate')).toBe('=IFERROR(COUNTIF(D4:D33,">=50")/COUNT(D4:D33)*100,"")')
  })

  it('passes raw marks against the pass mark of their out of', () => {
    expect(s('Test 1', 'passRate')).toBe('=IFERROR(COUNTIF(C4:C33,">="&C$2*50/100)/COUNT(C4:C33)*100,"")')
  })

  it('counts passes and fails in the Result column', () => {
    expect(s('Result', 'count')).toBe('=COUNTIF(J4:J33,"Pass")+COUNTIF(J4:J33,"Fail")')
    expect(s('Result', 'passRate')).toBe(
      '=IFERROR(COUNTIF(J4:J33,"Pass")/(COUNTIF(J4:J33,"Pass")+COUNTIF(J4:J33,"Fail"))*100,"")',
    )
    expect(s('Result', 'average')).toBeNull()
    expect(s('Level', 'average')).toBeNull()
    expect(s('Level', 'count')).toBe('=COUNT(I4:I33)')
    expect(s('Learner', 'average')).toBeNull()
  })
})

describe('preview maths', () => {
  it('rounds like Excel', () => {
    expect(excelRound(2.5, 0)).toBe(3)
    expect(excelRound(49.5, 0)).toBe(50)
    expect(excelRound(1.005, 2)).toBe(1.01)
    expect(excelRound(-2.5, 0)).toBe(-3)
    expect(excelRound(67.25, 1)).toBe(67.3)
  })

  it('bands CAPS levels on the unrounded mark', () => {
    expect([0, 29.99, 30, 39.9, 40, 49.6, 50, 59, 60, 69.99, 70, 79.6, 80, 100].map(capsLevel)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    ])
    expect(capsLevel(-1)).toBeNull()
  })

  it('works out a learner row as the formulas would', () => {
    const d = simple()
    const layout = buildLayout(d, 5)
    const row = learnerRow(d, layout, { id: '01', name: 'Lindiwe Khumalo' }, { a1: 30, a2: 80 })
    // Test 1 60%, Exam 80%: 0.4 * 60 + 0.6 * 80 = 72
    expect(row[0]).toBe('01')
    expect(row[1]).toBe('Lindiwe Khumalo')
    expect(row[2]).toBe(30)
    expect(row[3]).toBeCloseTo(60)
    expect(row[5]).toBeCloseTo(80)
    expect(row[6]).toBeCloseTo(72)
    expect(row.slice(7)).toEqual([72, 6, 'Pass'])
  })

  it('leaves out ABS and blanks and lets the other weights share their place', () => {
    const d = simple()
    const layout = buildLayout(d, 5)
    const absent = learnerRow(d, layout, { id: '1', name: '' }, { a1: 'ABS', a2: 45 })
    expect(absent[3]).toBeNull()
    expect(absent[6]).toBeCloseTo(45)
    expect(absent.slice(7)).toEqual([45, 3, 'Fail'])
    // Absent for one task and 30% for the other is 30%, not 15%.
    const half = learnerRow(d, layout, { id: '3', name: '' }, { a1: 'a', a2: 30 })
    expect(half[6]).toBeCloseTo(30)
    const none = learnerRow(d, layout, { id: '2', name: '' }, { a1: null })
    expect(none.slice(2)).toEqual([null, null, null, null, null, null, null, null])
  })

  it('gives a as the mark of a learner who was absent for everything, with no level or result', () => {
    const d = simple()
    const layout = buildLayout(d, 5)
    const away = learnerRow(d, layout, { id: '1', name: '' }, { a1: 'a', a2: 'ABS' })
    expect(away.slice(6)).toEqual(['a', 'a', null, null])
    // One absence and one blank is still an absence, not an unmarked row.
    expect(learnerRow(d, layout, { id: '1', name: '' }, { a1: 'a', a2: null })[6]).toBe('a')
  })

  it('leaves an absent Category out of the weighted mark, and is a when every Category is', () => {
    const d = presetDesign('term')
    d.showPercentages = false
    const layout = buildLayout(d, 1)
    const at = (kind: string) => layout.columns.findIndex((c) => c.kind === kind)
    const row = learnerRow(d, layout, { id: '1', name: '' }, { a1: 'a', a2: 'a', a3: 20, a4: 60 })
    expect(row[layout.columns.findIndex((c) => c.kind === 'category')]).toBe('a')
    // Assignment 50% (weight 20) and Exam 60% (weight 40): (0.2*50 + 0.4*60) / 0.6
    expect(row[at('term')]).toBeCloseTo(34 / 0.6)
    const away = learnerRow(d, layout, { id: '1', name: '' }, { a1: 'a', a2: 'a', a3: 'a', a4: 'a' })
    expect(away[at('term')]).toBe('a')
  })

  it('bands the level on the unrounded mark even when the rounded mark crosses a boundary', () => {
    const d = simple()
    d.assessments = [{ id: 'a1', name: 'Test', outOf: 1000, weight: 100, categoryId: null }]
    const layout = buildLayout(d, 1)
    const row = learnerRow(d, layout, { id: '1', name: '' }, { a1: 496 })
    expect(row.slice(-3)).toEqual([50, 3, 'Fail'])
  })

  it('weighs Category averages, skipping a Category with no marks yet', () => {
    const d = presetDesign('term')
    d.showPercentages = false
    const layout = buildLayout(d, 1)
    const term = (marks: Record<string, number | string | null>) =>
      learnerRow(d, layout, { id: '1', name: '' }, marks)[layout.columns.findIndex((c) => c.kind === 'term')]
    // Tests (40/50 and 30/50) 70%, Assignment 20/40 50%, Exam 60/100 60%: 0.4*70 + 0.2*50 + 0.4*60 = 62
    expect(term({ a1: 40, a2: 30, a3: 20, a4: 60 })).toBeCloseTo(62)
    // No exam yet: (0.4*70 + 0.2*50) / 0.6
    expect(term({ a1: 40, a2: 30, a3: 20, a4: null })).toBeCloseTo(38 / 0.6)
    // Test 2 absent: Tests is Test 1 alone (80%)
    expect(term({ a1: 40, a2: 'ABS', a3: 20, a4: 60 })).toBeCloseTo(0.4 * 80 + 0.2 * 50 + 0.4 * 60)
  })

  it('summarises like the summary formulas', () => {
    const d = simple()
    const layout = buildLayout(d, 4)
    const mark = col(layout, 'Test 1')
    const values = [25, 'ABS', null, 40]
    expect(summaryValue(d, mark, 'average', values)).toBeCloseTo(32.5)
    expect(summaryValue(d, mark, 'highest', values)).toBe(40)
    expect(summaryValue(d, mark, 'lowest', values)).toBe(25)
    expect(summaryValue(d, mark, 'count', values)).toBe(2)
    expect(summaryValue(d, mark, 'passRate', values)).toBe(100)
    expect(summaryValue(d, mark, 'passRate', [24, 25])).toBe(50)
    expect(summaryValue(d, mark, 'average', [null, 'ABS'])).toBeNull()
    const result = col(layout, 'Result')
    expect(summaryValue(d, result, 'passRate', ['Pass', 'Fail', 'Pass', null])).toBeCloseTo(200 / 3)
    expect(summaryValue(d, result, 'count', ['Pass', 'Fail', null])).toBe(2)
    expect(summaryValue(d, result, 'average', ['Pass'])).toBeUndefined()
  })

  it('makes sample marks with one absent learner and one blank mark', () => {
    const marks = sampleMarks(simple(), 5)
    expect(marks).toHaveLength(5)
    expect(marks[1].a1).toBe('a')
    expect(marks[3].a2).toBeNull()
    for (const m of [marks[0], marks[2], marks[4]]) {
      expect(m.a1).toBeGreaterThanOrEqual(0)
      expect(m.a1).toBeLessThanOrEqual(50)
    }
  })
})

describe('checkDesign', () => {
  it('accepts the presets as they are', () => {
    for (const id of ['caps-fet', 'term', 'blank'] as const)
      expect(checkDesign(presetDesign(id))).toEqual({ errors: [], warnings: [] })
  })

  it('warns when weights do not add up to 100', () => {
    const d = simple()
    d.assessments[1].weight = 50
    expect(checkDesign(d).warnings).toEqual(['The assessment weights add up to 90%, not 100%.'])
    const t = presetDesign('term')
    t.categories[0].weight = 30
    t.assessments[0].weight = 60
    expect(checkDesign(t).warnings).toEqual([
      'The Category weights add up to 90%, not 100%.',
      'In Tests the assessment weights add up to 110%, not 100%.',
    ])
  })

  it('stops the download for a missing name or out of', () => {
    const d = simple()
    d.assessments[0].name = ' '
    d.assessments[1].outOf = 0
    expect(checkDesign(d).errors).toEqual(['Assessment 1 needs a name.', 'Exam needs an "out of" above 0.'])
    d.assessments = []
    expect(checkDesign(d).errors).toContain('Add at least one assessment.')
  })

  it('warns about an empty Category', () => {
    const t = presetDesign('term')
    t.assessments = t.assessments.filter((a) => a.categoryId !== 'c2')
    expect(checkDesign(t).warnings).toEqual(['Assignments has no assessments yet, so it counts for nothing.'])
  })
})

describe('saving designs', () => {
  it('round-trips through JSON and rejects anything else', () => {
    const d = presetDesign('caps-fet')
    expect(parseDesign(JSON.parse(JSON.stringify(d)))).toEqual(d)
    expect(parseDesign(null)).toBeNull()
    expect(parseDesign({ version: 2, assessments: [], categories: [] })).toBeNull()
    expect(parseDesign({ version: 1, assessments: [{ id: 'x', name: 5 }], categories: [] })?.assessments).toEqual([
      { id: 'x', name: '', outOf: 0, weight: 0, categoryId: null },
    ])
  })

  it('keeps one saved design per name, newest first', () => {
    const a = { name: 'Grade 10', savedAt: 1, design: presetDesign('term') }
    const b = { name: 'Grade 11', savedAt: 2, design: presetDesign('blank') }
    const c = { name: 'grade 10 ', savedAt: 3, design: presetDesign('caps-fet') }
    expect(upsertSaved(upsertSaved(upsertSaved([], a), b), c).map((s) => s.savedAt)).toEqual([3, 2])
    expect(parseSavedDesigns([a, { name: 'broken' }, 7])).toEqual([a])
  })
})

describe('buildMarkbook', () => {
  it('writes headings, out of, weights, formulas and the summary', () => {
    const d = simple()
    const { layout, sheets } = buildMarkbook(d, [
      { id: '01', name: 'Thandi Mokoena' },
      { id: '02', name: 'Sipho Dlamini' },
    ])
    const [sheet, notes] = sheets
    expect(sheet.name).toBe('Markbook')
    expect(notes.name).toBe('Notes')
    expect(sheet.stickyRows).toBe(3)
    expect(sheet.stickyColumns).toBe(2)
    expect(sheet.widths).toHaveLength(layout.columns.length)
    const rows = sheet.data as unknown as ({ value: unknown; type?: unknown; format?: string } | null)[][]
    expect(rows[0].map((c) => c?.value)).toEqual(layout.columns.map((c) => c.header))
    expect(rows[1].map((c) => c?.value ?? null)).toEqual([null, 'Out of', 50, null, 100, null, null, null, null, null])
    expect(rows[2].map((c) => c?.value ?? null)).toEqual([
      null,
      'Weight (%)',
      40,
      null,
      60,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(rows[3][0]).toEqual({ value: '01', type: String })
    expect(rows[3][1]).toEqual({ value: 'Thandi Mokoena' })
    expect(rows[3][2]).toBeNull()
    expect(rows[3][3]).toEqual({ type: 'Formula', value: 'IF(ISNUMBER(C4),C4/C$2*100,"")', format: '0.0' })
    expect(rows[4][7]).toEqual({ type: 'Formula', value: 'IF(ISNUMBER(G5),ROUND(G5,0),G5)', format: '0' })
    // Row 6 is the gap, then the summary from row 7.
    expect(rows).toHaveLength(3 + 2 + 1 + 5)
    expect(rows[6][1]).toEqual({ value: 'Class average', fontWeight: 'bold' })
    expect(rows[6][6]).toMatchObject({ type: 'Formula', value: 'IFERROR(AVERAGE(G4:G5),"")' })
    expect(rows[10][9]).toMatchObject({
      value: 'IFERROR(COUNTIF(J4:J5,"Pass")/(COUNTIF(J4:J5,"Pass")+COUNTIF(J4:J5,"Fail"))*100,"")',
    })
    expect(sheet.failCells).toEqual({ from: { row: 4, column: 10 }, to: { row: 5, column: 10 } })
  })

  it('leaves blank rows when there are no learners', () => {
    const { layout } = buildMarkbook(simple(), [], { blankRows: 12 })
    expect(layout.lastRow).toBe(15)
  })

  it('names the sheet and file after the title', () => {
    expect(sheetName('Grade 10: Term 1 / 2026 [Maths]')).toBe('Grade 10 Term 1 2026 Maths')
    expect(sheetName('   ')).toBe('Markbook')
    expect(markbookFileName('Grade 10A: Term 1')).toBe('Grade 10A Term 1.xlsx')
    expect(markbookFileName('')).toBe('Markbook.xlsx')
  })
})
