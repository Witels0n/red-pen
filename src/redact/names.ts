// Anonymised names for a batch of redacted PDFs, and the key that links them back.
// Pure: no DOM. Randomness is passed in so tests can fix it.

import { safeFileBase, uniqueNames, withSuffix } from '../shared/pdf/file-names'

export interface NamingOptions {
  /** Rename each file to "<prefix> <number>.pdf"; otherwise keep "<name>-redacted.pdf". */
  rename: boolean
  /** "Learner" by default. */
  prefix: string
  /** The first number given out. */
  start: number
  /**
   * The order the numbers are given out in: a permutation of the file indexes. The identity keeps
   * the list order; a shuffle stops the numbers following the alphabetical class list.
   */
  order: readonly number[]
}

export interface NamedFile {
  /** The file name the teacher opened. */
  original: string
  /** Its anonymised name, also written in labelled boxes: "Learner 07". */
  label: string
  /** The name in the download: "Learner 07.pdf", or "<name>-redacted.pdf" when not renaming. */
  output: string
}

export const DEFAULT_PREFIX = 'Learner'

/** A random order of `count` indexes (Fisher-Yates), using `random` (0 <= n < 1). */
export function shuffledOrder(count: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** The list order, unchanged. */
export function listOrder(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}

/**
 * Names for each file, in the order given. Numbers are padded to the same width (at least two
 * digits) so the files sort in number order: "Learner 01" to "Learner 30".
 */
export function planNames(originals: readonly string[], options: NamingOptions): NamedFile[] {
  const count = originals.length
  const start = Math.max(0, Math.floor(Number.isFinite(options.start) ? options.start : 1))
  const width = Math.max(2, String(start + Math.max(count - 1, 0)).length)
  const prefix = safeFileBase(options.prefix, DEFAULT_PREFIX)
  const numbers = new Array<number>(count)
  const order = isPermutation(options.order, count) ? options.order : listOrder(count)
  order.forEach((fileIndex, position) => (numbers[fileIndex] = start + position))
  const labels = originals.map((_, i) => `${prefix} ${String(numbers[i]).padStart(width, '0')}`)
  const outputs = options.rename
    ? labels.map((l) => `${l}.pdf`)
    : uniqueNames(originals.map((name) => withSuffix(name, 'redacted')))
  return originals.map((original, i) => ({ original, label: labels[i], output: outputs[i] }))
}

function isPermutation(order: readonly number[], count: number): boolean {
  if (order.length !== count) return false
  const seen = new Set(order)
  return seen.size === count && order.every((n) => Number.isInteger(n) && n >= 0 && n < count)
}

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The key: original file name to anonymised name, in number order. Kept apart from the zip. */
export function keyCsv(files: readonly NamedFile[]): string {
  const rows = [...files].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
  const lines = [
    ['Original file', 'Anonymised name', 'Anonymised file'],
    ...rows.map((f) => [f.original, f.label, f.output]),
  ]
  return lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
