// Splitting the scanned pages into one PDF per learner. Pure (tests/scan-split-plan.test.ts).
// The teacher marks the first page of each learner; page 1 always starts the first part.
// Reuses the Split a PDF Tool's planning and file naming.
import { safeFileBase } from '../shared/pdf/file-names'
import { uniqueFileNames } from '../split/cover-plan'
import { partFileName, planSplit, type PlannedPart } from '../split/plan'

/** What the split needs to know about each page, in page order. */
export interface SplitPage {
  /** True when this page is the first page of a learner. */
  first: boolean
  /** The name the teacher gave this learner (only read on a first page). */
  name: string
}

export interface ScanPart extends PlannedPart {
  /** The learner's name as typed or picked, trimmed, or "" when none was given. */
  name: string
  /** Index (0-based) of the part's first page, which holds its name. */
  firstIndex: number
}

/** The 0-based indexes of the pages that start a new part when every learner has `size` pages. */
export function everyNStarts(pageCount: number, size: number): number[] | null {
  const plan = planSplit({ kind: 'every', size }, pageCount, 'scan.pdf')
  return plan.ok ? plan.parts.map((p) => p.start - 1) : null
}

/**
 * The parts of a split, in page order: a new part starts at page 1 and at every page marked as a
 * learner's first page. Each part is named after its learner, or numbered ("scan-part-03.pdf")
 * when no name was given. Names are made safe for every operating system and kept distinct.
 */
export function planScanSplit(pages: readonly SplitPage[], baseName: string): ScanPart[] {
  const starts = pages.flatMap((p, i) => (i === 0 || p.first ? [i] : []))
  const total = starts.length
  const parts = starts.map((start, i) => {
    const end = (starts[i + 1] ?? pages.length) - 1
    const name = pages[start].name.trim()
    const numbered = partFileName(baseName, i, total).replace(/\.pdf$/, '')
    return {
      start: start + 1,
      end: end + 1,
      name,
      firstIndex: start,
      base: name ? safeFileBase(name, numbered) : numbered,
    }
  })
  const fileNames = uniqueFileNames(parts.map((p) => p.base))
  return parts.map(({ base: _base, ...p }, i) => ({ ...p, fileName: fileNames[i] }))
}

/** A learner's name for a part: their name on the Class list, or "Learner 07" for a numbers-only list. */
export function learnerLabel(learner: { id: string; name?: string }): string {
  return learner.name?.trim() || `Learner ${learner.id}`
}
