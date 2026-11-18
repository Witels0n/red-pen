// A Rubric: its style, levels, criteria and weights, and what its Excel file should hold.
// Never holds learner names, so it can be saved freely in this browser.

import { cognitiveById, isCognitiveId, type CognitiveId } from './cognitive'
import { isScaleId, scaleById, type ScaleId } from './scales'

export type RubricStyle = 'analytic' | 'holistic' | 'single-point' | 'checklist'

export const STYLES: readonly { id: RubricStyle; name: string; description: string }[] = [
  {
    id: 'analytic',
    name: 'Analytic',
    description:
      'Criteria down the side, levels across the top and a descriptor in every box. Each criterion gets its own mark, so learners see exactly where they gained and lost.',
  },
  {
    id: 'holistic',
    name: 'Holistic',
    description:
      'One scale for the whole piece of work, with a descriptor per level. Quick to mark, best for short tasks where one overall judgement is enough.',
  },
  {
    id: 'single-point',
    name: 'Single-point',
    description:
      'Only the expected standard is described for each criterion, with space either side to write what fell short and what went beyond. Best for feedback.',
  },
  {
    id: 'checklist',
    name: 'Checklist',
    description: 'A list of things the work must have. Each one is either there or not.',
  },
]

export interface Level {
  id: string
  name: string
  /** The share of a criterion's marks earned at (the top of) this level, in percent. */
  percent: number
}

export interface Criterion {
  id: string
  name: string
  /** Marks, or a percentage of the total, depending on the Rubric's weightMode. */
  weight: number
  /** A level of the Rubric's cognitive taxonomy, by name. */
  cognitive: string | null
  /**
   * Descriptor text by level id. A single-point rubric keeps its one descriptor under TARGET.
   * A holistic rubric has one criterion, whose descriptors describe the whole piece of work.
   */
  descriptors: Record<string, string>
}

/** The key of a single-point criterion's descriptor of the expected standard. */
export const TARGET = 'target'

export type WeightMode = 'marks' | 'percent'

export interface Rubric {
  version: 1
  style: RubricStyle
  title: string
  /** An optional line under the title: the task, the grade, the date. */
  task: string
  /** The scale the levels started from, for the prompts in empty descriptor boxes. */
  scaleId: ScaleId
  levels: Level[]
  /** Show and mark each level as a band of marks (8-10) instead of one mark. */
  showRanges: boolean
  criteria: Criterion[]
  weightMode: WeightMode
  /** What the rubric is out of when the weights are percentages. */
  total: number
  taxonomy: CognitiveId
  /** Single-point only: whether each criterion gets a mark. */
  scored: boolean
  /** Add a sheet per learner for marking in Excel. */
  marking: boolean
  showPercent: boolean
  /** Also report the mark out of this (for example a rubric out of 32 reported out of 20). */
  reportOutOf: number | null
  /** The CAPS achievement level (1 to 7) of the percentage. */
  showLevel: boolean
  showSummary: boolean
}

export const MAX_LEVELS = 8
export const MAX_CRITERIA = 30

let counter = 0
/** A short id, unique within this page. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function usesLevels(style: RubricStyle): boolean {
  return style === 'analytic' || style === 'holistic'
}

/** Whether the rubric gives marks at all. Only an unscored single-point rubric does not. */
export function givesMarks(rubric: Rubric): boolean {
  return rubric.style !== 'single-point' || rubric.scored
}

/** Fresh levels from a scale, with stable ids ("l1" is the first). */
export function levelsFromScale(id: ScaleId): Level[] {
  return scaleById(id).levels.map((l, i) => ({ id: `l${i + 1}`, name: l.name, percent: l.percent }))
}

/** The prompt for an empty descriptor box: what the scale says work at this level looks like. */
export function levelHint(rubric: Rubric, level: Level): string {
  return scaleById(rubric.scaleId).levels.find((l) => l.name === level.name)?.hint ?? ''
}

