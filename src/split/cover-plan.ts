// Planning a split at Cover sheets: pure, so every case is unit tested (tests/split-cover-plan.test.ts).
// The page scan that feeds it lives in cover-scan.ts.
import { safeFileBase } from '../shared/pdf/file-names'
import type { PlannedPart } from './plan'

/** What the scan found on one page of the opened PDF. */
export type ScannedPage =
  /** A Cover sheet whose QR names this Learner ID. */
  | { kind: 'cover'; learnerId: string }
  /** Corner squares were found but the code could not be read: possibly a Cover sheet. */
  | { kind: 'unreadable' }
  /** Any other page: the learner's written work. */
  | { kind: 'page' }

/** The parts of a Class list the planner needs: Learner IDs and names, never stored. */
export interface CoverPlanClass {
  name: string
  learners: readonly { id: string; name?: string }[]
}

export interface CoverPlanOptions {
  /** One entry per page of the PDF, page 1 first. */
  pages: readonly ScannedPage[]
  /** Keep each Cover sheet as page 1 of its learner's file (true), or leave it out. */
  includeCovers: boolean
  /** The Class list to take names from, when one is on this device and chosen. */
  classList?: CoverPlanClass
}

/** One file the split produces: a learner's test, or the pages before the first Cover sheet. */
export interface CoverPart extends PlannedPart {
  /** True for the pages before the first Cover sheet, which belong to no learner. */
  unassigned: boolean
  learnerId?: string
  /** The learner's name from the chosen Class list, when it has one. */
  learnerName?: string
  /** The page the Cover sheet is on (1-based). */
  coverPage?: number
}

export type CoverPlanResult = { ok: true; parts: CoverPart[]; warnings: string[] } | { ok: false; error: string }

/** The file name (without .pdf) for the pages before the first Cover sheet. */
export const UNASSIGNED_NAME = 'unassigned'

/** "learner-07": the file name for a learner whose name is not on this device. */
export function learnerFileBase(learnerId: string): string {
  return `learner-${learnerId}`
}

/** Learner IDs are matched by number, so "7" on an older Cover sheet still finds "07" on the list. */
function idKey(id: string): string {
  return /^\d+$/.test(id) ? String(Number(id)) : id
}

