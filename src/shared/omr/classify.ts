// Turns bubble fill scores into answers with confidences. Pure maths, unit-tested on its own.
//
// A score is a bubble's mean darkness inside an inner circle, after subtracting the darkness of an
// empty bubble on the same sheet and dividing by the darkness of the sheet's printed black:
// 0 is an empty bubble and 1 is a bubble as dark as the corner squares.
import type { Answer, QuestionFlag } from './types'

/** Reads with a confidence below this go to Review. */
export const REVIEW_THRESHOLD = 0.7

export interface Thresholds {
  /** At or above this a bubble counts as filled. */
  mark: number
  /** Below this a bubble counts as empty; between faint and mark it is a light mark or an erasure. */
  faint: number
}

/** The default pencil level when a sheet has too few marks to measure the learner's own. */
const DEFAULT_MARK_LEVEL = 0.6
/** The least a deliberate fill can score, whatever the learner's pencil. */
const MIN_DELIBERATE = 0.22

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const pos = Math.min(s.length - 1, Math.max(0, q * (s.length - 1)))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/**
 * Thresholds that follow this learner's pencil: the typical score of their clearly filled bubbles
 * (the darkest bubble of each question that has a deliberate mark) sets the scale.
 */
export function deriveThresholds(darkestPerQuestion: number[]): Thresholds {
  const marks = darkestPerQuestion.filter((s) => s >= MIN_DELIBERATE)
  const level = marks.length >= 3 ? clamp(median(marks), 0.3, 1.2) : DEFAULT_MARK_LEVEL
  return { mark: clamp(0.45 * level, 0.16, 0.4), faint: clamp(0.2 * level, 0.08, 0.16) }
}

export interface QuestionRead {
  answer: Answer
  confidence: number
  flags: QuestionFlag[]
}

/**
 * Classifies one question (or one Bubbled ID column) from its bubbles' scores.
 * - blank: nothing reaches `faint`.
 * - one answer: exactly one bubble reaches `mark`. A second bubble between `faint` and `mark`
 *   (an erasure or a half-hearted change) lowers confidence and is flagged.
 * - multiple: two or more bubbles reach `mark`, including a crossed-out answer.
 * - a light mark: the darkest bubble lies between `faint` and `mark`.
 */
export function classifyQuestion(scores: number[], t: Thresholds): QuestionRead {
  if (scores.length === 0) return { answer: null, confidence: 0, flags: [] }
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0])
  const [s1, best] = order[0]
  const s2 = order.length > 1 ? order[1][0] : 0
  const band = t.mark - t.faint

  if (s1 < t.faint) {
    return { answer: null, confidence: 0.75 + 0.25 * clamp01(1 - s1 / t.faint), flags: [] }
  }
  if (s1 < t.mark) {
    // Light: which side of the middle of the band it falls on decides the guess; confidence stays low.
    const mid = (t.faint + t.mark) / 2
    const lean = clamp01(Math.abs(s1 - mid) / (band / 2))
    return { answer: s1 >= mid ? best : null, confidence: 0.3 + 0.3 * lean, flags: ['light'] }
  }
  if (s2 >= t.mark) {
    // Confidence here is confidence that it really is more than one mark; it still goes to Review.
    return { answer: 'multiple', confidence: 0.5 + 0.5 * clamp01((s2 - t.mark) / t.mark), flags: ['multiple'] }
  }
  const strength = clamp01((s1 - t.mark) / t.mark)
  if (s2 >= t.faint) {
    const separation = clamp01((s1 - s2) / s1)
    return {
      answer: best,
      confidence: clamp(0.3 + 0.55 * separation, 0.3, 0.75) * (0.85 + 0.15 * strength),
      flags: ['erasure'],
    }
  }
  return { answer: best, confidence: 0.72 + 0.28 * strength - 0.12 * clamp01(s2 / t.faint), flags: [] }
}

/** Whether a classified question needs the teacher to look. */
export function needsReview(q: QuestionRead): boolean {
  return q.confidence < REVIEW_THRESHOLD || q.answer === 'multiple' || q.flags.length > 0
}
