// Question numbers with nesting (1, 1.1, 1.2.3) and the section subtotals they imply.
import type { QuestionRow } from './model'

/** "Q1.2." becomes ["1", "2"]; "Question 3 (a)" becomes ["3", "a"]. Empty for a blank number. */
export function numberParts(typed: string): string[] {
  const s = typed
    .trim()
    .toLowerCase()
    .replace(/^(?:question|vraag|q)\s*/, '')
    .replace(/[()]/g, '.')
    .replace(/\s+/g, '.')
  return s.split('.').filter(Boolean)
}

export function numberKey(typed: string): string {
  return numberParts(typed).join('.')
}

/** The question a key belongs to: "1.2.3" is under "1.2", which is under "1". */
export function isUnder(key: string, ancestor: string): boolean {
  return ancestor !== '' && key.startsWith(`${ancestor}.`)
}

export interface Section {
  /** The section's number as a key, for example "1" or "1.2". */
  key: string
  /** As shown: the number typed on its own row when there is one, otherwise the key. */
  label: string
  depth: number
  /** The sum of the marks of every question in the section. */
  marks: number
  /** The row that heads the section, when the teacher typed one (for example a row "1" above 1.1 and 1.2). */
  headingRowId: string | null
  /** The id of the section's last question in table order, so a subtotal can be shown after it. */
  lastRowId: string
}

export interface Numbering {
  /** Rows whose marks count: every row that is not the heading of a section. */
  counted: QuestionRow[]
  /** Every section with at least one question under it, in the order they first appear. */
  sections: Section[]
  /** Totals per top-level question ("1", "2"...), including questions with no sub-questions. */
  questions: { key: string; marks: number }[]
  /** Numbers typed more than once. */
  duplicates: string[]
  /** Headings with marks typed that differ from the sum of their sub-questions. */
  mismatches: { label: string; typed: number; subtotal: number }[]
}

export function analyseNumbering(rows: readonly QuestionRow[]): Numbering {
  const keys = rows.map((r) => numberKey(r.number))
  const keySet = new Set(keys.filter(Boolean))
  const isHeading = (key: string) => key !== '' && [...keySet].some((k) => isUnder(k, key))

  const counted = rows.filter((_, i) => !isHeading(keys[i]))

  const sections = new Map<string, Section>()
  const questions = new Map<string, number>()
  rows.forEach((row, i) => {
    const key = keys[i]
    if (!key || isHeading(key)) return
    const marks = row.marks ?? 0
    const parts = key.split('.')
    questions.set(parts[0], (questions.get(parts[0]) ?? 0) + marks)
    for (let d = 1; d < parts.length; d++) {
      const prefix = parts.slice(0, d).join('.')
      const section = sections.get(prefix)
      if (section) {
        section.marks += marks
        section.lastRowId = row.id
      } else {
        sections.set(prefix, {
          key: prefix,
          label: prefix,
          depth: d - 1,
          marks,
          headingRowId: null,
          lastRowId: row.id,
        })
      }
    }
  })

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const mismatches: Numbering['mismatches'] = []
  rows.forEach((row, i) => {
    const key = keys[i]
    if (!key) return
    if (seen.has(key)) duplicates.add(row.number.trim())
    seen.add(key)
    const section = sections.get(key)
    if (section && section.headingRowId === null) {
      section.headingRowId = row.id
      section.label = row.number.trim()
      if (row.marks !== null && Math.abs(row.marks - section.marks) > 1e-9) {
        mismatches.push({ label: section.label, typed: row.marks, subtotal: section.marks })
      }
    }
  })

  // Sections in the order of their first row in the table, parents before children.
  const firstIndex = (key: string) => keys.findIndex((k) => k === key || isUnder(k, key))
  const ordered = [...sections.values()].sort((a, b) => firstIndex(a.key) - firstIndex(b.key) || a.depth - b.depth)

  return {
    counted,
    sections: ordered,
    questions: [...questions].map(([key, marks]) => ({ key, marks })),
    duplicates: [...duplicates],
    mismatches,
  }
}

/**
 * The number a new row after `previous` most likely has: 1.3 after 1.2, b after a, 1 for the
 * first row. Keeps the teacher's own style (for example a leading "Q").
 */
export function nextNumber(previous: string): string {
  const s = previous.trim()
  if (!s) return '1'
  const m = /^(.*?)(\d+|[a-z])(\)?)$/i.exec(s)
  if (!m) return ''
  const [, head, last, tail] = m
  if (/^\d+$/.test(last)) return `${head}${Number(last) + 1}${tail}`
  if (last === 'z' || last === 'Z') return ''
  return `${head}${String.fromCharCode(last.charCodeAt(0) + 1)}${tail}`
}
