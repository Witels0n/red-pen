/**
 * A Learner ID: a short number that identifies a Learner without a name, written with
 * leading zeros to the Class list's digit count (for example "07" in a two-digit list).
 * This is what a QR on paper holds, never a name.
 */
export type LearnerId = string

/** One learner on a Class list. The name is optional: a class can be numbers only. */
export interface Learner {
  id: LearnerId
  name?: string
}

/** A named list of learners, each with a Learner ID and optionally a name. Stored only in this browser. */
export interface ClassList {
  id: string
  name: string
  /** How many digits every Learner ID in this list has (1 to 4). */
  idDigits: number
  learners: Learner[]
  /** Milliseconds since 1970, as from Date.now(). */
  createdAt: number
  updatedAt: number
}

export const MIN_ID_DIGITS = 1
export const MAX_ID_DIGITS = 4

/** Whether `digits` is an allowed Learner ID length (a whole number from 1 to 4). */
export function isIdDigits(digits: number): boolean {
  return Number.isInteger(digits) && digits >= MIN_ID_DIGITS && digits <= MAX_ID_DIGITS
}

/** The largest Learner ID that fits in `digits` digits: 9, 99, 999 or 9999. */
export function maxLearnerNumber(digits: number): number {
  return 10 ** digits - 1
}

/** The smallest digit count (at least 1) that can hold `n`. */
export function digitsNeeded(n: number): number {
  return Math.max(MIN_ID_DIGITS, String(Math.trunc(Math.abs(n))).length)
}

/** 7 with 3 digits -> "007". Throws if `n` is not a whole number from 1 up that fits. */
export function formatLearnerId(n: number, digits: number): LearnerId {
  if (!isIdDigits(digits)) throw new RangeError(`A Learner ID has 1 to 4 digits, not ${digits}.`)
  if (!Number.isInteger(n) || n < 1 || n > maxLearnerNumber(digits)) {
    throw new RangeError(`${n} is not a Learner ID that fits in ${digits} digit${digits === 1 ? '' : 's'}.`)
  }
  return String(n).padStart(digits, '0')
}

/** "007" -> 7. Returns null for anything that is not a string of digits. */
export function learnerNumber(id: string): number | null {
  const trimmed = id.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}
