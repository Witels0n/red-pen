// Diagnostic analysis of a marked class: per question (item analysis) and per Topic.
import type { Assessment } from './model'
import type { LearnerMark } from './marking'

export const TOO_EASY = 0.9
export const TOO_HARD = 0.3
/** A learner below this share of a Topic's marks should revise it ("Topics to revise"). */
export const REVISE_BELOW = 0.5

export type ItemFlag = 'too-easy' | 'too-hard' | 'negative-discrimination'

export interface ItemStats {
  /** Original question index. */
  question: number
  /** Learners whose page with this question was scanned. */
  answered: number
  correct: number
  /** 0 to 1, or null when the question has no Memo answer or no one answered. */
  pCorrect: number | null
  /** Learners per original option. */
  counts: number[]
  blank: number
  multiple: number
  /** The wrong option most learners chose (ties go to the earlier letter), with its misconception note. */
  topWrong?: { option: number; count: number; misconception: string }
  /** Share correct in the top third minus the bottom third, by total score. Null with fewer than 3 learners. */
  discrimination: number | null
  flags: ItemFlag[]
}

/** The top and bottom thirds of the class by total score (rounded down, at least one learner each). */
export function thirds(marks: readonly LearnerMark[]): { top: LearnerMark[]; bottom: LearnerMark[] } {
  if (marks.length < 3) return { top: [], bottom: [] }
  const k = Math.floor(marks.length / 3)
  const sorted = marks.slice().sort((x, y) => y.fraction - x.fraction || x.learnerId.localeCompare(y.learnerId))
  return { top: sorted.slice(0, k), bottom: sorted.slice(-k) }
}

function shareCorrect(group: readonly LearnerMark[], question: number): number {
  const present = group.filter((m) => m.perQuestion[question].outcome !== 'missing')
  return present.length
    ? present.filter((m) => m.perQuestion[question].outcome === 'correct').length / present.length
    : 0
}

export function itemAnalysis(a: Pick<Assessment, 'questions'>, marks: readonly LearnerMark[]): ItemStats[] {
  const { top, bottom } = thirds(marks)
  return a.questions.map((q, i): ItemStats => {
    const counts = q.options.map(() => 0)
    let blank = 0
    let multiple = 0
    let answered = 0
    let correct = 0
    for (const m of marks) {
      const r = m.perQuestion[i].response
      if (r === 'missing') continue
      answered++
      if (r === null) blank++
      else if (r === 'multiple') multiple++
      else {
        counts[r]++
        if (r === q.answer) correct++
      }
    }
    const marked = q.answer !== null && answered > 0
    const pCorrect = marked ? correct / answered : null
    let topWrong: ItemStats['topWrong']
    if (q.answer !== null) {
      counts.forEach((count, option) => {
        if (option !== q.answer && count > 0 && count > (topWrong?.count ?? 0)) {
          topWrong = { option, count, misconception: q.misconceptions[option]?.trim() ?? '' }
        }
      })
    }
    const discrimination = marked && top.length ? shareCorrect(top, i) - shareCorrect(bottom, i) : null
    const flags: ItemFlag[] = []
    if (pCorrect !== null && pCorrect > TOO_EASY) flags.push('too-easy')
    if (pCorrect !== null && pCorrect < TOO_HARD) flags.push('too-hard')
    if (discrimination !== null && discrimination < 0) flags.push('negative-discrimination')
    return { question: i, answered, correct, pCorrect, counts, blank, multiple, topWrong, discrimination, flags }
  })
}

export interface TopicSummary {
  topic: string
  /** Original question indexes with this Topic. */
  questions: number[]
  /** Marks per learner for the Topic (questions with a Memo answer). */
  possible: number
  /** Class share of the Topic's marks, 0 to 1 (null with no learners). */
  classFraction: number | null
  /** Learners below REVISE_BELOW on this Topic. */
  learnersToRevise: string[]
}

export function topicSummaries(a: Pick<Assessment, 'questions'>, marks: readonly LearnerMark[]): TopicSummary[] {
  const groups = new Map<string, { topic: string; questions: number[] }>()
  a.questions.forEach((q, i) => {
    const t = q.topic.trim()
    if (!t) return
    const g = groups.get(t.toLowerCase()) ?? { topic: t, questions: [] }
    g.questions.push(i)
    groups.set(t.toLowerCase(), g)
  })
  return [...groups.values()].map(({ topic, questions }) => {
    const possible = questions.reduce((s, i) => s + (a.questions[i].answer === null ? 0 : a.questions[i].marks), 0)
    let earned = 0
    let available = 0
    const learnersToRevise: string[] = []
    for (const m of marks) {
      const t = m.topics.find((x) => x.topic.toLowerCase() === topic.toLowerCase())
      if (!t || t.possible === 0) continue
      earned += t.earned
      available += t.possible
      if (t.earned / t.possible < REVISE_BELOW) learnersToRevise.push(m.learnerId)
    }
    return { topic, questions, possible, classFraction: available > 0 ? earned / available : null, learnersToRevise }
  })
}

/** A learner's Topics below REVISE_BELOW, weakest first. */
export function topicsToRevise(mark: LearnerMark): string[] {
  return mark.topics
    .filter((t) => t.possible > 0 && t.earned / t.possible < REVISE_BELOW)
    .sort((x, y) => x.earned / x.possible - y.earned / y.possible)
    .map((t) => t.topic)
}

export interface ClassSummary {
  learners: number
  mean: number | null
  median: number | null
  highest: number | null
  lowest: number | null
}

/** Class statistics on the percentage (0 to 1). */
export function classSummary(marks: readonly LearnerMark[]): ClassSummary {
  if (marks.length === 0) return { learners: 0, mean: null, median: null, highest: null, lowest: null }
  const f = marks.map((m) => m.fraction).sort((x, y) => x - y)
  const mid = Math.floor(f.length / 2)
  return {
    learners: f.length,
    mean: f.reduce((s, x) => s + x, 0) / f.length,
    median: f.length % 2 ? f[mid] : (f[mid - 1] + f[mid]) / 2,
    highest: f[f.length - 1],
    lowest: f[0],
  }
}
