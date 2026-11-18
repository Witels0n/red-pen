// A Rubric as an Excel workbook: a printable Rubric sheet and, for marking in Excel, a sheet per
// learner, a class Summary and (for rubrics with levels) a Levels sheet.
// buildWorkbook is pure and unit tested; writeWorkbook loads the Excel writer on first use.
//
// A learner sheet is marked by typing x in a tick-box cell. Plain cells are used instead of
// Excel's own tick-boxes, which only work in recent versions of Excel.

import type { CellObject, SheetData } from 'write-excel-file/browser'
import { cognitiveById } from './cognitive'
import {
  TARGET,
  bandLabel,
  cognitiveShares,
  criterionMarks,
  formatNumber,
  givesMarks,
  levelBands,
  rubricTotal,
  usesLevels,
  type Rubric,
} from './model'

export interface WorkbookLearner {
  name: string
}

/** A rule that shades cells while a formula is true. Rows and columns from 1, as Excel counts them. */
export interface ShadeRule {
  from: { row: number; column: number }
  to: { row: number; column: number }
  /** Written for the top-left cell of the range, without a leading "=". */
  formula: string
  style: { backgroundColor?: string; textColor?: string; fontWeight?: 'bold' }
}

/** Where a learner sheet keeps what the Summary needs, as cell addresses such as "B3". */
export interface LearnerRefs {
  name: string
  /** One mark per criterion (or 1 for a criterion that was met, on an unscored single-point rubric). */
  values: string[]
  /** One level name per criterion, on rubrics with levels. */
  levels: string[]
  total: string
  status: string
}

export interface WorkbookSheet {
  name: string
  data: SheetData
  widths: number[]
  landscape: boolean
  /** Print on one page across. */
  fitToWidth: boolean
  stickyRows: number
  stickyColumns: number
  shade: ShadeRule[]
  refs?: LearnerRefs
}

/** What the Status cell of a learner sheet says once every criterion has a mark. */
export const MARKED = 'Marked'
const NOT_MARKED = 'Not marked yet'

/** CAPS achievement levels: the lowest percentage of each level 1 to 7. */
const LEVEL_FLOORS = [0, 30, 40, 50, 60, 70, 80]

const HEAD = '#F2F3F5'
const BOX = '#FFF8DC'
const CHOSEN = '#FDE3E5'
const LINE = '#8A93A0'

type Cell = CellObject | null
type Style = Partial<CellObject>

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function at(column: number, row: number): string {
  return `${columnLetter(column)}${row}`
}

function text(value: string, style: Style = {}): Cell {
  return { value, ...style } as CellObject
}

function number(value: number, style: Style = {}): Cell {
  return { value, ...style } as CellObject
}

/** Formulas are stored without the leading "=", as Excel itself writes them. */
function formula(f: string, style: Style = {}): Cell {
  return { type: 'Formula', value: f.replace(/^=/, ''), ...style } as CellObject
}

function empty(style: Style): Cell {
  return { value: null, ...style } as unknown as CellObject
}

const bordered: Style = { borderStyle: 'thin', borderColor: LINE }
const head: Style = { ...bordered, fontWeight: 'bold', backgroundColor: HEAD, wrap: true, alignVertical: 'center' }
const body: Style = { ...bordered, wrap: true, alignVertical: 'top' }
const box: Style = { ...bordered, backgroundColor: BOX, align: 'center', alignVertical: 'center', fontWeight: 'bold' }
const result: Style = { ...bordered, align: 'center', alignVertical: 'center', fontWeight: 'bold' }

/** A safe Excel sheet name: at most 31 characters, none of : \ / ? * [ ] and no apostrophe at either end. */
export function sheetName(title: string, fallback = 'Sheet'): string {
  const clean = title
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .replace(/^'+|'+$/g, '')
    .trim()
  return clean || fallback
}

/** A sheet name as formulas write it: quoted, with any apostrophe doubled. */
export function sheetRef(name: string, cell: string): string {
  return `'${name.replace(/'/g, "''")}'!${cell}`
}

/** A file name for the download, for example "Oral presentation rubric.xlsx". */
export function rubricFileName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (clean === '') return 'Rubric.xlsx'
  return /rubric/i.test(clean) ? `${clean}.xlsx` : `${clean} rubric.xlsx`
}

/** The row height, in points, that shows `value` wrapped in a column `width` characters wide. */
function heightFor(cells: { value: string; width: number }[], min = 20): number {
  let lines = 1
  for (const { value, width } of cells) {
    const perLine = Math.max(4, Math.floor(width * 1.05))
    const here = value.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0)
    lines = Math.max(lines, here)
  }
  return Math.min(400, Math.max(min, lines * 14.5 + 5))
}

/** Rows as they are built. Row numbers count from 1, as formulas need them. */
class Rows {
  readonly data: Cell[][] = []
  constructor(private readonly columns: number) {}

  /** Adds a row from cells by column index, and returns its row number. */
  add(cells: Record<number, Cell> = {}, height?: number): number {
    const row: Cell[] = Array.from({ length: this.columns }, (_, i) => cells[i] ?? null)
    if (height !== undefined) {
      const first = row.findIndex((c) => c !== null)
      if (first < 0) row[0] = { value: null, height } as unknown as CellObject
      else row[first] = { ...row[first]!, height } as CellObject
    }
    this.data.push(row)
    return this.data.length
  }

  get next(): number {
    return this.data.length + 1
  }
}