/** "page 4", "pages 4 and 9", "pages 2, 5 and 9". */
function pageList(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`
  return `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`
}

/** "07", "07 and 12", "07, 12 and 15". */
function joinAnd(items: readonly string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function rangeText(start: number, end: number): string {
  return start === end ? `Page ${start}` : `Pages ${start}-${end}`
}

/**
 * Gives every part a distinct file name. A base used by more than one part (the same learner
 * scanned twice, or two learners with the same name) is numbered on every use, in page order:
 * "Thandi Mokoena-1.pdf", "Thandi Mokoena-2.pdf". Comparison ignores case, as Windows and macOS do.
 */
export function uniqueFileNames(bases: readonly string[]): string[] {
  const count = new Map<string, number>()
  for (const b of bases) count.set(b.toLowerCase(), (count.get(b.toLowerCase()) ?? 0) + 1)
  const taken = new Set(bases.filter((b) => count.get(b.toLowerCase()) === 1).map((b) => b.toLowerCase()))
  const next = new Map<string, number>()
  return bases.map((b) => {
    const key = b.toLowerCase()
    if (count.get(key) === 1) return `${b}.pdf`
    let n = next.get(key) ?? 1
    while (taken.has(`${b}-${n}`.toLowerCase())) n++
    next.set(key, n + 1)
    taken.add(`${b}-${n}`.toLowerCase())
    return `${b}-${n}.pdf`
  })
}

/**
 * Works out the files for a batch scan with a Cover sheet on top of each learner's test.
 * A new part starts at every Cover sheet. Pages before the first one form an unassigned part.
 * Names come from the chosen Class list (matched by Learner ID), otherwise `learner-<id>`.
 * Everything the teacher should check is returned as a warning, in plain words.
 */
export function planCoverSplit(options: CoverPlanOptions): CoverPlanResult {
  const { pages, includeCovers, classList } = options
  const coverPages: number[] = []
  pages.forEach((p, i) => {
    if (p.kind === 'cover') coverPages.push(i + 1)
  })
  if (coverPages.length === 0) {
    return {
      ok: false,
      error:
        'No Cover sheets were found in this PDF. Print them with the Cover sheets Tool, staple one on top of each test, and scan again.',
    }
  }

  const names = new Map<string, { id: string; name?: string }>()
  for (const l of classList?.learners ?? []) names.set(idKey(l.id), l)

  const warnings: string[] = []
  const parts: Omit<CoverPart, 'fileName'>[] = []
  const bases: string[] = []

  const first = coverPages[0]
  if (first > 1) {
    parts.push({ start: 1, end: first - 1, unassigned: true })
    bases.push(UNASSIGNED_NAME)
    warnings.push(
      `${rangeText(1, first - 1)} ${first === 2 ? 'comes' : 'come'} before the first Cover sheet, so ${first === 2 ? 'it is' : 'they are'} in ${UNASSIGNED_NAME}.pdf. Check whether a learner's Cover sheet is missing.`,
    )
  }

  const unknown: string[] = []
  const seen = new Map<string, { label: string; pages: number[] }>()

  coverPages.forEach((cover, i) => {
    const page = pages[cover - 1] as { kind: 'cover'; learnerId: string }
    const last = (coverPages[i + 1] ?? pages.length + 1) - 1
    const learner = names.get(idKey(page.learnerId))
    const learnerName = learner?.name?.trim() || undefined
    const label = learnerName ? `${learnerName} (Learner ID ${page.learnerId})` : `Learner ID ${page.learnerId}`
    if (classList && !learner && !unknown.includes(page.learnerId)) unknown.push(page.learnerId)

    const entry = seen.get(idKey(page.learnerId)) ?? { label, pages: [] }
    entry.pages.push(cover)
    seen.set(idKey(page.learnerId), entry)

    const start = includeCovers ? cover : cover + 1
    if (last === cover) {
      warnings.push(
        includeCovers
          ? `${label}: the Cover sheet on page ${cover} has no pages after it, so the file holds only the Cover sheet.`
          : `${label}: the Cover sheet on page ${cover} has no pages after it, so there is no file for it.`,
      )
      if (!includeCovers) return
    }
    parts.push({ start, end: last, unassigned: false, learnerId: page.learnerId, learnerName, coverPage: cover })
    bases.push(
      learnerName ? safeFileBase(learnerName, learnerFileBase(page.learnerId)) : learnerFileBase(page.learnerId),
    )
  })

  for (const { label, pages: at } of seen.values()) {
    if (at.length > 1) {
      warnings.push(`${label} has ${at.length} Cover sheets, on ${pageList(at)}. Each one starts a numbered file.`)
    }
  }

  if (classList && unknown.length > 0) {
    const ids = joinAnd(unknown)
    warnings.push(
      unknown.length === 1
        ? `Learner ID ${ids} is not on ${classList.name}, so its file is named ${learnerFileBase(unknown[0])}.pdf.`
        : `Learner IDs ${ids} are not on ${classList.name}, so their files are named by Learner ID.`,
    )
  }

  if (classList) {
    const missing = classList.learners.filter((l) => !seen.has(idKey(l.id)))
    if (missing.length > 0 && missing.length < classList.learners.length) {
      const shown = missing.slice(0, 5).map((l) => (l.name?.trim() ? `${l.name.trim()} (${l.id})` : l.id))
      const more = missing.length > 5 ? ` and ${missing.length - 5} more` : ''
      const who = more ? `${shown.join(', ')}${more}` : joinAnd(shown)
      warnings.push(
        `${missing.length} ${missing.length === 1 ? 'learner' : 'learners'} on ${classList.name} ${missing.length === 1 ? 'has' : 'have'} no Cover sheet in this scan: ${who}.`,
      )
    }
  }

  const unreadable = pages.flatMap((p, i) => (p.kind === 'unreadable' ? [i + 1] : []))
  if (unreadable.length > 0) {
    const one = unreadable.length === 1
    warnings.push(
      `${one ? 'Page' : 'Pages'} ${pageList(unreadable).replace(/^pages? /, '')} ${one ? 'looks' : 'look'} like a Red Pen sheet, but the code could not be read, so ${one ? 'it stays' : 'they stay'} in the file before. If ${one ? 'it is a Cover sheet' : 'any is a Cover sheet'}, scan ${one ? 'it' : 'them'} again more clearly.`,
    )
  }

  const fileNames = uniqueFileNames(bases)
  return { ok: true, parts: parts.map((p, i) => ({ ...p, fileName: fileNames[i] })), warnings }
}
