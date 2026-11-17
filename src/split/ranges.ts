/** A run of pages, 1-based and inclusive: { start: 4, end: 6 } is pages 4, 5 and 6. */
export interface PageRange {
  start: number
  end: number
}

export type RangesResult = { ok: true; ranges: PageRange[] } | { ok: false; error: string }

// "4" or "4-6". Also accepts an en dash, which word processors put in when teachers type a hyphen.
const RANGE = /^(\d+)(?:\s*[-–]\s*(\d+))?$/

/**
 * Parse custom ranges such as "1-3, 4-6, 7" for a PDF with `pageCount` pages.
 * Ranges are separated by commas or semicolons and may overlap. Every error message
 * says what is wrong and how to write it instead.
 */
export function parseRanges(text: string, pageCount: number): RangesResult {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) {
    return { ok: false, error: 'Enter at least one page or range, for example 1-3, 4-6, 7.' }
  }
  const ranges: PageRange[] = []
  for (const part of parts) {
    const m = part.match(RANGE)
    if (!m) {
      return { ok: false, error: `"${part}" is not a page or a range. Use numbers like 7 or 4-6, separated by commas.` }
    }
    const start = Number(m[1])
    const end = m[2] === undefined ? start : Number(m[2])
    if (start === 0 || end === 0) return { ok: false, error: `"${part}": pages are numbered from 1.` }
    if (end < start) return { ok: false, error: `"${part}" runs backwards. Write it as ${end}-${start}.` }
    if (end > pageCount) {
      const last = pageCount === 1 ? 'only 1 page' : `${pageCount} pages`
      return { ok: false, error: `"${part}" goes past the end: this PDF has ${last}.` }
    }
    ranges.push({ start, end })
  }
  return { ok: true, ranges }
}

/** "Page 7" or "Pages 4-6". */
export function describeRange({ start, end }: PageRange): string {
  return start === end ? `Page ${start}` : `Pages ${start}-${end}`
}