type Mode = 'print' | 'mark'

const STYLE_NAMES: Record<Rubric['style'], string> = {
  analytic: 'Analytic rubric',
  holistic: 'Holistic rubric',
  'single-point': 'Single-point rubric',
  checklist: 'Checklist',
}

const HOW_TO_MARK: Record<Rubric['style'], string> = {
  analytic:
    'Type x in the yellow box beside the level reached. To give a different mark within that level, type the mark instead of x.',
  holistic:
    'Type x in the yellow box beside the level reached. To give a different mark within that level, type the mark instead of x.',
  'single-point': 'Write what fell short and what went beyond on either side.',
  checklist: 'Type x in the yellow box for each item that is there. For work with none of them, type 0 in any box.',
}

const NAME_REF = 'B3'

/** Rows 1 to 4 of a Rubric or learner sheet: title, task, the learner's name and how to mark. */
function opening(rows: Rows, rubric: Rubric, mode: Mode, learner: string, columns: number): void {
  rows.add({ 0: text(rubric.title.trim() || 'Rubric', { fontWeight: 'bold', fontSize: 16, columnSpan: columns }) }, 24)
  rows.add({
    0: text(rubric.task.trim() || STYLE_NAMES[rubric.style], { fontStyle: 'italic', columnSpan: columns }),
  })
  rows.add({
    0: text('Learner', { fontWeight: 'bold' }),
    1: learner
      ? text(learner, { columnSpan: columns - 1, bottomBorderStyle: 'thin' })
      : empty({ columnSpan: columns - 1, bottomBorderStyle: 'thin' }),
  })
  let how = HOW_TO_MARK[rubric.style]
  if (rubric.style === 'single-point') {
    how += rubric.scored ? ' Type each mark in its yellow box.' : ' Type x in the yellow box when the standard is met.'
  }
  rows.add(
    mode === 'mark'
      ? { 0: text(how, { fontStyle: 'italic', textColor: '#4A5361', wrap: true, columnSpan: columns }) }
      : {},
    mode === 'mark' ? 30 : undefined,
  )
}

interface Closing {
  /** The cell holding the learner's total, and the cell holding what it is out of. */
  total: string
  outOf: string
  /** The Status formula. */
  status: string
  /** Extra label and formula rows before Status, such as the level reached on a holistic rubric. */
  extra?: { label: string; formula: string }[]
}

/** The rows under the table: percentage, reported mark, CAPS level, Status and a comment box. */
function closing(rows: Rows, rubric: Rubric, mode: Mode, columns: number, c: Closing | null): { status: string } {
  const span = Math.min(columns - 1, 4)
  const line = (label: string, value: Cell) => rows.add({ 0: text(label, { fontWeight: 'bold' }), 1: value })
  let status = ''
  if (mode === 'mark' && c) {
    const wide: Style = { columnSpan: span, align: 'left' }
    if (givesMarks(rubric)) {
      let percent = ''
      if (rubric.showPercent || rubric.showLevel) {
        const row = line(
          'Percentage',
          formula(`IF(ISNUMBER(${c.total}),${c.total}/${c.outOf},"")`, { ...wide, format: '0.0%' }),
        )
        percent = at(1, row)
      }
      if (rubric.reportOutOf !== null) {
        line(
          `Mark out of ${formatNumber(rubric.reportOutOf)}`,
          formula(`IF(ISNUMBER(${c.total}),ROUND(${c.total}/${c.outOf}*${rubric.reportOutOf},1),"")`, wide),
        )
      }
      if (rubric.showLevel) {
        line(
          'CAPS level',
          formula(`IFERROR(LOOKUP(${percent}*100,{${LEVEL_FLOORS.join(',')}},{1,2,3,4,5,6,7}),"")`, wide),
        )
      }
    }
    for (const e of c.extra ?? []) line(e.label, formula(e.formula, wide))
    status = at(1, line('Status', formula(c.status, { ...wide, fontStyle: 'italic' })))
  }
  rows.add()
  rows.add(
    {
      0: text('Comment', { fontWeight: 'bold', alignVertical: 'top' }),
      1: empty({ ...body, columnSpan: columns - 1 }),
    },
    64,
  )
  if (mode === 'print' && rubric.taxonomy !== 'none' && rubric.style !== 'holistic') {
    const shares = cognitiveShares(rubric)
    if (shares.length > 0) {
      rows.add()
      rows.add({
        0: text(
          `${cognitiveById(rubric.taxonomy).name}: ` +
            shares.map((s) => `${s.level} ${formatNumber(Math.round(s.percent))}%`).join(', '),
          { fontStyle: 'italic', wrap: true, columnSpan: columns },
        ),
      })
    }
  }
  return { status }
}

function statusFormula(marks: string, count: number, check: string): string {
  return (
    `IF(COUNTIF(${marks},"Check")>0,"${check}",` +
    `IF(COUNT(${marks})=0,"${NOT_MARKED}",` +
    `IF(COUNT(${marks})<${count},(${count}-COUNT(${marks}))&" still to mark","${MARKED}")))`
  )
}

function criterionLabel(rubric: Rubric, index: number): string {
  const c = rubric.criteria[index]!
  const name = c.name.trim() || `Criterion ${index + 1}`
  return rubric.taxonomy !== 'none' && c.cognitive ? `${name}\n[${c.cognitive}]` : name
}

// ---------- Analytic ----------