const ORAL: [string, number, string, string[]][] = [
  [
    'Content',
    8,
    'Understand',
    [
      'Accurate and detailed. Shows real insight into the topic and answers questions with confidence.',
      'Accurate and covers the topic. Answers most questions correctly.',
      'Mostly accurate but thin in places. Struggles with some questions.',
      'Little relevant content, or serious errors.',
    ],
  ],
  [
    'Structure',
    4,
    'Apply',
    [
      'A clear opening, a logical order and a strong ending. Easy to follow from start to finish.',
      'Has an opening, a middle and an ending in a sensible order.',
      'Some order, but the listener sometimes loses the thread.',
      'No clear order.',
    ],
  ],
  [
    'Delivery',
    4,
    'Apply',
    [
      'Speaks clearly and at a good pace, looks at the audience and hardly needs notes.',
      'Speaks clearly and looks up from notes often.',
      'Audible, but reads most of it from notes.',
      'Hard to hear or to follow.',
    ],
  ],
  [
    'Language',
    4,
    'Apply',
    [
      'Precise subject vocabulary, used correctly and explained where needed.',
      'Correct subject vocabulary, with only small slips.',
      'Everyday words where subject terms are needed.',
      'Language gets in the way of the meaning.',
    ],
  ],
]

const HOLISTIC_EXAMPLE = [
  'Answers the question fully, with accurate detail and a clear line of reasoning.',
  'Answers the question with accurate content. Reasoning is mostly clear.',
  'Answers part of the question. Some content is inaccurate or missing.',
  'Does not answer the question, or has very little relevant content.',
]

function blank(style: RubricStyle, scaleId: ScaleId): Rubric {
  const scale = scaleById(scaleId)
  return {
    version: 1,
    style,
    title: 'Rubric',
    task: '',
    scaleId,
    levels: usesLevels(style) ? levelsFromScale(scaleId) : [],
    showRanges: usesLevels(style) && scale.ranges,
    criteria: [],
    weightMode: 'marks',
    total: 20,
    taxonomy: 'none',
    scored: true,
    marking: true,
    showPercent: true,
    reportOutOf: null,
    showLevel: false,
    showSummary: true,
  }
}

/**
 * A new Rubric with a small worked example, so the first thing a teacher sees is how the style
 * works. Ids are stable ("c1", "l1", ...) so tests can rely on them.
 */
export function newRubric(style: RubricStyle, scaleId: ScaleId = 'four'): Rubric {
  const r = blank(style, scaleId)
  const worked = scaleId === 'four'
  switch (style) {
    case 'analytic':
      r.title = 'Oral presentation'
      r.criteria = ORAL.map(([name, weight, , texts], i) => ({
        id: `c${i + 1}`,
        name,
        weight,
        cognitive: null,
        descriptors: worked ? Object.fromEntries(r.levels.map((l, k) => [l.id, texts[k] ?? ''])) : {},
      }))
      break
    case 'holistic':
      r.title = 'Paragraph answer'
      r.criteria = [
        {
          id: 'c1',
          name: 'Overall',
          weight: 10,
          cognitive: null,
          descriptors: worked ? Object.fromEntries(r.levels.map((l, k) => [l.id, HOLISTIC_EXAMPLE[k] ?? ''])) : {},
        },
      ]
      break
    case 'single-point':
      r.title = 'Argument paragraph'
      r.criteria = [
        ['Claim', 'States a clear position that answers the question.'],
        ['Evidence', 'Supports the claim with at least two relevant, accurate pieces of evidence.'],
        ['Reasoning', 'Explains how the evidence supports the claim.'],
      ].map(([name, text], i) => ({
        id: `c${i + 1}`,
        name: name!,
        weight: 4,
        cognitive: null,
        descriptors: { [TARGET]: text! },
      }))
      break
    case 'checklist':
      r.title = 'Practical write-up'
      r.criteria = (
        [
          ['Aim is stated', 1],
          ['Hypothesis is given', 1],
          ['Variables are identified', 3],
          ['Results are in a labelled table', 3],
          ['Conclusion refers back to the hypothesis', 2],
        ] as [string, number][]
      ).map(([name, weight], i) => ({ id: `c${i + 1}`, name, weight, cognitive: null, descriptors: {} }))
      break
  }
  return r
}

