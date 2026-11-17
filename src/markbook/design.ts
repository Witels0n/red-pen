// A Markbook design: the assessments, Categories, weights and calculated columns of a markbook.
// Never holds learner names, so it can be saved freely in this browser.

export interface Category {
  id: string
  name: string
  /** Share of the weighted mark, in percent. Category weights should add up to 100. */
  weight: number
}

export interface Assessment {
  id: string
  name: string
  /** The maximum mark, for example 50. */
  outOf: number
  /**
   * In percent. Without Categories: the share of the weighted mark (all add up to 100).
   * With Categories: the share of its Category (each Category's assessments add up to 100).
   */
  weight: number
  /** The Category it counts toward. Ignored when the design has no Categories. */
  categoryId: string | null
}

/** How the reported mark is rounded. The unrounded mark is always kept as well. */
export type Rounding = 'none' | 'whole' | 'one'

export interface MarkbookDesign {
  version: 1
  title: string
  /** The name of the weighted mark column, for example "Term mark". */
  markLabel: string
  useCategories: boolean
  categories: Category[]
  assessments: Assessment[]
  showPercentages: boolean
  rounding: Rounding
  showLevel: boolean
  showResult: boolean
  /** In percent. */
  passMark: number
  showSummary: boolean
}

export type PresetId = 'caps-fet' | 'term' | 'blank'

export const PRESETS: readonly { id: PresetId; name: string; description: string }[] = [
  {
    id: 'caps-fet',
    name: 'CAPS FET: SBA 25%, final exam 75%',
    description: "Grade 10 to 12 style: SBA tasks and the year-end papers. Check your subject's CAPS weights.",
  },
  {
    id: 'term',
    name: 'Term mark: tests, assignments and exam',
    description: 'Tests 40%, assignments 20% and the exam 40%.',
  },
  { id: 'blank', name: 'Blank', description: 'One assessment and no Categories, to build your own.' },
]

let counter = 0
/** A short id, unique within this page. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function base(title: string): MarkbookDesign {
  return {
    version: 1,
    title,
    markLabel: 'Term mark',
    useCategories: false,
    categories: [],
    assessments: [],
    showPercentages: true,
    rounding: 'whole',
    showLevel: true,
    showResult: true,
    passMark: 50,
    showSummary: true,
  }
}

/** A fresh design from a preset. Ids are stable ("c1", "a1", ...) so tests can rely on them. */
export function presetDesign(id: PresetId): MarkbookDesign {
  if (id === 'blank') {
    const d = base('Markbook')
    d.assessments = [{ id: 'a1', name: 'Task 1', outOf: 50, weight: 100, categoryId: null }]
    return d
  }
  if (id === 'term') {
    const d = base('Term 1 markbook')
    d.useCategories = true
    d.categories = [
      { id: 'c1', name: 'Tests', weight: 40 },
      { id: 'c2', name: 'Assignments', weight: 20 },
      { id: 'c3', name: 'Exam', weight: 40 },
    ]
    d.assessments = [
      { id: 'a1', name: 'Test 1', outOf: 50, weight: 50, categoryId: 'c1' },
      { id: 'a2', name: 'Test 2', outOf: 50, weight: 50, categoryId: 'c1' },
      { id: 'a3', name: 'Assignment', outOf: 40, weight: 100, categoryId: 'c2' },
      { id: 'a4', name: 'Exam', outOf: 100, weight: 100, categoryId: 'c3' },
    ]
    return d
  }
  const d = base('Grade 12 markbook')
  d.markLabel = 'Final mark'
  d.useCategories = true
  d.categories = [
    { id: 'c1', name: 'SBA', weight: 25 },
    { id: 'c2', name: 'Final exam', weight: 75 },
  ]
  d.assessments = [
    { id: 'a1', name: 'Test 1', outOf: 50, weight: 10, categoryId: 'c1' },
    { id: 'a2', name: 'Assignment', outOf: 50, weight: 15, categoryId: 'c1' },
    { id: 'a3', name: 'Test 2', outOf: 50, weight: 10, categoryId: 'c1' },
    { id: 'a4', name: 'Project', outOf: 100, weight: 15, categoryId: 'c1' },
    { id: 'a5', name: 'June exam', outOf: 150, weight: 25, categoryId: 'c1' },
    { id: 'a6', name: 'Trial exam', outOf: 150, weight: 25, categoryId: 'c1' },
    { id: 'a7', name: 'Paper 1', outOf: 150, weight: 50, categoryId: 'c2' },
    { id: 'a8', name: 'Paper 2', outOf: 150, weight: 50, categoryId: 'c2' },
  ]
  return d
}

/** The assessments in sheet order: grouped by Category (in Category order) when Categories are on. */
export function orderedAssessments(design: MarkbookDesign): Assessment[] {
  if (!design.useCategories) return [...design.assessments]
  return design.categories.flatMap((c) => design.assessments.filter((a) => a.categoryId === c.id))
}

/** The Category groups in order, each with its assessments. Only meaningful with Categories on. */
export function categoryGroups(design: MarkbookDesign): { category: Category; assessments: Assessment[] }[] {
  return design.categories.map((category) => ({
    category,
    assessments: design.assessments.filter((a) => a.categoryId === category.id),
  }))
}

function sum(values: number[]): number {
  return values.reduce((t, v) => t + v, 0)
}