function analyticSheet(rubric: Rubric, mode: Mode, learner: string, name: string): WorkbookSheet {
  const levels = rubric.levels
  const n = levels.length
  const marks = criterionMarks(rubric)
  const descWidth = Math.max(13, Math.min(30, Math.floor(108 / n) - 5))
  const desc = (k: number) => 2 + 2 * k
  const tick = (k: number) => 3 + 2 * k
  const markCol = 2 + 2 * n
  const levelCol = markCol + 1
  const columns = mode === 'mark' ? levelCol + 1 : markCol + 1
  const widths = [24, 7, ...levels.flatMap(() => [descWidth, 5]), 8, ...(mode === 'mark' ? [16] : [])]
  const rows = new Rows(columns)
  opening(rows, rubric, mode, learner, columns)

  const header: Record<number, Cell> = { 0: text('Criterion', head), 1: text('Marks', { ...head, align: 'center' }) }
  levels.forEach((l, k) => {
    header[desc(k)] = text(l.name.trim(), { ...head, align: 'center', columnSpan: 2 })
  })
  header[markCol] = text('Mark', { ...head, align: 'center' })
  if (mode === 'mark') header[levelCol] = text('Level', { ...head, align: 'center' })
  const headerRow = rows.add(header, 30)

  const share: Record<number, Cell> = {
    0: text('Share of the marks', { fontStyle: 'italic', align: 'right', columnSpan: 2, fontSize: 9 }),
  }
  levels.forEach((l, k) => {
    share[tick(k)] = number(l.percent / 100, { format: '0%', fontSize: 8, align: 'center' })
  })
  const shareRow = rows.add(share)

  // The level one step below each level, by what it is worth: where its band of marks starts.
  const byWorth = levels.map((l, k) => ({ k, percent: l.percent })).sort((a, b) => a.percent - b.percent)
  const below = new Map<number, number | null>()
  byWorth.forEach((entry, i) => below.set(entry.k, i === 0 ? null : byWorth[i - 1]!.k))

  const first = rows.next
  const last = first + rubric.criteria.length - 1
  rubric.criteria.forEach((criterion, i) => {
    const r = first + i
    const bands = levelBands(marks[i]!, levels, rubric.showRanges)
    const cells: Record<number, Cell> = {
      0: text(criterionLabel(rubric, i), { ...body, fontWeight: 'bold' }),
      1: number(marks[i]!, { ...body, align: 'center' }),
    }
    const sized = [{ value: criterionLabel(rubric, i), width: widths[0]! }]
    const boxes = levels.map((_, k) => at(tick(k), r))
    const weight = `$B${r}`
    const worth = (k: number) => `${weight}*${columnLetter(tick(k))}$${shareRow}`
    const parts: string[] = []
    levels.forEach((l, k) => {
      const described = `${(criterion.descriptors[l.id] ?? '').trim()}\n(${bandLabel(bands[k]!)})`.trim()
      cells[desc(k)] = text(described, body)
      cells[tick(k)] = empty(box)
      sized.push({ value: described, width: descWidth })
      const high = rubric.showRanges ? `ROUND(${worth(k)},0)` : worth(k)
      const under = below.get(k) ?? null
      const low = !rubric.showRanges || under === null ? '0' : `MIN(${high},ROUND(${worth(under)},0)+1)`
      const top = rubric.showRanges ? high : weight
      // A typed mark must fit the level. One that does not becomes an error, shown as "Check".
      parts.push(
        `IF(ISNUMBER(${boxes[k]}),IF(AND(${boxes[k]}>=${low},${boxes[k]}<=${top}),${boxes[k]},0/0),(${boxes[k]}<>"")*${high})`,
      )
    })
    if (mode === 'mark') {
      const filled = `COUNTA(${boxes.join(',')})`
      cells[markCol] = formula(`IF(${filled}=0,"",IF(${filled}>1,"Check",IFERROR(${parts.join('+')},"Check")))`, result)
      const names = levels.map((_, k) => `$${columnLetter(desc(k))}$${headerRow}`)
      const reached = levels.reduceRight((rest, _, k) => `IF(${boxes[k]}<>"",${names[k]},${rest})`, '""')
      cells[levelCol] = formula(`IF(${filled}<>1,"",${reached})`, { ...result, fontWeight: undefined, wrap: true })
    } else {
      cells[markCol] = empty(result)
    }
    rows.add(cells, heightFor(sized, 34))
  })

  const markRange = `${at(markCol, first)}:${at(markCol, last)}`
  const totalRow = rows.add({
    0: text('Total', { ...head, align: 'right' }),
    1: formula(`SUM(B${first}:B${last})`, { ...head, align: 'center' }),
    [markCol]:
      mode === 'mark'
        ? formula(`IF(COUNT(${markRange})<${rubric.criteria.length},"",SUM(${markRange}))`, result)
        : empty(result),
  })
  const total = at(markCol, totalRow)
  const { status } = closing(rows, rubric, mode, columns, {
    total,
    outOf: `$B$${totalRow}`,
    status: statusFormula(
      markRange,
      rubric.criteria.length,
      'Check: one box per criterion, and a mark that fits its level',
    ),
  })

  const shade: ShadeRule[] = []
  if (mode === 'mark') {
    levels.forEach((_, k) => {
      shade.push({
        from: { row: first, column: desc(k) + 1 },
        to: { row: last, column: desc(k) + 1 },
        formula: `${at(tick(k), first)}<>""`,
        style: { backgroundColor: CHOSEN },
      })
    })
    shade.push({
      from: { row: first, column: markCol + 1 },
      to: { row: last, column: markCol + 1 },
      formula: `${at(markCol, first)}="Check"`,
      style: { textColor: '#B3121D', fontWeight: 'bold' },
    })
  }
  return {
    name,
    data: rows.data as SheetData,
    widths,
    landscape: true,
    fitToWidth: true,
    stickyRows: 0,
    stickyColumns: 0,
    shade,
    ...(mode === 'mark'
      ? {
          refs: {
            name: NAME_REF,
            values: rubric.criteria.map((_, i) => at(markCol, first + i)),
            levels: rubric.criteria.map((_, i) => at(levelCol, first + i)),
            total,
            status,
          },
        }
      : {}),
  }
}