// ---------- Marks ----------

/** "37.5" or "40": a number the way the page and the sheet show it. */
export function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function sum(values: number[]): number {
  return values.reduce((t, v) => t + v, 0)
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** Each criterion's marks, in order, whichever way the weights were entered. */
export function criterionMarks(rubric: Rubric): number[] {
  if (rubric.weightMode === 'marks') return rubric.criteria.map((c) => finite(c.weight))
  return rubric.criteria.map((c) => Math.round(finite(rubric.total) * finite(c.weight)) / 100)
}

/** What the rubric is out of. An unscored single-point rubric counts its criteria. */
export function rubricTotal(rubric: Rubric): number {
  if (!givesMarks(rubric)) return rubric.criteria.length
  return Math.round(sum(criterionMarks(rubric)) * 100) / 100
}

/** Each criterion's share of the total, in percent. */
export function criterionShares(rubric: Rubric): number[] {
  const marks = criterionMarks(rubric)
  const total = sum(marks)
  return marks.map((m) => (total > 0 ? (m / total) * 100 : 0))
}

export interface Band {
  /** The lowest and highest mark of the level. The same number when ranges are off. */
  low: number
  high: number
}

/**
 * The marks of each level for a criterion worth `marks`, in the order of `levels`.
 * Without ranges a level is worth exactly its share. With ranges the shares are rounded to whole
 * marks and each level runs from one mark above the level below it; the lowest level starts at 0.
 */
export function levelBands(marks: number, levels: readonly Level[], ranges: boolean): Band[] {
  if (!ranges) {
    return levels.map((l) => {
      const v = Math.round(marks * finite(l.percent)) / 100
      return { low: v, high: v }
    })
  }
  const byWorth = levels.map((l, i) => ({ i, high: Math.round((marks * finite(l.percent)) / 100) }))
  byWorth.sort((a, b) => a.high - b.high)
  const bands: Band[] = levels.map(() => ({ low: 0, high: 0 }))
  byWorth.forEach((entry, k) => {
    const below = k === 0 ? null : byWorth[k - 1]!.high
    const low = below === null ? 0 : Math.min(entry.high, below + 1)
    bands[entry.i] = { low, high: entry.high }
  })
  return bands
}

/** "7.5", or "8-10" for a band. */
export function bandLabel(band: Band): string {
  return band.low === band.high ? formatNumber(band.high) : `${formatNumber(band.low)}-${formatNumber(band.high)}`
}

/** Splits `total` into `count` parts as evenly as whole marks allow, larger parts first. */
export function shareEvenly(count: number, total: number): number[] {
  if (count <= 0) return []
  return scaleToTotal(
    Array.from({ length: count }, () => 1),
    total,
  )
}

/**
 * Rescales `values` in proportion so they add up to exactly `total`, in whole numbers when the
 * total is whole (the leftover marks go to the values that lost the most to rounding down).
 */
export function scaleToTotal(values: readonly number[], total: number): number[] {
  const clean = values.map((v) => Math.max(0, finite(v)))
  const current = sum(clean)
  if (!(total > 0) || clean.length === 0) return [...clean]
  const exact = current > 0 ? clean.map((v) => (v * total) / current) : clean.map(() => total / clean.length)
  if (!Number.isInteger(total)) return exact.map((v) => Math.round(v * 100) / 100)
  const floors = exact.map(Math.floor)
  let left = total - sum(floors)
  const order = exact.map((v, i) => ({ i, lost: v - Math.floor(v) })).sort((a, b) => b.lost - a.lost || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i]! += 1
    left -= 1
  }
  return floors
}

/** How the marks are spread across the cognitive levels in use, in taxonomy order. */
export function cognitiveShares(rubric: Rubric): { level: string; marks: number; percent: number }[] {
  const taxonomy = cognitiveById(rubric.taxonomy)
  const marks = criterionMarks(rubric)
  const total = sum(marks)
  const rows = [...taxonomy.levels, null].map((level) => {
    const here = sum(marks.filter((_, i) => (rubric.criteria[i]!.cognitive ?? null) === level))
    return { level: level ?? 'No level', marks: here, percent: total > 0 ? (here / total) * 100 : 0 }
  })
  return rows.filter((r) => r.marks > 0)
}

