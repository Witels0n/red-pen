import { stripPdfExtension } from '../shared/pdf/file-names'
import { parseRanges, type PageRange } from './ranges'

/** How to split: one file per page, a new file every `size` pages, or custom ranges. */
export type SplitMode = { kind: 'each' } | { kind: 'every'; size: number } | { kind: 'ranges'; text: string }

/** One file the split will produce. */
export interface PlannedPart extends PageRange {
  fileName: string
}

export type PlanResult = { ok: true; parts: PlannedPart[] } | { ok: false; error: string }

/** "class.pdf", part 3 of 12 -> "class-part-03.pdf". Numbers are padded so the files sort in order. */
export function partFileName(originalName: string, index: number, total: number): string {
  const width = Math.max(2, String(total).length)
  return `${stripPdfExtension(originalName)}-part-${String(index + 1).padStart(width, '0')}.pdf`
}

/** "class.pdf" -> "class-split.zip". */
export function zipFileName(originalName: string): string {
  return `${stripPdfExtension(originalName)}-split.zip`
}

function rangesFor(
  mode: SplitMode,
  pageCount: number,
): { ok: true; ranges: PageRange[] } | { ok: false; error: string } {
  switch (mode.kind) {
    case 'each':
      return { ok: true, ranges: Array.from({ length: pageCount }, (_, i) => ({ start: i + 1, end: i + 1 })) }
    case 'every': {
      if (!Number.isInteger(mode.size) || mode.size < 1) {
        return { ok: false, error: 'Enter a whole number of pages per file, 1 or more.' }
      }
      const ranges: PageRange[] = []
      for (let start = 1; start <= pageCount; start += mode.size) {
        ranges.push({ start, end: Math.min(pageCount, start + mode.size - 1) })
      }
      return { ok: true, ranges }
    }
    case 'ranges':
      return parseRanges(mode.text, pageCount)
  }
}

/** Work out which files a split produces, with their names and page ranges, before doing it. */
export function planSplit(mode: SplitMode, pageCount: number, originalName: string): PlanResult {
  const result = rangesFor(mode, pageCount)
  if (!result.ok) return result
  const total = result.ranges.length
  return {
    ok: true,
    parts: result.ranges.map((r, i) => ({ ...r, fileName: partFileName(originalName, i, total) })),
  }
}