// ---------- Holistic ----------

function holisticSheet(rubric: Rubric, mode: Mode, learner: string, name: string): WorkbookSheet {
  const levels = rubric.levels
  const criterion = rubric.criteria[0]!
  const total = rubricTotal(rubric)
  const bands = levelBands(total, levels, rubric.showRanges)
  const widths = [22, 10, 62, 7]
  const columns = 4
  const rows = new Rows(columns)
  opening(rows, rubric, mode, learner, columns)
  rows.add(
    {
      0: text('Level', head),
      1: text('Marks', { ...head, align: 'center' }),
      2: text('What the work looks like', head),
      3: text(mode === 'mark' ? 'x' : 'Tick', { ...head, align: 'center' }),
    },
    24,
  )
  const first = rows.next
  const last = first + levels.length - 1
  const parts: string[] = []
  levels.forEach((l, k) => {
    const r = first + k
    const described = (criterion.descriptors[l.id] ?? '').trim()
    const band = bands[k]!
    const tickCell = at(3, r)
    rows.add(
      {
        0: text(l.name.trim(), { ...body, fontWeight: 'bold' }),
        1: text(bandLabel(band), { ...body, align: 'center' }),
        2: text(described, body),
        3: empty(box),
      },
      heightFor([{ value: described, width: widths[2]! }], 30),
    )
    const top = rubric.showRanges ? band.high : total
    parts.push(
      `IF(ISNUMBER(${tickCell}),IF(AND(${tickCell}>=${rubric.showRanges ? band.low : 0},${tickCell}<=${top}),${tickCell},0/0),(${tickCell}<>"")*${band.high})`,
    )
  })
  const boxes = `D${first}:D${last}`
  const markRow = rows.add({
    0: text('Mark', { ...head, align: 'right' }),
    1:
      mode === 'mark'
        ? formula(
            `IF(COUNTA(${boxes})=0,"",IF(COUNTA(${boxes})>1,"Check",IFERROR(${parts.join('+')},"Check")))`,
            result,
          )
        : empty(result),
    2: text('out of', { ...head, align: 'right', fontWeight: undefined }),
    3: number(total, { ...head, align: 'center' }),
  })
  const mark = at(1, markRow)
  const reached = levels.reduceRight((rest, _, k) => `IF(D${first + k}<>"",$A$${first + k},${rest})`, '""')
  const levelFormula = `IF(COUNTA(${boxes})<>1,"",${reached})`
  // The level reached sits in its own row, so the Summary can count learners per level.
  const levelRow = mode === 'mark' ? rows.next + extraRows(rubric) : 0
  const { status } = closing(rows, rubric, mode, columns, {
    total: mark,
    outOf: `$D$${markRow}`,
    status: statusFormula(mark, 1, 'Check: one box only, and a mark that fits its level'),
    extra: [{ label: 'Level reached', formula: levelFormula }],
  })
  return {
    name,
    data: rows.data as SheetData,
    widths,
    landscape: false,
    fitToWidth: true,
    stickyRows: 0,
    stickyColumns: 0,
    shade:
      mode === 'mark'
        ? [
            {
              from: { row: first, column: 3 },
              to: { row: last, column: 3 },
              formula: `D${first}<>""`,
              style: { backgroundColor: CHOSEN },
            },
          ]
        : [],
    ...(mode === 'mark'
      ? { refs: { name: NAME_REF, values: [mark], levels: [at(1, levelRow)], total: mark, status } }
      : {}),
  }
}

/** How many label rows closing() writes before its extra rows. */
function extraRows(rubric: Rubric): number {
  if (!givesMarks(rubric)) return 0
  return (
    (rubric.showPercent || rubric.showLevel ? 1 : 0) +
    (rubric.reportOutOf !== null ? 1 : 0) +
    (rubric.showLevel ? 1 : 0)
  )
}

// ---------- Single-point ----------