// ---------- Checks ----------

export interface RubricCheck {
  /** Stop the download: the file would not work. */
  errors: string[]
  /** The file works, but probably not as intended. */
  warnings: string[]
}

const WHAT: Record<RubricStyle, string> = {
  analytic: 'criterion',
  holistic: 'criterion',
  'single-point': 'criterion',
  checklist: 'item',
}

/** Everything wrong with a Rubric, worded for the teacher. */
export function checkRubric(rubric: Rubric): RubricCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const what = WHAT[rubric.style]
  const Label = what === 'item' ? 'Item' : 'Criterion'

  if (rubric.criteria.length === 0) errors.push(`Add at least one ${what}.`)
  if (rubric.criteria.length > MAX_CRITERIA) errors.push(`A rubric can have at most ${MAX_CRITERIA} ${what}s.`)

  const scored = givesMarks(rubric)
  rubric.criteria.forEach((c, i) => {
    const label = c.name.trim() || `${Label} ${i + 1}`
    if (rubric.style !== 'holistic' && c.name.trim() === '') errors.push(`${Label} ${i + 1} needs a name.`)
    if (scored && !(Number.isFinite(c.weight) && c.weight > 0)) {
      errors.push(
        rubric.weightMode === 'percent' && rubric.style !== 'holistic'
          ? `${label} needs a weight above 0%.`
          : `${label} needs marks above 0.`,
      )
    }
  })

  if (usesLevels(rubric.style)) {
    if (rubric.levels.length < 2) errors.push('Add at least two levels.')
    if (rubric.levels.length > MAX_LEVELS) errors.push(`A rubric can have at most ${MAX_LEVELS} levels.`)
    rubric.levels.forEach((l, i) => {
      const label = l.name.trim() || `Level ${i + 1}`
      if (l.name.trim() === '') errors.push(`Level ${i + 1} needs a name.`)
      if (!(Number.isFinite(l.percent) && l.percent >= 0 && l.percent <= 100)) {
        errors.push(`${label} must be worth from 0% to 100% of the marks.`)
      }
    })
    const names = rubric.levels.map((l) => l.name.trim().toLowerCase()).filter((n) => n !== '')
    if (new Set(names).size < names.length) errors.push('Two levels have the same name.')
    const worths = rubric.levels.map((l) => l.percent)
    if (new Set(worths).size < worths.length) warnings.push('Two levels are worth the same share of the marks.')
    if (rubric.levels.length >= 2 && !worths.includes(100)) {
      warnings.push('No level is worth 100%, so nobody can get full marks.')
    }
    if (rubric.showRanges) {
      const marks = criterionMarks(rubric)
      rubric.criteria.forEach((c, i) => {
        const highs = rubric.levels.map((l) => Math.round((marks[i]! * l.percent) / 100))
        if (new Set(highs).size < highs.length) {
          warnings.push(
            `${c.name.trim() || `${Label} ${i + 1}`} has too few marks for every level to have its own band of whole marks.`,
          )
        }
      })
    }
    const empty = rubric.criteria.reduce(
      (n, c) => n + rubric.levels.filter((l) => (c.descriptors[l.id] ?? '').trim() === '').length,
      0,
    )
    if (empty > 0) warnings.push(`${empty} descriptor ${empty === 1 ? 'box is' : 'boxes are'} still empty.`)
  }

  if (rubric.style === 'single-point') {
    const empty = rubric.criteria.filter((c) => (c.descriptors[TARGET] ?? '').trim() === '').length
    if (empty > 0) warnings.push(`${empty} ${empty === 1 ? 'criterion has' : 'criteria have'} no descriptor yet.`)
  }

  if (scored && rubric.weightMode === 'percent' && rubric.style !== 'holistic') {
    if (!(Number.isFinite(rubric.total) && rubric.total > 0)) errors.push('The rubric needs a total above 0.')
    const total = sum(rubric.criteria.map((c) => finite(c.weight)))
    if (rubric.criteria.length > 0 && Math.abs(total - 100) > 1e-6) {
      warnings.push(`The weights add up to ${formatNumber(total)}%, not 100%.`)
    }
  }
  if (rubric.reportOutOf !== null && !(Number.isFinite(rubric.reportOutOf) && rubric.reportOutOf > 0)) {
    errors.push('"Also report out of" must be above 0, or empty.')
  }
  return { errors, warnings }
}

