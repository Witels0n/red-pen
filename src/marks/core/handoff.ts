// Marks handed from another Tool (MCQ results) through sessionStorage: the tab's own storage, so
// nothing is kept once the tab closes, and nothing leaves the browser.

export const HANDOFF_KEY = 'red-pen.marks.handoff'

export interface Handoff {
  /** The assessment's name, used as the column heading. */
  title: string
  learners: { name: string; percent: number }[]
}

/** The handed-over marks as rows for the paste box: a Name column and one percentage column. */
export function handoffRows(handoff: Handoff): string[][] {
  // Two decimals, rounded down (after clearing floating-point noise) so no mark moves up a band.
  const percent = (p: number) => `${Math.floor(Math.round(p * 1e6) / 1e4) / 100}%`
  return [['Name', handoff.title || 'MCQ'], ...handoff.learners.map((l) => [l.name, percent(l.percent)])]
}

/** Reads a hand-off, or null when the value is missing or not one. */
export function parseHandoff(raw: string | null): Handoff | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<Handoff>
    if (!v || !Array.isArray(v.learners)) return null
    const learners = v.learners.filter(
      (l): l is Handoff['learners'][number] =>
        !!l && typeof l.name === 'string' && typeof l.percent === 'number' && Number.isFinite(l.percent),
    )
    return { title: typeof v.title === 'string' ? v.title : '', learners }
  } catch {
    return null
  }
}