function singlePointSheet(rubric: Rubric, mode: Mode, learner: string, name: string): WorkbookSheet {
  const marks = criterionMarks(rubric)
  const scored = rubric.scored
  const widths = scored ? [30, 42, 30, 8, 8] : [30, 42, 30, 8, 5]
  const columns = 5
  const rows = new Rows(columns)
  opening(rows, rubric, mode, learner, columns)
  rows.add(
    {
      0: text('Not yet: what to work on', head),
      1: text('The expected standard', head),
      2: text('Beyond: where the work went further', head),
      3: text(scored ? 'Out of' : mode === 'mark' ? 'Met (x)' : 'Met', { ...head, align: 'center' }),
      4: scored ? text('Mark', { ...head, align: 'center' }) : null,
    },
    30,
  )
  const first = rows.next
  const last = first + rubric.criteria.length - 1
  rubric.criteria.forEach((criterion, i) => {
    const r = first + i
    const described = `${criterionLabel(rubric, i)}\n${(criterion.descriptors[TARGET] ?? '').trim()}`.trim()
    rows.add(
      {
        0: empty(body),
        1: text(described, body),
        2: empty(body),
        3: scored ? number(marks[i]!, { ...body, align: 'center', alignVertical: 'center' }) : empty(box),
        4: scored
          ? empty(box)
          : mode === 'mark'
            ? formula(`IF(D${r}<>"",1,0)`, { textColor: '#8A93A0', fontSize: 8, align: 'center' })
            : null,
      },
      heightFor([{ value: described, width: widths[1]! }], 58),
    )
  })
  const count = rubric.criteria.length
  let total: string
  let outOf: string
  let status: string
  if (scored) {
    const typed = `E${first}:E${last}`
    const row = rows.add({
      2: text('Total', { ...head, align: 'right' }),
      3: formula(`SUM(D${first}:D${last})`, { ...head, align: 'center' }),
      4:
        mode === 'mark'
          ? formula(
              `IF(OR(COUNT(${typed})<${count},SUMPRODUCT(--(${typed}>D${first}:D${last}))>0),"",SUM(${typed}))`,
              result,
            )
          : empty(result),
    })
    total = at(4, row)
    outOf = `$D$${row}`
    // Text in a mark box counts as above its maximum too, so it is caught here.
    status =
      `IF(SUMPRODUCT(--(${typed}>D${first}:D${last}))>0,"Check: a mark is above its maximum",` +
      `IF(COUNT(${typed})=0,"${NOT_MARKED}",` +
      `IF(COUNT(${typed})<${count},(${count}-COUNT(${typed}))&" still to mark","${MARKED}")))`
  } else {
    const row = rows.add({
      2: text('Criteria met', { ...head, align: 'right' }),
      3: mode === 'mark' ? formula(`COUNTA(D${first}:D${last})`, result) : empty(result),
      4: mode === 'mark' ? number(count, { textColor: '#8A93A0', fontSize: 8, align: 'center' }) : null,
    })
    total = at(3, row)
    outOf = `$E$${row}`
    status = `IF(COUNTA(A${first}:A${last})+COUNTA(C${first}:D${last})=0,"${NOT_MARKED}","${MARKED}")`
  }
  const closed = closing(rows, rubric, mode, columns, { total, outOf, status })
  return {
    name,
    data: rows.data as SheetData,
    widths,
    landscape: true,
    fitToWidth: true,
    stickyRows: 0,
    stickyColumns: 0,
    shade: [],
    ...(mode === 'mark'
      ? {
          refs: {
            name: NAME_REF,
            values: rubric.criteria.map((_, i) => at(4, first + i)),
            levels: [],
            total,
            status: closed.status,
          },
        }
      : {}),
  }
}

// ---------- Checklist ----------

function checklistSheet(rubric: Rubric, mode: Mode, learner: string, name: string): WorkbookSheet {
  const marks = criterionMarks(rubric)
  const widths = [62, 9, 9, 9]
  const columns = 4
  const rows = new Rows(columns)
  opening(rows, rubric, mode, learner, columns)
  rows.add(
    {
      0: text('The work has', head),
      1: text('Marks', { ...head, align: 'center' }),
      2: text(mode === 'mark' ? 'Done (x)' : 'Done', { ...head, align: 'center' }),
      3: text('Mark', { ...head, align: 'center' }),
    },
    24,
  )
  const first = rows.next
  const last = first + rubric.criteria.length - 1
  rubric.criteria.forEach((_, i) => {
    const r = first + i
    const label = criterionLabel(rubric, i)
    rows.add(
      {
        0: text(label, body),
        1: number(marks[i]!, { ...body, align: 'center' }),
        2: empty(box),
        3: mode === 'mark' ? formula(`IF(OR(C${r}="",C${r}&""="0"),0,B${r})`, result) : empty(result),
      },
      heightFor([{ value: label, width: widths[0]! }], 22),
    )
  })
  const done = `C${first}:C${last}`
  const row = rows.add({
    0: text('Total', { ...head, align: 'right' }),
    1: formula(`SUM(B${first}:B${last})`, { ...head, align: 'center' }),
    3: mode === 'mark' ? formula(`IF(COUNTA(${done})=0,"",SUM(D${first}:D${last}))`, result) : empty(result),
  })
  const total = at(3, row)
  const { status } = closing(rows, rubric, mode, columns, {
    total,
    outOf: `$B$${row}`,
    status: `IF(COUNTA(${done})=0,"${NOT_MARKED}","${MARKED}")`,
  })
  return {
    name,
    data: rows.data as SheetData,
    widths,
    landscape: false,
    fitToWidth: true,
    stickyRows: 0,
    stickyColumns: 0,
    shade:
      mode === 'mark'
        ? [
            {
              from: { row: first, column: 1 },
              to: { row: last, column: 1 },
              formula: `AND(C${first}<>"",C${first}&""<>"0")`,
              style: { backgroundColor: CHOSEN },
            },
          ]
        : [],
    ...(mode === 'mark'
      ? { refs: { name: NAME_REF, values: rubric.criteria.map((_, i) => at(3, first + i)), levels: [], total, status } }
      : {}),
  }
}

