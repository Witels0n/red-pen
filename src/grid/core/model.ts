// A Question paper grid: the analysis of one test or exam paper, question by question.
import { defaultTaxonomy, type Taxonomy } from './taxonomy'

export type Difficulty = '' | 'easy' | 'moderate' | 'difficult'

export const DIFFICULTY_NAMES: Record<Exclude<Difficulty, ''>, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  difficult: 'Difficult',
}

export interface QuestionRow {
  id: string
  /** As typed: "1", "1.2", "1.2.3". */
  number: string
  /** null while not filled in. */
  marks: number | null
  /** A level id from the grid's taxonomy, or '' for none. */
  level: string
  topic: string
  area: string
  difficulty: Difficulty
  notes: string
}

export interface GridTopic {
  name: string
  /** Target percentage of the paper, or null for no target. */
  target: number | null
}

export interface PaperDetails {
  subject: string
  grade: string
  paper: string
  date: string
  examiner: string
  moderator: string
}

export interface Grid {
  id: string
  createdAt: number
  updatedAt: number
  details: PaperDetails
  /** The total the paper is meant to add up to, or null when not set. */
  intendedTotal: number | null
  taxonomy: Taxonomy
  topics: GridTopic[]
  rows: QuestionRow[]
  /** How many percentage points a share may be off its target before it is flagged. */
  tolerance: number
  /** Show the content area, difficulty and notes columns. */
  showExtra: boolean
}

export const DEFAULT_TOLERANCE = 5

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function emptyRow(number = ''): QuestionRow {
  return { id: newId(), number, marks: null, level: '', topic: '', area: '', difficulty: '', notes: '' }
}

export function newGrid(taxonomy: Taxonomy = defaultTaxonomy('caps'), now = Date.now()): Grid {
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    details: { subject: '', grade: '', paper: '', date: '', examiner: '', moderator: '' },
    intendedTotal: null,
    taxonomy: structuredClone(taxonomy),
    topics: [],
    rows: [emptyRow('1.1'), emptyRow('1.2'), emptyRow('1.3')],
    tolerance: DEFAULT_TOLERANCE,
    showExtra: false,
  }
}

/** A copy with new ids, named "(copy)", ready to adapt for the next paper. */
export function duplicateGrid(g: Grid, now = Date.now()): Grid {
  const copy = structuredClone(g)
  copy.id = newId()
  copy.createdAt = now
  copy.updatedAt = now
  copy.details.paper = copy.details.paper ? `${copy.details.paper} (copy)` : '(copy)'
  copy.rows = copy.rows.map((r) => ({ ...r, id: newId() }))
  return copy
}

/** The name a grid goes by in lists and file names: "Mathematics Grade 10 Paper 1". */
export function gridTitle(g: Pick<Grid, 'details'>): string {
  const d = g.details
  const grade = d.grade && !/^gr/i.test(d.grade.trim()) ? `Grade ${d.grade.trim()}` : d.grade.trim()
  const title = [d.subject.trim(), grade, d.paper.trim()].filter(Boolean).join(' ')
  return title || 'Untitled grid'
}

export function gridFileName(g: Pick<Grid, 'details'>, ext: string): string {
  const base = gridTitle(g)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base} grid.${ext}`
}

/** Fills in anything a grid saved by an earlier Red Pen lacks. */
export function upgradeGrid(g: Grid): Grid {
  return {
    ...newGrid(g.taxonomy ?? defaultTaxonomy('caps'), g.createdAt),
    ...g,
    details: { ...newGrid().details, ...(g.details as Partial<PaperDetails>) },
    topics: g.topics ?? [],
    rows: (g.rows ?? []).map((r) => ({ ...emptyRow(), ...r })),
    tolerance: Number.isFinite(g.tolerance) ? g.tolerance : DEFAULT_TOLERANCE,
  }
}

/** "12", "7.5". */
export function formatNumber(n: number, decimals = 1): string {
  const f = 10 ** decimals
  const r = Math.round(n * f) / f
  return Number.isInteger(r) ? String(r) : r.toFixed(decimals)
}

/** Reads a typed number (accepting a decimal comma); null when blank or not a number. */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