// ---------- Saving and loading ----------

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function isStyle(value: unknown): value is RubricStyle {
  return STYLES.some((s) => s.id === value)
}

type Bag = Record<string, unknown>

function bags(value: unknown): Bag[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is Bag => typeof x === 'object' && x !== null && typeof (x as Bag).id === 'string')
}

/** Reads a Rubric back from JSON, or null if it is not one. Unknown fields are dropped. */
export function parseRubric(value: unknown): Rubric | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Bag
  if (v.version !== 1 || !isStyle(v.style) || !Array.isArray(v.criteria)) return null
  const fallback = blank(v.style, isScaleId(v.scaleId) ? v.scaleId : 'custom')
  const levels: Level[] = usesLevels(v.style)
    ? bags(v.levels)
        .slice(0, MAX_LEVELS)
        .map((l) => ({ id: l.id as string, name: text(l.name, '', 40), percent: num(l.percent, 0) }))
    : []
  const taxonomy = isCognitiveId(v.taxonomy) ? v.taxonomy : 'none'
  const allowed = new Set(cognitiveById(taxonomy).levels)
  const keys = new Set([...levels.map((l) => l.id), TARGET])
  const criteria: Criterion[] = bags(v.criteria)
    .slice(0, MAX_CRITERIA)
    .map((c) => {
      const descriptors: Record<string, string> = {}
      if (typeof c.descriptors === 'object' && c.descriptors !== null) {
        for (const [key, body] of Object.entries(c.descriptors as Bag)) {
          if (keys.has(key) && typeof body === 'string') descriptors[key] = body.slice(0, 600)
        }
      }
      return {
        id: c.id as string,
        name: text(c.name, '', 120),
        weight: num(c.weight, 0),
        cognitive: typeof c.cognitive === 'string' && allowed.has(c.cognitive) ? c.cognitive : null,
        descriptors,
      }
    })
  return {
    version: 1,
    style: v.style,
    title: text(v.title, fallback.title, 80),
    task: text(v.task, '', 160),
    scaleId: fallback.scaleId,
    levels,
    showRanges: usesLevels(v.style) && bool(v.showRanges, false),
    criteria: v.style === 'holistic' ? criteria.slice(0, 1) : criteria,
    weightMode: v.weightMode === 'percent' ? 'percent' : 'marks',
    total: num(v.total, fallback.total),
    taxonomy,
    scored: bool(v.scored, true),
    marking: bool(v.marking, true),
    showPercent: bool(v.showPercent, true),
    reportOutOf: typeof v.reportOutOf === 'number' && Number.isFinite(v.reportOutOf) ? v.reportOutOf : null,
    showLevel: bool(v.showLevel, false),
    showSummary: bool(v.showSummary, true),
  }
}

/** A Rubric saved by name in this browser. */
export interface SavedRubric {
  name: string
  savedAt: number
  rubric: Rubric
}

/** Reads the saved Rubrics list, skipping anything damaged. */
export function parseSavedRubrics(value: unknown): SavedRubric[] {
  if (!Array.isArray(value)) return []
  const out: SavedRubric[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Bag
    const rubric = parseRubric(r.rubric)
    if (!rubric || typeof r.name !== 'string') continue
    out.push({ name: r.name, savedAt: num(r.savedAt, 0), rubric })
  }
  return out
}

/** Adds or replaces (by name, ignoring case) a saved Rubric. Newest first. */
export function upsertSaved(list: SavedRubric[], entry: SavedRubric): SavedRubric[] {
  const key = entry.name.trim().toLowerCase()
  return [entry, ...list.filter((s) => s.name.trim().toLowerCase() !== key)]
}