function rubricSheet(rubric: Rubric, mode: Mode, learner: string, name: string): WorkbookSheet {
  switch (rubric.style) {
    case 'analytic':
      return analyticSheet(rubric, mode, learner, name)
    case 'holistic':
      return holisticSheet(rubric, mode, learner, name)
    case 'single-point':
      return singlePointSheet(rubric, mode, learner, name)
    case 'checklist':
      return checklistSheet(rubric, mode, learner, name)
  }
}

// ---------- Summary ----------

const SUMMARY_HEADER_ROW = 3
const SUMMARY_OUT_OF_ROW = 4
const SUMMARY_FIRST_ROW = 5

function columnHeads(rubric: Rubric): string[] {
  if (rubric.style === 'holistic') return ['Mark']
  return rubric.criteria.map((c, i) => c.name.trim() || `Criterion ${i + 1}`)
}

function summarySheet(rubric: Rubric, learners: WorkbookSheet[]): WorkbookSheet {
  const heads = columnHeads(rubric)
  const marks =
    rubric.style === 'holistic'
      ? [rubricTotal(rubric)]
      : givesMarks(rubric)
        ? criterionMarks(rubric)
        : heads.map(() => 1)
  const scored = givesMarks(rubric)
  const single = heads.length === 1
  // Holistic has one mark, which is the total, so it gets no separate Total column.
  const firstCol = 2
  const totalCol = single ? firstCol : firstCol + heads.length
  let next = totalCol + 1
  const percentCol = scored ? next++ : -1
  const reportCol = scored && rubric.reportOutOf !== null ? next++ : -1
  const levelCol = scored && rubric.showLevel ? next++ : -1
  const statusCol = next++
  const columns = next
  const widths = Array.from({ length: columns }, (_, i) => {
    if (i === 0) return 5
    if (i === 1) return 26
    if (i === statusCol) return 24
    if (i >= firstCol && i < firstCol + heads.length) return Math.min(18, Math.max(9, heads[i - firstCol]!.length + 2))
    return 11
  })
  const rows = new Rows(columns)
  rows.add(
    {
      0: text(`${rubric.title.trim() || 'Rubric'}: class summary`, {
        fontWeight: 'bold',
        fontSize: 14,
        columnSpan: columns,
      }),
    },
    22,
  )
  rows.add({
    0: text('Filled in from the learner sheets. A learner counts once their sheet says Marked.', {
      fontStyle: 'italic',
      columnSpan: columns,
    }),
  })
  const header: Record<number, Cell> = { 0: text('No.', head), 1: text('Learner', head) }
  heads.forEach((h, i) => (header[firstCol + i] = text(h, { ...head, align: 'center' })))
  if (!single) header[totalCol] = text(scored ? 'Total' : 'Criteria met', { ...head, align: 'center' })
  if (percentCol >= 0) header[percentCol] = text('%', { ...head, align: 'center' })
  if (reportCol >= 0)
    header[reportCol] = text(`Out of ${formatNumber(rubric.reportOutOf!)}`, { ...head, align: 'center' })
  if (levelCol >= 0) header[levelCol] = text('CAPS level', { ...head, align: 'center' })
  header[statusCol] = text('Status', head)
  rows.add(header, 32)

  const outOf: Record<number, Cell> = {
    1: text('Out of', { fontWeight: 'bold', align: 'right', bottomBorderStyle: 'thin' }),
  }
  marks.forEach(
    (m, i) => (outOf[firstCol + i] = number(m, { fontWeight: 'bold', align: 'center', bottomBorderStyle: 'thin' })),
  )
  if (!single) {
    outOf[totalCol] = formula(`SUM(${at(firstCol, SUMMARY_OUT_OF_ROW)}:${at(totalCol - 1, SUMMARY_OUT_OF_ROW)})`, {
      fontWeight: 'bold',
      align: 'center',
      bottomBorderStyle: 'thin',
    })
  }
  rows.add(outOf)

  const first = SUMMARY_FIRST_ROW
  const last = first + learners.length - 1
  const totalOutOf = `${columnLetter(totalCol)}$${SUMMARY_OUT_OF_ROW}`
  learners.forEach((sheet, i) => {
    const r = first + i
    const refs = sheet.refs!
    const on = (cell: string) => sheetRef(sheet.name, cell)
    const marked = `${on(refs.status)}="${MARKED}"`
    const cells: Record<number, Cell> = {
      0: number(i + 1),
      1: formula(`IF(${on(refs.name)}="","",${on(refs.name)})`),
    }
    refs.values.forEach((ref, k) => {
      cells[firstCol + k] = formula(`IF(${marked},${on(ref)},"")`, { align: 'center' })
    })
    if (!single)
      cells[totalCol] = formula(`IF(${marked},${on(refs.total)},"")`, { align: 'center', fontWeight: 'bold' })
    const total = at(totalCol, r)
    if (percentCol >= 0) {
      cells[percentCol] = formula(`IF(ISNUMBER(${total}),${total}/${totalOutOf},"")`, {
        align: 'center',
        format: '0.0%',
      })
    }
    if (reportCol >= 0) {
      cells[reportCol] = formula(`IF(ISNUMBER(${total}),ROUND(${total}/${totalOutOf}*${rubric.reportOutOf},1),"")`, {
        align: 'center',
      })
    }
    if (levelCol >= 0) {
      cells[levelCol] = formula(
        `IFERROR(LOOKUP(${at(percentCol, r)}*100,{${LEVEL_FLOORS.join(',')}},{1,2,3,4,5,6,7}),"")`,
        { align: 'center' },
      )
    }
    cells[statusCol] = formula(on(refs.status), { fontStyle: 'italic' })
    rows.add(cells)
  })

  rows.add()
  const range = (col: number) => `${at(col, first)}:${at(col, last)}`
  const numeric = [...heads.map((_, i) => firstCol + i), ...(single ? [] : [totalCol])]
  const bold: Style = { fontWeight: 'bold', align: 'center' }
  const stat = (label: string, make: (col: number) => Cell, extra: Record<number, Cell> = {}): number => {
    const cells: Record<number, Cell> = { 1: text(label, { fontWeight: 'bold' }), ...extra }
    for (const col of numeric) cells[col] = make(col)
    return rows.add(cells)
  }
  const averageRow = stat(
    'Class average',
    (col) => formula(`IF(COUNT(${range(col)})=0,"",AVERAGE(${range(col)}))`, { ...bold, format: '0.0' }),
    percentCol >= 0
      ? {
          [percentCol]: formula(`IF(COUNT(${range(percentCol)})=0,"",AVERAGE(${range(percentCol)}))`, {
            ...bold,
            format: '0.0%',
          }),
        }
      : {},
  )
  const shareRow = stat('Average as a %', (col) =>
    formula(`IF(ISNUMBER(${at(col, averageRow)}),${at(col, averageRow)}/${at(col, SUMMARY_OUT_OF_ROW)},"")`, {
      ...bold,
      format: '0%',
    }),
  )
  stat('Highest', (col) => formula(`IF(COUNT(${range(col)})=0,"",MAX(${range(col)}))`, bold))
  stat('Lowest', (col) => formula(`IF(COUNT(${range(col)})=0,"",MIN(${range(col)}))`, bold))
  rows.add({
    1: text('Learners marked', { fontWeight: 'bold' }),
    [firstCol]: formula(`COUNTIF(${range(statusCol)},"${MARKED}")`, bold),
    [firstCol + 1]: text(`of ${learners.length}`),
  })

  if (heads.length > 1) {
    const shares = `${at(firstCol, shareRow)}:${at(firstCol + heads.length - 1, shareRow)}`
    const names = `${at(firstCol, SUMMARY_HEADER_ROW)}:${at(firstCol + heads.length - 1, SUMMARY_HEADER_ROW)}`
    const pick = (fn: 'MAX' | 'MIN') =>
      formula(`IF(COUNT(${shares})=0,"",INDEX(${names},MATCH(${fn}(${shares}),${shares},0)))`, {
        fontWeight: 'bold',
        columnSpan: Math.min(3, columns - firstCol),
      })
    rows.add()
    rows.add({ 1: text('Strongest', { fontWeight: 'bold' }), [firstCol]: pick('MAX') })
    rows.add({ 1: text('Needs the most work', { fontWeight: 'bold' }), [firstCol]: pick('MIN') })
  }

  if (usesLevels(rubric.style)) {
    rows.add()
    rows.add({ 1: text('Learners at each level', { fontWeight: 'bold', bottomBorderStyle: 'thin' }) })
    for (const level of rubric.levels) {
      const r = rows.next
      const cells: Record<number, Cell> = { 1: text(level.name.trim()) }
      heads.forEach((_, i) => {
        const col = columnLetter(firstCol + i)
        cells[firstCol + i] = formula(
          `COUNTIF(${sheetRef(LEVELS_SHEET, `${col}$${LEVELS_FIRST_ROW}:${col}$${LEVELS_FIRST_ROW + learners.length - 1}`)},$B${r})`,
          { align: 'center' },
        )
      })
      rows.add(cells)
    }
  }

  return {
    name: SUMMARY_SHEET,
    data: rows.data as SheetData,
    widths,
    landscape: columns > 9,
    fitToWidth: true,
    stickyRows: SUMMARY_OUT_OF_ROW,
    stickyColumns: 2,
    shade: [],
  }
}

