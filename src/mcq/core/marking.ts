// Marking: gathers the scanned pages into one answer per learner per question, in the original
// question order, applies the teacher's Review decisions, and marks against the Memo.
// Re-run from the stored reads whenever anything changes, so a Memo correction re-marks instantly.
import { REVIEW_THRESHOLD } from '../../shared/omr/classify'
import type { Answer, SheetVersion } from '../../shared/omr/types'
import type { Assessment, Decision, ScannedPage } from './model'
import { planFor, toOriginal } from './versions'

/** A learner's answer to one original question: an original option, blank, multiple, or on a page not scanned. */
export type Response = number | null | 'multiple' | 'missing'

/** One learner's sheets put together. */
export interface LearnerSheets {
  learnerId: string
  /** The Version on the learner's first page. */
  version?: SheetVersion
  /** The pages used, in page order. */
  pageIds: string[]
  /** Per original question. */
  responses: Response[]
  /** Page numbers that were expected but not scanned. */
  missingPages: number[]
}

export type ReviewItem =
  | {
      kind: 'answer'
      pageId: string
      /** Index on the page (as in read.answers). */
      index: number
      /** Question number as printed on the learner's Version (1-based). */
      printedNumber: number
      read: Answer
      confidence: number
      /** Why it needs a look, in words for the teacher. */
      reason: string
    }
  | {
      kind: 'identity'
      pageId: string
      reason: 'unknown' | 'not-on-list' | 'unsure'
      readId?: string
    }
  | { kind: 'duplicate'; learnerId: string; page: number; pageIds: string[] }
  | { kind: 'version'; pageId: string }

/** A stable key for a Review item, so the queue can keep its place while items are resolved. */
export function reviewKey(item: ReviewItem): string {
  switch (item.kind) {
    case 'answer':
      return `answer:${item.pageId}:${item.index}`
    case 'duplicate':
      return `duplicate:${item.learnerId}:${item.page}`
    default:
      return `${item.kind}:${item.pageId}`
  }
}

export function decisionToAnswer(d: Decision): Answer {
  return d === 'blank' ? null : d
}

/** The answer on a page after Review: the teacher's decision when there is one, otherwise the read. */
export function pageAnswer(page: ScannedPage, index: number): Answer {
  const d = page.decisions[String(index)]
  return d === undefined ? page.read.answers[index] : decisionToAnswer(d)
}

export function pageLearner(page: ScannedPage): string | undefined {
  return page.learnerId ?? page.read.learnerId
}

export function pageVersion(page: ScannedPage): SheetVersion | undefined {
  return page.version ?? page.read.version
}

/** Pages that take part in marking: read as answer sheets and not set aside. */
export function usablePages(a: Pick<Assessment, 'scans'>): ScannedPage[] {
  return a.scans.filter((p) => p.read.ok && p.read.kind !== 'cover' && !p.ignored)
}

function flagReason(page: ScannedPage, index: number): string {
  const read = page.read.answers[index]
  const flags = page.read.flags[index] ?? []
  if (read === 'multiple') return 'More than one circle is filled (or one is crossed out).'
  if (flags.includes('misaligned')) return 'This part of the sheet did not line up well.'
  if (flags.includes('erasure')) return 'Another circle may be rubbed out.'
  if (flags.includes('light')) return 'The mark is light.'
  return 'The read is uncertain.'
}

function needsAnswerReview(page: ScannedPage, index: number): boolean {
  if (page.decisions[String(index)] !== undefined) return false
  const read = page.read.answers[index]
  return (
    read === 'multiple' ||
    (page.read.confidences[index] ?? 0) < REVIEW_THRESHOLD ||
    (page.read.flags[index]?.length ?? 0) > 0
  )
}

export interface Collation {
  learners: LearnerSheets[]
  review: ReviewItem[]
  /** Pages that could not be read at all (with the reason in read.problems). */
  unreadable: ScannedPage[]
}

/**
 * Puts the pages together per learner and lists what needs Review. `roster` is the Class list's
 * Learner IDs, when there is one: sheets with an ID not on it go to Review.
 */
