// The same sums as the Excel formulas in layout.ts, done in JavaScript for the page preview.
// Keep the two in step: the unit tests check both.

import type { MarkbookDesign } from './design'
import { LEVEL_FLOORS, type Column, type Layout, type SummaryKind } from './layout'

/** What a teacher types in a mark cell: a number, text such as ABS, or nothing. */
export type MarkEntry = number | string | null

/** A worked-out cell: a number, text ("Pass", a name) or empty. */
export type CellValue = number | string | null

/** Rounds half away from zero, as Excel's ROUND does, without binary floating point surprises. */
export function excelRound(value: number, digits: number): number {
  const sign = value < 0 ? -1 : 1
  const shifted = Number(`${Math.abs(value)}e${digits}`)
  return sign * Number(`${Math.round(shifted)}e-${digits}`)
}

/** The CAPS achievement level (1 to 7) of a percentage, or null below 0. */
export function capsLevel(percent: number): number | null {
  let level: number | null = null
  LEVEL_FLOORS.forEach((floor, i) => {
    if (percent >= floor) level = i + 1
  })
  return level
}

function isNumber(v: CellValue): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** The weighted average of the parts that are numbers, or null when none are (or all weights are 0). */
function weighted(parts: { value: CellValue; weight: number }[]): number | null {
  let num = 0
  let den = 0
  for (const p of parts) {
    if (!isNumber(p.value)) continue
    num += p.value * p.weight
    den += p.weight
  }
  return den === 0 ? null : num / den
}

/** One learner's row, worked out column by column, exactly as Excel would. */
export function learnerRow(
  design: MarkbookDesign,
  layout: Layout,
  learner: { id: string; name: string },
  marks: Record<string, MarkEntry>,
): CellValue[] {
  const values: CellValue[] = []
  const byColumn = new Map<Column, CellValue>()
  const set = (c: Column, v: CellValue) => {
    byColumn.set(c, v)
    values.push(v)
  }
  const fraction = (c: Column): CellValue => {
    const v = byColumn.get(c) ?? null
    return isNumber(v) ? v / c.outOf! : null
  }
  for (const column of layout.columns) {
    switch (column.kind) {
      case 'id':
        set(column, learner.id)
        break
      case 'name':
        set(column, learner.name)
        break
      case 'mark': {
        const v = marks[column.assessmentId!] ?? null
        set(column, v === '' ? null : v)
        break
      }
      case 'percent': {
        const mark = layout.columns.find((c) => c.kind === 'mark' && c.assessmentId === column.assessmentId)!
        const f = fraction(mark)
        set(column, isNumber(f) ? f * 100 : null)
        break
      }
      case 'category': {
        const ids = new Set(design.assessments.filter((a) => a.categoryId === column.categoryId).map((a) => a.id))
        const avg = weighted(
          layout.columns
            .filter((c) => c.kind === 'mark' && ids.has(c.assessmentId!))
            .map((m) => ({ value: fraction(m), weight: m.weight! })),
        )
        set(column, avg === null ? null : avg * 100)
        break
      }
      case 'term': {
        let term: number | null
        if (design.useCategories) {
          term = weighted(
            layout.columns
              .filter((c) => c.kind === 'category')
              .map((c) => ({ value: byColumn.get(c) ?? null, weight: c.weight! })),
          )
        } else {
          const avg = weighted(
            layout.columns.filter((c) => c.kind === 'mark').map((m) => ({ value: fraction(m), weight: m.weight! })),
          )
          term = avg === null ? null : avg * 100
        }
        set(column, term)
        break
      }
      case 'final': {
        const term = termOf(layout, byColumn)
        set(column, term === null ? null : excelRound(term, design.rounding === 'one' ? 1 : 0))
        break
      }
      case 'level': {
        const term = termOf(layout, byColumn)
        set(column, term === null ? null : capsLevel(term))
        break
      }
      case 'result': {
        const term = termOf(layout, byColumn)
        set(column, term === null ? null : term >= design.passMark ? 'Pass' : 'Fail')
        break
      }
    }
  }
  return values
}

function termOf(layout: Layout, byColumn: Map<Column, CellValue>): number | null {
  const v = byColumn.get(layout.columns.find((c) => c.kind === 'term')!) ?? null
  return isNumber(v) ? v : null
}

/** A class summary cell for one column, given that column's learner values. Mirrors summaryFormula. */
export function summaryValue(
  design: MarkbookDesign,
  column: Column,
  kind: SummaryKind,
  values: CellValue[],
): CellValue | undefined {
  if (column.kind === 'id' || column.kind === 'name') return undefined
  if (column.kind === 'result') {
    const pass = values.filter((v) => v === 'Pass').length
    const fail = values.filter((v) => v === 'Fail').length
    if (kind === 'count') return pass + fail
    if (kind === 'passRate') return pass + fail === 0 ? null : (pass / (pass + fail)) * 100
    return undefined
  }
  if (column.kind === 'level' && kind !== 'count') return undefined
  const nums = values.filter(isNumber)
  switch (kind) {
    case 'average':
      return nums.length === 0 ? null : nums.reduce((t, v) => t + v, 0) / nums.length
    case 'highest':
      return nums.length === 0 ? null : Math.max(...nums)
    case 'lowest':
      return nums.length === 0 ? null : Math.min(...nums)
    case 'count':
      return nums.length
    case 'passRate': {
      if (nums.length === 0) return null
      const threshold = column.kind === 'mark' ? (column.outOf! * design.passMark) / 100 : design.passMark
      return (nums.filter((v) => v >= threshold).length / nums.length) * 100
    }
  }
}

/**
 * Made-up marks for the preview: a spread of results, one learner absent (ABS) for the first
 * assessment and one with the last assessment still blank, so the teacher sees both handled.
 */
export function sampleMarks(design: MarkbookDesign, learners: number): Record<string, MarkEntry>[] {
  const levels = [0.82, 0.58, 0.45, 0.31, 0.69, 0.93, 0.52, 0.24]
  return Array.from({ length: learners }, (_, k) => {
    const row: Record<string, MarkEntry> = {}
    design.assessments.forEach((a, i) => {
      const wobble = (((i * 37 + k * 13) % 21) - 10) / 100
      const f = Math.min(1, Math.max(0, levels[k % levels.length] + wobble))
      row[a.id] = Number.isFinite(a.outOf) && a.outOf > 0 ? Math.round(f * a.outOf) : null
    })
    const first = design.assessments[0]
    const last = design.assessments[design.assessments.length - 1]
    if (k === 1 && first) row[first.id] = 'ABS'
    if (k === 3 && last && design.assessments.length > 1) row[last.id] = null
    return row
  })
}