const RUBRIC_SHEET = 'Rubric'
const SUMMARY_SHEET = 'Summary'
const LEVELS_SHEET = 'Levels'
const NOTES_SHEET = 'Notes'
const LEVELS_FIRST_ROW = 3

/** The level each learner reached per criterion, which the Summary counts. */
function levelsSheet(rubric: Rubric, learners: WorkbookSheet[]): WorkbookSheet {
  const heads = rubric.style === 'holistic' ? ['Level reached'] : columnHeads(rubric)
  const columns = 2 + heads.length
  const rows = new Rows(columns)
  rows.add(
    {
      0: text(`${rubric.title.trim() || 'Rubric'}: level reached per criterion`, {
        fontWeight: 'bold',
        fontSize: 14,
        columnSpan: columns,
      }),
    },
    22,
  )
  const header: Record<number, Cell> = { 0: text('No.', head), 1: text('Learner', head) }
  heads.forEach((h, i) => (header[2 + i] = text(h, head)))
  rows.add(header, 32)
  learners.forEach((sheet, i) => {
    const refs = sheet.refs!
    const on = (cell: string) => sheetRef(sheet.name, cell)
    const cells: Record<number, Cell> = {
      0: number(i + 1),
      1: formula(`IF(${on(refs.name)}="","",${on(refs.name)})`),
    }
    refs.levels.forEach((ref, k) => {
      cells[2 + k] = formula(`IF(${on(refs.status)}="${MARKED}",${on(ref)},"")`)
    })
    rows.add(cells)
  })
  return {
    name: LEVELS_SHEET,
    data: rows.data as SheetData,
    widths: [5, 26, ...heads.map(() => 20)],
    landscape: columns > 6,
    fitToWidth: true,
    stickyRows: 2,
    stickyColumns: 2,
    shade: [],
  }
}

