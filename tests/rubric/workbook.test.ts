import { describe, expect, it } from 'vitest'
import { newRubric } from '../../src/rubric/core/model'
import {
  MAX_LEARNERS,
  buildWorkbook,
  columnLetter,
  fitToWidthXml,
  rubricFileName,
  sheetName,
  sheetRef,
  type WorkbookSheet,
} from '../../src/rubric/core/workbook'

type AnyCell = { value?: unknown; type?: string; format?: string } | null

/** The cell at an address such as "K7". */
function cell(sheet: WorkbookSheet, address: string): AnyCell {
  const m = /^([A-Z]+)(\d+)$/.exec(address)!
  const column = m[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return (sheet.data[Number(m[2]) - 1]?.[column] ?? null) as AnyCell
}

function formulaAt(sheet: WorkbookSheet, address: string): string {
  const c = cell(sheet, address)
  expect(c?.type, address).toBe('Formula')
  return String(c!.value)
}

const LEARNERS = [{ name: 'Thandi' }, { name: "Sipho O'Brien" }]

describe('names', () => {
  it('counts columns like Excel', () => {
    expect([0, 25, 26, 27].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB'])
  })

  it('makes safe sheet names and quotes them in formulas', () => {
    expect(sheetName('01 A/B: [x]?')).toBe('01 A B x')
    expect(sheetName("'Quoted'")).toBe('Quoted')
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
    expect(sheetName(' / ', '03 Learner')).toBe('03 Learner')
    expect(sheetRef("02 Sipho O'Brien", 'B3')).toBe("'02 Sipho O''Brien'!B3")
  })

  it('names the file after the rubric', () => {
    expect(rubricFileName('Oral presentation')).toBe('Oral presentation rubric.xlsx')
    expect(rubricFileName('Essay rubric: Gr 9?')).toBe('Essay rubric Gr 9.xlsx')
    expect(rubricFileName('  ')).toBe('Rubric.xlsx')
  })
})

describe('buildWorkbook', () => {
  it('is the Rubric sheet alone without learners or with marking off', () => {
    const r = newRubric('analytic')
    expect(buildWorkbook(r).map((s) => s.name)).toEqual(['Rubric'])
    r.marking = false
    expect(buildWorkbook(r, LEARNERS).map((s) => s.name)).toEqual(['Rubric'])
  })

  it('adds a numbered sheet per learner, a Summary, Levels and Notes', () => {
    const sheets = buildWorkbook(newRubric('analytic'), LEARNERS)
    expect(sheets.map((s) => s.name)).toEqual(['Rubric', 'Summary', 'Levels', '01 Thandi', "02 Sipho O'Brien", 'Notes'])
    expect(buildWorkbook(newRubric('checklist'), [{ name: '' }]).map((s) => s.name)).toEqual([
      'Rubric',
      'Summary',
      '01 Learner',
      'Notes',
    ])
    const r = newRubric('analytic')
    r.showSummary = false
    expect(buildWorkbook(r, LEARNERS).map((s) => s.name)).toEqual(['Rubric', '01 Thandi', "02 Sipho O'Brien", 'Notes'])
  })

  it('gives two learners with one name their own sheets, and stops at the most a workbook holds', () => {
    const twins = buildWorkbook(newRubric('checklist'), [{ name: 'Sam' }, { name: 'Sam' }])
    expect(twins.filter((s) => s.refs).map((s) => s.name)).toEqual(['01 Sam', '02 Sam'])
    const many = buildWorkbook(
      newRubric('checklist'),
      Array.from({ length: MAX_LEARNERS + 5 }, () => ({ name: '' })),
    )
    expect(many.filter((s) => s.refs)).toHaveLength(MAX_LEARNERS)
    expect(many.find((s) => s.refs)!.name).toBe('001 Learner')
  })

  it('has no formulas to mark with on the printed Rubric sheet', () => {
    for (const style of ['analytic', 'holistic', 'single-point', 'checklist'] as const) {
      const [print] = buildWorkbook(newRubric(style), LEARNERS)
      const formulas = print!.data.flat().filter((c) => (c as AnyCell)?.type === 'Formula')
      // Only the total of the criteria's marks is worked out.
      expect(
        formulas.map((c) => String((c as AnyCell)!.value)).every((f) => f.startsWith('SUM(')),
        style,
      ).toBe(true)
      expect(print!.refs).toBeUndefined()
      expect(print!.shade).toEqual([])
    }
  })
})

describe('an analytic learner sheet', () => {
  const sheets = buildWorkbook(newRubric('analytic'), LEARNERS)
  const sheet = sheets[3]!

  it('lays out a descriptor and a tick-box per level, with marks in brackets', () => {
    expect(cell(sheet, 'B3')?.value).toBe('Thandi')
    expect(cell(sheet, 'C5')?.value).toBe('Advanced')
    expect(cell(sheet, 'D6')).toMatchObject({ value: 1, format: '0%' })
    expect(cell(sheet, 'F6')?.value).toBe(0.75)
    expect(cell(sheet, 'B7')?.value).toBe(8)
    expect(String(cell(sheet, 'E7')?.value)).toBe(
      'Accurate and covers the topic. Answers most questions correctly.\n(6)',
    )
    expect(cell(sheet, 'D7')).toMatchObject({ value: null, backgroundColor: '#FFF8DC' })
    expect(sheet.refs).toEqual({
      name: 'B3',
      values: ['K7', 'K8', 'K9', 'K10'],
      levels: ['L7', 'L8', 'L9', 'L10'],
      total: 'K11',
      status: 'B13',
    })
  })

  it('works out a criterion from the one box that is filled, an x or a mark that fits', () => {
    const f = formulaAt(sheet, 'K7')
    expect(f.startsWith('IF(COUNTA(D7,F7,H7,J7)=0,"",IF(COUNTA(D7,F7,H7,J7)>1,"Check",IFERROR(')).toBe(true)
    expect(f).toContain('IF(ISNUMBER(F7),IF(AND(F7>=0,F7<=$B7),F7,0/0),(F7<>"")*$B7*F$6)')
    expect(formulaAt(sheet, 'L7')).toBe(
      'IF(COUNTA(D7,F7,H7,J7)<>1,"",IF(D7<>"",$C$5,IF(F7<>"",$E$5,IF(H7<>"",$G$5,IF(J7<>"",$I$5,"")))))',
    )
  })

  it('totals only a complete sheet, and says what is still to do', () => {
    expect(formulaAt(sheet, 'B11')).toBe('SUM(B7:B10)')
    expect(formulaAt(sheet, 'K11')).toBe('IF(COUNT(K7:K10)<4,"",SUM(K7:K10))')
    expect(formulaAt(sheet, 'B12')).toBe('IF(ISNUMBER(K11),K11/$B$11,"")')
    expect(formulaAt(sheet, 'B13')).toBe(
      'IF(COUNTIF(K7:K10,"Check")>0,"Check: one box per criterion, and a mark that fits its level",IF(COUNT(K7:K10)=0,"Not marked yet",IF(COUNT(K7:K10)<4,(4-COUNT(K7:K10))&" still to mark","Marked")))',
    )
  })

  it('shades the chosen level and prints on one page across', () => {
    expect(sheet.shade[0]).toEqual({
      from: { row: 7, column: 3 },
      to: { row: 10, column: 3 },
      formula: 'D7<>""',
      style: { backgroundColor: '#FDE3E5' },
    })
    expect(sheet.shade).toHaveLength(5)
    expect(sheet.landscape).toBe(true)
    expect(sheet.fitToWidth).toBe(true)
  })

  it('adds the reported mark and the CAPS level when asked', () => {
    const r = newRubric('analytic')
    r.reportOutOf = 10
    r.showLevel = true
    const s = buildWorkbook(r, LEARNERS)[3]!
    expect(cell(s, 'A13')?.value).toBe('Mark out of 10')
    expect(formulaAt(s, 'B13')).toBe('IF(ISNUMBER(K11),ROUND(K11/$B$11*10,1),"")')
    expect(formulaAt(s, 'B14')).toBe('IFERROR(LOOKUP(B12*100,{0,30,40,50,60,70,80},{1,2,3,4,5,6,7}),"")')
    expect(s.refs!.status).toBe('B15')
  })

  it('checks a typed mark against the band of its level when levels have bands', () => {
    const r = newRubric('analytic', 'caps7')
    r.criteria.forEach((c) => (c.weight = 10))
    const s = buildWorkbook(r, [{ name: '' }])[3]!
    expect(String(cell(s, 'C7')?.value)).toBe('(9-10)')
    const f = formulaAt(s, 'Q7')
    expect(f).toContain(
      'IF(ISNUMBER(D7),IF(AND(D7>=MIN(ROUND($B7*D$6,0),ROUND($B7*F$6,0)+1),D7<=ROUND($B7*D$6,0)),D7,0/0),(D7<>"")*ROUND($B7*D$6,0))',
    )
    // The lowest level starts at 0.
    expect(f).toContain('IF(AND(P7>=0,P7<=ROUND($B7*P$6,0)),P7,0/0)')
  })

  it('names a tagged criterion with its cognitive level', () => {
    const r = newRubric('analytic')
    r.taxonomy = 'bloom'
    r.criteria[0]!.cognitive = 'Analyse'
    const [print] = buildWorkbook(r)
    expect(cell(print!, 'A7')?.value).toBe('Content\n[Analyse]')
    const last = print!.data[print!.data.length - 1]![0] as AnyCell
    expect(last?.value).toBe("Bloom's revised taxonomy: Analyse 40%, No level 60%")
  })
})

describe('the other styles', () => {
  it('marks a holistic rubric from one box down the side', () => {
    const sheets = buildWorkbook(newRubric('holistic'), [{ name: 'A' }])
    const s = sheets[3]!
    expect(cell(s, 'B7')?.value).toBe('7.5')
    expect(formulaAt(s, 'B10')).toContain('IF(ISNUMBER(D7),IF(AND(D7>=0,D7<=10),D7,0/0),(D7<>"")*7.5)')
    expect(cell(s, 'D10')?.value).toBe(10)
    expect(cell(s, 'A12')?.value).toBe('Level reached')
    expect(formulaAt(s, 'B12')).toBe(
      'IF(COUNTA(D6:D9)<>1,"",IF(D6<>"",$A$6,IF(D7<>"",$A$7,IF(D8<>"",$A$8,IF(D9<>"",$A$9,"")))))',
    )
    expect(s.refs).toEqual({ name: 'B3', values: ['B10'], levels: ['B12'], total: 'B10', status: 'B13' })
    // One mark, so the Summary has no separate Total column.
    expect(sheets[1]!.data[2]!.map((c) => (c as AnyCell)?.value)).toEqual(['No.', 'Learner', 'Mark', '%', 'Status'])
  })

  it('takes a typed mark per criterion on a single-point rubric', () => {
    const s = buildWorkbook(newRubric('single-point'), [{ name: 'A' }])[2]!
    expect(String(cell(s, 'B6')?.value)).toBe('Claim\nStates a clear position that answers the question.')
    expect(cell(s, 'D6')?.value).toBe(4)
    expect(formulaAt(s, 'E9')).toBe('IF(OR(COUNT(E6:E8)<3,SUMPRODUCT(--(E6:E8>D6:D8))>0),"",SUM(E6:E8))')
    expect(formulaAt(s, s.refs!.status)).toContain('"Check: a mark is above its maximum"')
  })

  it('counts criteria met on a single-point rubric without marks', () => {
    const r = newRubric('single-point')
    r.scored = false
    const sheets = buildWorkbook(r, [{ name: 'A' }])
    const s = sheets[2]!
    expect(formulaAt(s, 'E6')).toBe('IF(D6<>"",1,0)')
    expect(formulaAt(s, 'D9')).toBe('COUNTA(D6:D8)')
    expect(s.refs!.values).toEqual(['E6', 'E7', 'E8'])
    // No percentage for a rubric without marks.
    expect(cell(s, 'A10')?.value).toBe('Status')
    expect(sheets[1]!.data[2]!.map((c) => (c as AnyCell)?.value)).toEqual([
      'No.',
      'Learner',
      'Claim',
      'Evidence',
      'Reasoning',
      'Criteria met',
      'Status',
    ])
  })

  it('gives the marks of each item that is ticked on a checklist, and 0 for a typed 0', () => {
    const s = buildWorkbook(newRubric('checklist'), [{ name: 'A' }])[2]!
    expect(formulaAt(s, 'D6')).toBe('IF(OR(C6="",C6&""="0"),0,B6)')
    expect(formulaAt(s, 'D11')).toBe('IF(COUNTA(C6:C10)=0,"",SUM(D6:D10))')
    expect(formulaAt(s, 'B13')).toBe('IF(COUNTA(C6:C10)=0,"Not marked yet","Marked")')
    expect(s.landscape).toBe(false)
  })
})

describe('the Summary and Levels sheets', () => {
  const sheets = buildWorkbook(newRubric('analytic'), LEARNERS)
  const summary = sheets[1]!
  const levels = sheets[2]!

  it('pulls each learner in once their sheet says Marked', () => {
    expect(summary.data[2]!.map((c) => (c as AnyCell)?.value)).toEqual([
      'No.',
      'Learner',
      'Content',
      'Structure',
      'Delivery',
      'Language',
      'Total',
      '%',
      'Status',
    ])
    expect(cell(summary, 'C4')?.value).toBe(8)
    expect(formulaAt(summary, 'G4')).toBe('SUM(C4:F4)')
    expect(formulaAt(summary, 'B6')).toBe("IF('02 Sipho O''Brien'!B3=\"\",\"\",'02 Sipho O''Brien'!B3)")
    expect(formulaAt(summary, 'C6')).toBe("IF('02 Sipho O''Brien'!B13=\"Marked\",'02 Sipho O''Brien'!K7,\"\")")
    expect(formulaAt(summary, 'G5')).toBe('IF(\'01 Thandi\'!B13="Marked",\'01 Thandi\'!K11,"")')
    expect(formulaAt(summary, 'H5')).toBe('IF(ISNUMBER(G5),G5/G$4,"")')
    expect(formulaAt(summary, 'I5')).toBe("'01 Thandi'!B13")
  })

  it('averages each criterion and names the strongest and the one needing the most work', () => {
    expect(cell(summary, 'B8')?.value).toBe('Class average')
    expect(formulaAt(summary, 'C8')).toBe('IF(COUNT(C5:C6)=0,"",AVERAGE(C5:C6))')
    expect(formulaAt(summary, 'C9')).toBe('IF(ISNUMBER(C8),C8/C4,"")')
    expect(formulaAt(summary, 'C12')).toBe('COUNTIF(I5:I6,"Marked")')
    expect(cell(summary, 'B14')?.value).toBe('Strongest')
    expect(formulaAt(summary, 'C14')).toBe('IF(COUNT(C9:F9)=0,"",INDEX(C3:F3,MATCH(MAX(C9:F9),C9:F9,0)))')
    expect(formulaAt(summary, 'C15')).toContain('MATCH(MIN(C9:F9),C9:F9,0)')
  })

  it('counts the learners at each level from the Levels sheet', () => {
    expect(cell(summary, 'B17')?.value).toBe('Learners at each level')
    expect(cell(summary, 'B18')?.value).toBe('Advanced')
    expect(formulaAt(summary, 'C18')).toBe("COUNTIF('Levels'!C$3:C$4,$B18)")
    expect(formulaAt(summary, 'F21')).toBe("COUNTIF('Levels'!F$3:F$4,$B21)")
    expect(formulaAt(levels, 'C4')).toBe("IF('02 Sipho O''Brien'!B13=\"Marked\",'02 Sipho O''Brien'!L7,\"\")")
    expect(summary.stickyRows).toBe(4)
  })
})

describe('fitToWidthXml', () => {
  const open = '<worksheet xmlns="x">'

  it('extends a page setup that is there', () => {
    expect(fitToWidthXml(`${open}<sheetData/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`)).toBe(
      `${open}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData/><pageSetup fitToWidth="1" fitToHeight="0" paperSize="9" orientation="landscape"/></worksheet>`,
    )
  })

  it('adds a portrait page setup when there is none', () => {
    expect(fitToWidthXml(`${open}<sheetData/></worksheet>`)).toBe(
      `${open}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    )
  })
})
