// Versions: shuffled orders of questions and options, planned from a stored seed so a reprint
// always matches. Version A is the shared paper: the questions in the entered order, with each
// question's options shuffled once when the shared shuffle is on. Marking maps every Version back
// to the entered ("original") order, so the Memo the teacher typed stays correct.
import type { SheetQuestion, SheetVersion } from '../../shared/omr/types'
import {
  hasPrintedContent,
  identityPlan,
  MAX_VERSIONS,
  VERSION_LETTERS,
  type Assessment,
  type PrintableQuestion,
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

/** The settings that decide the plans. `shuffleShared` is off when left out. */
export type PlanSettings = Pick<VersionSettings, 'count' | 'shuffleQuestions' | 'shuffleOptions' | 'seed'> &
  Partial<Pick<VersionSettings, 'shuffleShared'>>

/** Whether the shared paper's options are shuffled: asked for, and there is a question paper to print. */
export function sharedShuffleActive(
  questions: readonly PrintableQuestion[],
  settings: Pick<PlanSettings, 'shuffleShared'>,
): boolean {
  return settings.shuffleShared === true && hasPrintedContent(questions)
}

/**
 * The shared paper (Version A): the entered question order, and each question's options shuffled
 * when `shuffle` is on. Each question has its own random stream, so adding a question at the end
 * never changes how the others print.
 */
export function sharedPlan(questions: readonly PrintableQuestion[], seed: number, shuffle: boolean): VersionPlan {
  if (!shuffle) return identityPlan('A', questions)
  return {
    version: 'A',
    questionOrder: range(questions.length),
    optionOrder: questions.map((q, i) =>
      shuffled(range(q.options.length), seededRandom((seed ^ Math.imul(i + 1, 0x85ebca6b) ^ 0x5bd1e995) >>> 0)),
    ),
  }
}

/**
 * The plans for every Version. Deterministic: the same questions (count, options per question and
 * whether there is anything to print) and settings always give the same plans.
 */
export function planVersions(questions: readonly PrintableQuestion[], settings: PlanSettings): VersionPlan[] {
  const count = Math.max(1, Math.min(MAX_VERSIONS, Math.round(settings.count)))
  const plans = [sharedPlan(questions, settings.seed, sharedShuffleActive(questions, settings))]
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

/** Whether a plan prints every question's options in the entered order. */
export function keepsOptionOrder(plan: VersionPlan): boolean {
  return plan.optionOrder.every((o) => o.every((k, i) => k === i))
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

/** How unevenly the correct answers fall across the letters on a plan: 0 is perfectly even. */
export function spreadScore(questions: readonly Pick<Question, 'options' | 'answer'>[], plan: VersionPlan): number {
  const letters = Math.max(0, ...questions.map((q) => q.options.length))
  const counts = Array.from({ length: letters }, () => 0)
  const expected = Array.from({ length: letters }, () => 0)
  plan.questionOrder.forEach((original, position) => {
    const q = questions[original]
    if (q.answer === null) return
    counts[plan.optionOrder[position].indexOf(q.answer)]++
    for (let k = 0; k < q.options.length; k++) expected[k] += 1 / q.options.length
  })
  return counts.reduce((sum, c, k) => sum + (c - expected[k]) ** 2, 0)
}

const BALANCE_TRIES = 96

/**
 * A seed for the shared paper that spreads the Memo's correct answers as evenly as it can across
 * the letters: the best of a fixed set of candidates derived from `seed` (so it is deterministic).
 */
export function balancedSeed(
  questions: readonly (PrintableQuestion & Pick<Question, 'answer'>)[],
  seed: number,
): number {
  let best = seed >>> 0
  let bestScore = Infinity
  for (let i = 0; i < BALANCE_TRIES; i++) {
    const candidate = i === 0 ? seed >>> 0 : (seed ^ Math.imul(i, 0x27d4eb2d)) >>> 0
    const score = spreadScore(questions, sharedPlan(questions, candidate, true))
    if (score < bestScore - 1e-9) {
      best = candidate
      bestScore = score
      if (score < 1e-9) break
    }
  }
  return best
}

/**
 * The Assessment with plans that fit its questions, re-planned only when they no longer fit. The
 * shared paper is also re-planned when the shared shuffle turns on or off in effect, for example
 * when the first question text or picture is added to an answers-only Assessment. When a single
 * shared paper is planned afresh before anything is marked, its seed is chosen so the correct
 * answers spread evenly across the letters.
 */
export function refreshVersions(a: Assessment): Assessment {
  const fits = plansFit(a)
  const active = sharedShuffleActive(a.questions, a.versions)
  if (fits) {
    if (active !== keepsOptionOrder(a.versions.plans[0])) return a
    // A shuffle that happens to keep every option in place is still the right plan.
    if (active && keepsOptionOrder(sharedPlan(a.questions, a.versions.seed, true))) return a
  }
  let versions = a.versions
  if (active && versions.count === 1 && a.scans.length === 0) {
    const seed = balancedSeed(a.questions, versions.seed)
    if (seed !== versions.seed) versions = { ...versions, seed }
  }
  if (!fits || versions !== a.versions)
    return { ...a, versions: { ...versions, plans: planVersions(a.questions, versions) } }
  const fresh = sharedPlan(a.questions, a.versions.seed, active)
  return { ...a, versions: { ...a.versions, plans: [fresh, ...a.versions.plans.slice(1)] } }
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