function notesSheet(rubric: Rubric, learners: number): WorkbookSheet {
  const lines: string[] = [`${rubric.title.trim() || 'Rubric'}: how this workbook works`, '']
  lines.push('The Rubric sheet is the rubric on its own, ready to print or hand out.')
  if (learners > 0) {
    lines.push(
      `There is a sheet for each of the ${learners} learners. ${HOW_TO_MARK[rubric.style]}`,
      'The yellow boxes are the only cells to type in. Everything else is worked out by formulas.',
    )
    if (usesLevels(rubric.style)) {
      lines.push(
        'The chosen level is shaded. More than one box for a criterion, or a typed mark that does not fit the level, shows Check.',
      )
      if (rubric.style === 'analytic') {
        lines.push(
          "The share of the marks under each level's name sets what that level is worth. Change it, or a criterion's marks, on a learner sheet and that sheet's formulas follow. The marks in brackets in each descriptor are plain text and do not change.",
        )
      }
    }
    lines.push(
      'Status says Marked once a sheet is complete. Only then does the learner count on the Summary sheet, so half-marked work never pulls the averages down.',
      'A learner who did not hand in stays Not marked yet and is left out of every average.',
    )
    if (rubric.showSummary) {
      lines.push(
        'The Summary sheet has every learner in one table, with the class average, highest and lowest per criterion' +
          (rubric.criteria.length > 1 && rubric.style !== 'holistic'
            ? ', and names the strongest criterion and the one that needs the most work.'
            : '.'),
      )
      if (usesLevels(rubric.style))
        lines.push('It also counts how many learners reached each level, from the Levels sheet.')
    }
    lines.push('Each learner sheet prints on one page, as feedback to hand back.')
  }
  lines.push('', 'Made with Red Pen. Nothing was uploaded.')
  return {
    name: NOTES_SHEET,
    data: lines.map((line, i) => [
      line === '' ? null : i === 0 ? { value: line, fontWeight: 'bold' } : { value: line, wrap: true },
    ]) as SheetData,
    widths: [110],
    landscape: false,
    fitToWidth: false,
    stickyRows: 0,
    stickyColumns: 0,
    shade: [],
  }
}

export const MAX_LEARNERS = 120

/**
 * The whole workbook. With no learners, or marking turned off, it is the Rubric sheet alone.
 * Learner sheets are numbered ("01 Thandi Mokoena"), so two learners with one name never clash.
 */
export function buildWorkbook(rubric: Rubric, learners: readonly WorkbookLearner[] = []): WorkbookSheet[] {
  const print = rubricSheet(rubric, 'print', '', RUBRIC_SHEET)
  const list = rubric.marking ? learners.slice(0, MAX_LEARNERS) : []
  if (list.length === 0) return [print]
  const digits = Math.max(2, String(list.length).length)
  const sheets = list.map((learner, i) => {
    const no = String(i + 1).padStart(digits, '0')
    const name = sheetName(`${no} ${learner.name.trim() || 'Learner'}`, `${no} Learner`)
    return rubricSheet(rubric, 'mark', learner.name.trim(), name)
  })
  const out: WorkbookSheet[] = [print]
  if (rubric.showSummary) {
    out.push(summarySheet(rubric, sheets))
    if (usesLevels(rubric.style)) out.push(levelsSheet(rubric, sheets))
  }
  out.push(...sheets, notesSheet(rubric, list.length))
  return out
}

/** Makes a sheet print on one page across, however long it runs. */
export function fitToWidthXml(xml: string): string {
  let out = xml
  if (!out.includes('<sheetPr')) {
    out = out.replace(/<worksheet\b[^>]*>/, (open) => `${open}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`)
  }
  if (/<pageSetup\b/.test(out)) {
    out = out.replace(/<pageSetup\b/, '<pageSetup fitToWidth="1" fitToHeight="0"')
  } else {
    // A portrait sheet has no page setup yet. It goes last: these sheets have no drawings or tables.
    out = out.replace(
      '</worksheet>',
      '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>',
    )
  }
  return out
}

export async function writeWorkbook(sheets: WorkbookSheet[]): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const blob = await writeXlsxFile(
    sheets.map((s) => ({
      data: s.data,
      sheet: s.name,
      columns: s.widths.map((width) => ({ width })),
      ...(s.landscape ? { orientation: 'landscape' as const } : {}),
      ...(s.stickyRows ? { stickyRowsCount: s.stickyRows } : {}),
      ...(s.stickyColumns ? { stickyColumnsCount: s.stickyColumns } : {}),
      ...(s.shade.length > 0
        ? {
            conditionalFormatting: s.shade.map((rule) => ({
              cellRange: { from: rule.from, to: rule.to },
              condition: { formula: rule.formula },
              style: rule.style,
            })),
          }
        : {}),
    })),
    {
      features: [
        {
          files: {
            transform: {
              'xl/worksheets/sheet{id}.xml': {
                transform: (xml: string, _options: unknown, { sheetIndex }: { sheetIndex: number }) =>
                  sheets[sheetIndex]?.fitToWidth ? fitToWidthXml(xml) : xml,
              },
            },
          },
        },
      ],
    },
  ).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