function isHundred(total: number): boolean {
  return Math.abs(total - 100) < 1e-6
}

/** "37.5" or "40": a percentage the way the page shows it. */
export function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100)
}

export interface DesignCheck {
  /** Stop the download: the sheet would not work. */
  errors: string[]
  /** The sheet works, but probably not as intended (for example weights that do not add up to 100). */
  warnings: string[]
}

/** Everything wrong with a design, worded for the teacher. */
export function checkDesign(design: MarkbookDesign): DesignCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (design.assessments.length === 0) errors.push('Add at least one assessment.')
  design.assessments.forEach((a, i) => {
    const label = a.name.trim() || `Assessment ${i + 1}`
    if (a.name.trim() === '') errors.push(`Assessment ${i + 1} needs a name.`)
    if (!(Number.isFinite(a.outOf) && a.outOf > 0)) errors.push(`${label} needs an "out of" above 0.`)
    if (!(Number.isFinite(a.weight) && a.weight >= 0)) errors.push(`${label} needs a weight of 0% or more.`)
  })
  if (!(Number.isFinite(design.passMark) && design.passMark >= 0 && design.passMark <= 100)) {
    errors.push('The pass mark must be from 0% to 100%.')
  }

  if (!design.useCategories) {
    const total = sum(design.assessments.map((a) => a.weight))
    if (design.assessments.length > 0 && Number.isFinite(total) && !isHundred(total)) {
      warnings.push(`The assessment weights add up to ${formatNumber(total)}%, not 100%.`)
    }
    return { errors, warnings }
  }

  if (design.categories.length === 0) errors.push('Add at least one Category, or turn Categories off.')
  design.categories.forEach((c, i) => {
    if (c.name.trim() === '') errors.push(`Category ${i + 1} needs a name.`)
    if (!(Number.isFinite(c.weight) && c.weight >= 0)) errors.push(`${c.name || `Category ${i + 1}`} needs a weight.`)
  })
  const ids = new Set(design.categories.map((c) => c.id))
  for (const a of design.assessments) {
    if (!a.categoryId || !ids.has(a.categoryId))
      errors.push(`Choose a Category for ${a.name.trim() || 'every assessment'}.`)
  }
  const total = sum(design.categories.map((c) => c.weight))
  if (design.categories.length > 0 && Number.isFinite(total) && !isHundred(total)) {
    warnings.push(`The Category weights add up to ${formatNumber(total)}%, not 100%.`)
  }
  for (const { category, assessments } of categoryGroups(design)) {
    const name = category.name.trim() || 'A Category'
    if (assessments.length === 0) {
      warnings.push(`${name} has no assessments yet, so it counts for nothing.`)
      continue
    }
    const inside = sum(assessments.map((a) => a.weight))
    if (Number.isFinite(inside) && !isHundred(inside)) {
      warnings.push(`In ${name} the assessment weights add up to ${formatNumber(inside)}%, not 100%.`)
    }
  }
  return { errors, warnings }
}

// ---------- Saving and loading ----------

function text(value: unknown, fallback: string, max = 80): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Reads a design back from JSON, or null if it is not one. Unknown fields are dropped. */
export function parseDesign(value: unknown): MarkbookDesign | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !Array.isArray(v.assessments) || !Array.isArray(v.categories)) return null
  const fallback = base('Markbook')
  const categories: Category[] = v.categories
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof c.id === 'string')
    .map((c) => ({ id: c.id as string, name: text(c.name, ''), weight: num(c.weight, 0) }))
  const assessments: Assessment[] = v.assessments
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && typeof a.id === 'string')
    .map((a) => ({
      id: a.id as string,
      name: text(a.name, ''),
      outOf: num(a.outOf, 0),
      weight: num(a.weight, 0),
      categoryId: typeof a.categoryId === 'string' ? a.categoryId : null,
    }))
  const rounding: Rounding = v.rounding === 'none' || v.rounding === 'one' ? v.rounding : 'whole'
  return {
    version: 1,
    title: text(v.title, fallback.title),
    markLabel: text(v.markLabel, fallback.markLabel, 40),
    useCategories: bool(v.useCategories, false),
    categories,
    assessments,
    showPercentages: bool(v.showPercentages, true),
    rounding,
    showLevel: bool(v.showLevel, true),
    showResult: bool(v.showResult, true),
    passMark: num(v.passMark, 50),
    showSummary: bool(v.showSummary, true),
  }
}

/** A design saved by name in this browser. */
export interface SavedDesign {
  name: string
  savedAt: number
  design: MarkbookDesign
}

/** Reads the saved designs list, skipping anything damaged. */
export function parseSavedDesigns(value: unknown): SavedDesign[] {
  if (!Array.isArray(value)) return []
  const out: SavedDesign[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const design = parseDesign(r.design)
    if (!design || typeof r.name !== 'string') continue
    out.push({ name: r.name, savedAt: num(r.savedAt, 0), design })
  }
  return out
}

/** Adds or replaces (by name, ignoring case) a saved design. Newest first. */
export function upsertSaved(list: SavedDesign[], entry: SavedDesign): SavedDesign[] {
  const key = entry.name.trim().toLowerCase()
  return [entry, ...list.filter((s) => s.name.trim().toLowerCase() !== key)]
}