export function collate(
  a: Pick<Assessment, 'questions' | 'versions' | 'scans'>,
  roster?: ReadonlySet<string>,
): Collation {
  const review: ReviewItem[] = []
  const unreadable = a.scans.filter((p) => !p.ignored && (!p.read.ok || p.read.kind === 'cover'))
  const pages = usablePages(a)
  const n = a.questions.length

  // Identity and Version first: answers cannot be placed until both are known.
  const byLearner = new Map<string, ScannedPage[]>()
  for (const p of pages) {
    const id = pageLearner(p)
    if (!p.learnerConfirmed) {
      if (!id) review.push({ kind: 'identity', pageId: p.id, reason: 'unknown' })
      else if (roster && !roster.has(id))
        review.push({ kind: 'identity', pageId: p.id, reason: 'not-on-list', readId: id })
      else if (p.read.idSource === 'bubbles' && p.read.idConfidence < REVIEW_THRESHOLD && !p.learnerId) {
        review.push({ kind: 'identity', pageId: p.id, reason: 'unsure', readId: id })
      }
    }
    if (!pageVersion(p) || !planFor(a, pageVersion(p)!)) review.push({ kind: 'version', pageId: p.id })
    if (id) byLearner.set(id, [...(byLearner.get(id) ?? []), p])
  }

  const learners: LearnerSheets[] = []
  for (const [learnerId, group] of byLearner) {
    const byPage = new Map<number, ScannedPage[]>()
    for (const p of group) byPage.set(p.read.page, [...(byPage.get(p.read.page) ?? []), p])
    for (const [page, same] of byPage) {
      if (same.length > 1) review.push({ kind: 'duplicate', learnerId, page, pageIds: same.map((p) => p.id) })
    }
    const pageCount = Math.max(...group.map((p) => p.read.pages))
    const responses: Response[] = Array.from({ length: n }, () => 'missing')
    const used: ScannedPage[] = []
    const missingPages: number[] = []
    for (let page = 1; page <= pageCount; page++) {
      // While a duplicate is unresolved, the first copy scanned counts.
      const p = byPage.get(page)?.[0]
      if (!p) {
        missingPages.push(page)
        continue
      }
      used.push(p)
      const plan = planFor(a, pageVersion(p) ?? 'A')
      if (!pageVersion(p) || !plan) continue
      p.read.answers.forEach((_, i) => {
        const position = p.read.questionStart + i
        if (position >= n) return
        const answer = pageAnswer(p, i)
        const original = typeof answer === 'number' ? toOriginal(plan, position, answer) : null
        const question = plan.questionOrder[position]
        responses[question] = original ? original.option : answer
      })
    }
    learners.push({
      learnerId,
      version: pageVersion(used[0] ?? group[0]),
      pageIds: used.map((p) => p.id),
      responses,
      missingPages,
    })
  }

  for (const p of pages) {
    p.read.answers.forEach((_, i) => {
      if (!needsAnswerReview(p, i)) return
      review.push({
        kind: 'answer',
        pageId: p.id,
        index: i,
        printedNumber: p.read.questionStart + i + 1,
        read: p.read.answers[i],
        confidence: p.read.confidences[i] ?? 0,
        reason: flagReason(p, i),
      })
    })
  }

  learners.sort((x, y) => x.learnerId.localeCompare(y.learnerId))
  return { learners, review, unreadable }
}

/** How one question went for one learner. */
export type Outcome = 'correct' | 'wrong' | 'blank' | 'multiple' | 'missing' | 'unmarked'

export interface QuestionMark {
  response: Response
  outcome: Outcome
  earned: number
}

export interface TopicScore {
  topic: string
  earned: number
  possible: number
}

export interface LearnerMark {
  learnerId: string
  version?: SheetVersion
  missingPages: number[]
  perQuestion: QuestionMark[]
  score: number
  outOf: number
  /** 0 to 1. */
  fraction: number
  topics: TopicScore[]
}

export function outcomeOf(response: Response, answer: number | null): Outcome {
  if (answer === null) return 'unmarked'
  if (response === 'missing') return 'missing'
  if (response === null) return 'blank'
  if (response === 'multiple') return 'multiple'
  return response === answer ? 'correct' : 'wrong'
}

/** Marks one learner against the current Memo. Questions without a Memo answer are left out of the total. */
export function markLearner(a: Pick<Assessment, 'questions'>, sheets: LearnerSheets): LearnerMark {
  const topics = new Map<string, TopicScore>()
  let score = 0
  let outOf = 0
  const perQuestion = a.questions.map((q, i): QuestionMark => {
    const response = i < sheets.responses.length ? sheets.responses[i] : 'missing'
    const outcome = outcomeOf(response, q.answer)
    const earned = outcome === 'correct' ? q.marks : 0
    if (outcome !== 'unmarked') {
      score += earned
      outOf += q.marks
      const topic = q.topic.trim()
      if (topic) {
        const key = topic.toLowerCase()
        const t = topics.get(key) ?? { topic, earned: 0, possible: 0 }
        t.earned += earned
        t.possible += q.marks
        topics.set(key, t)
      }
    }
    return { response, outcome, earned }
  })
  return {
    learnerId: sheets.learnerId,
    version: sheets.version,
    missingPages: sheets.missingPages,
    perQuestion,
    score,
    outOf,
    fraction: outOf > 0 ? score / outOf : 0,
    topics: [...topics.values()],
  }
}

export function markAll(a: Pick<Assessment, 'questions'>, learners: readonly LearnerSheets[]): LearnerMark[] {
  return learners.map((l) => markLearner(a, l))
}
