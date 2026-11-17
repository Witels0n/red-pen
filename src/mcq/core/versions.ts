// Versions: shuffled orders of questions and options, planned from a stored seed so a reprint
// always matches. Version A is the original order. Marking maps every Version back to it.
import type { SheetQuestion, SheetVersion } from '../../shared/omr/types'
import {
  identityPlan,
  MAX_VERSIONS,
  VERSION_LETTERS,
  type Assessment,
  type Question,
  type VersionPlan,
  type VersionSettings,
} from './model'

/** mulberry32: a small, fast, seeded random number generator (0 to 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates with the given random source. Returns a new array. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/**
 * The plans for every Version. Deterministic: the same questions (count and options per question)
 * and settings always give the same plans.
 */
export function planVersions(
  questions: readonly Pick<Question, 'options'>[],
  settings: Pick<VersionSettings, 'count' | 'shuffleQuestions' | 'shuffleOptions' | 'seed'>,
): VersionPlan[] {
  const count = Math.max(1, Math.min(MAX_VERSIONS, Math.round(settings.count)))
  const plans = [identityPlan('A', questions)]
  for (let v = 1; v < count; v++) {
    // A separate stream per Version, so adding Version C never changes Version B.
    const random = seededRandom((settings.seed ^ Math.imul(v, 0x9e3779b9)) >>> 0)
    const questionOrder = settings.shuffleQuestions
      ? shuffled(range(questions.length), random)
      : range(questions.length)
    const optionOrder = questionOrder.map((q) => {
      const n = questions[q].options.length
      return settings.shuffleOptions ? shuffled(range(n), random) : range(n)
    })
    plans.push({ version: VERSION_LETTERS[v], questionOrder, optionOrder })
  }
  return plans
}

/** Whether stored plans still fit the questions (same count and options per question) and settings. */
export function plansFit(a: Pick<Assessment, 'questions' | 'versions'>): boolean {
  const { plans, count } = a.versions
  if (plans.length !== count) return false
  return plans.every(
    (p) =>
      p.questionOrder.length === a.questions.length &&
      p.optionOrder.every((o, pos) => o.length === a.questions[p.questionOrder[pos]]?.options.length),
  )
}

/** The Assessment with plans that fit its questions, re-planned only when they no longer fit. */
export function refreshVersions(a: Assessment): Assessment {
  if (plansFit(a)) return a
  return { ...a, versions: { ...a.versions, plans: planVersions(a.questions, a.versions) } }
}

/** New Version settings, always re-planned. */
export function withVersionSettings(a: Assessment, change: Partial<Omit<VersionSettings, 'plans'>>): Assessment {
  const versions = { ...a.versions, ...change }
  return { ...a, versions: { ...versions, plans: planVersions(a.questions, versions) } }
}

export function planFor(a: Pick<Assessment, 'versions'>, version: SheetVersion): VersionPlan | undefined {
  return a.versions.plans.find((p) => p.version === version)
}

export function versionLetters(a: Pick<Assessment, 'versions'>): SheetVersion[] {
  return a.versions.plans.map((p) => p.version)
}

/** The questions as printed on this Version's sheet (options per printed position). */
export function sheetQuestions(a: Pick<Assessment, 'questions'>, plan: VersionPlan): SheetQuestion[] {
  return plan.questionOrder.map((q) => ({ options: a.questions[q].options.length }))
}

/** A printed answer (position and letter on this Version) as the original question and option. */
export function toOriginal(plan: VersionPlan, position: number, option: number): { question: number; option: number } {
  return { question: plan.questionOrder[position], option: plan.optionOrder[position][option] }
}

/** Where an original question and option are printed on this Version. */
export function toPrinted(plan: VersionPlan, question: number, option: number): { position: number; option: number } {
  const position = plan.questionOrder.indexOf(question)
  return { position, option: plan.optionOrder[position].indexOf(option) }
}

/** The Memo as printed on one Version: the correct letter index per printed position (null when not set). */
export function printedMemo(a: Pick<Assessment, 'questions'>, plan: VersionPlan): (number | null)[] {
  return plan.questionOrder.map((q, pos) => {
    const answer = a.questions[q].answer
    return answer === null ? null : plan.optionOrder[pos].indexOf(answer)
  })
}
