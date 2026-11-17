// The Assessment: questions, options, marks, Memo, Topics, Versions, print settings and the
// results of marking (reads and Review decisions, never images). Pure data and pure functions.
import type { Learner } from '../../shared/classes/types'
import type { Answer, IdentityMode, QuestionFlag, SheetVersion } from '../../shared/omr'

export const OPTION_LETTERS = 'ABCDE'
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 5
export const DEFAULT_OPTIONS = 4
/** The sheet engine prints up to 200 questions (four pages). */
export const MAX_QUESTIONS = 200
export const MAX_VERSIONS = 4
export const VERSION_LETTERS: readonly SheetVersion[] = ['A', 'B', 'C', 'D']
export const MAX_MARKS = 100

/** A picture in a question or an option: a PNG or JPEG data URL, already downscaled, with its size in pixels. */
export interface QuestionImage {
  src: string
  width: number
  height: number
}

export interface Question {
  /** Stable id, so a question keeps its identity when copied from the question bank. */
  id: string
  /** Optional: printed in the question booklet. */
  text: string
  /** Option texts (may be empty). The length is the number of options, 2 to 5. */
  options: string[]
  /** The Memo for this question: the index of the correct option (0 is A), or null when not set yet. */
  answer: number | null
  marks: number
  /** Free text, for example "Fractions". Empty when the question has no Topic. */
  topic: string
  /** Per option, the misconception a learner who chose it probably has. Empty when none. */
  misconceptions: string[]
  /** Optional: a picture printed with the question text in the booklet. */
  image?: QuestionImage
  /** Optional: a picture per option (null for none), in the same order as `options`. */
  optionImages?: (QuestionImage | null)[]
}

/** How one Version prints the Assessment. Indexes are 0-based. */
export interface VersionPlan {
  version: SheetVersion
  /** questionOrder[p] is the original question printed at position p. */
  questionOrder: number[]
  /** optionOrder[p][k] is the original option printed as letter k at position p. */
  optionOrder: number[][]
}

export interface VersionSettings {
  /** 1 to 4. */
  count: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  /**
   * The shared paper (Version A) prints each question's options in a shuffled order, the same for
   * everyone, so the correct answers spread across the letters. Only when the paper has question
   * text or pictures: an answers-only Assessment always prints in the entered order.
   */
  shuffleShared: boolean
  /** Seeds the shuffle, so the same settings always give the same Versions. */
  seed: number
  /** Stored, so a reprint matches what was printed before. Version A keeps the question order. */
  plans: VersionPlan[]
}

export type VersionAssignment = 'round-robin' | 'single'

/** Who is writing: no list (Bubbled ID only), a saved Class list, or a Learner list kept with the Assessment. */
export type LearnerSource = 'none' | 'class' | LearnerListSource
export type LearnerListSource = 'pasted' | 'numbers' | 'imported'
export const LEARNER_SOURCES: readonly LearnerSource[] = ['none', 'class', 'pasted', 'numbers', 'imported']

/** Learners kept with the Assessment rather than in a saved Class list. */
export interface LearnerList {
  source: LearnerListSource
  /** How many digits every Learner ID has (1 to 4). */
  idDigits: number
  learners: Learner[]
  /** For an imported list: the file it came from. */
  fileName?: string
}

export interface PrintSettings {
  mode: IdentityMode
  /** Where the learners come from. With a Learner list, it must be the Assessment's `learnerList`. */
  learnerSource: LearnerSource
  /** The saved Class list when `learnerSource` is 'class' (optional for Bubbled ID, where it only adds names). */
  classId: string | null
  /** Digits in a Bubbled ID (QR modes use the Class list's digits). */
  idDigits: number
  /** Bubbled ID: how many identical sheets to print. */
  copies: number
  /** QR modes: extra sheets with a blank name line, for new learners. */
  spares: number
  assign: VersionAssignment
  /** The Version everyone gets when `assign` is 'single'. */
  singleVersion: SheetVersion
}

/** A teacher's decision in Review for one question: an option on the sheet, blank, or "keep as multiple" (wrong). */
export type Decision = number | 'blank' | 'multiple'

/** What the reader saw on one page. A plain subset of SheetRead (no debug data). */
export interface StoredRead {
  ok: boolean
  kind?: 'answer-sheet' | 'cover'
  learnerId?: string
  idSource: 'qr' | 'bubbles'
  idConfidence: number
  assessmentCode?: string
  version?: SheetVersion
  page: number
  pages: number
  questionStart: number
  /** In the order printed on this page (the Version's order), option indexes as printed. */
  answers: Answer[]
  confidences: number[]
  flags: QuestionFlag[][]
  problems: string[]
}

/** One scanned or photographed page and what the teacher decided about it. */
export interface ScannedPage {
  id: string
  fileName: string
  /** Page within the uploaded file (1 for a photo). */
  filePage: number
  read: StoredRead
  /** Review decisions by question index on this page (0-based, as printed). */
  decisions: Record<string, Decision>
  /** Set in Review: whose sheet this is. Replaces what was read. */
  learnerId?: string
  /** The teacher has checked (or chosen) the learner. */
  learnerConfirmed?: boolean
  /** Set in Review when the Version could not be read. */
  version?: SheetVersion
  /** Left out of marking, for example the extra copy of a sheet scanned twice. */
  ignored?: boolean
  addedAt: number
}

export interface Assessment {
  id: string
  title: string
  questions: Question[]
  versions: VersionSettings
  print: PrintSettings
  /** Learners pasted, numbered or imported for this Assessment, or null. Used when `print.learnerSource` matches. */
  learnerList: LearnerList | null
  /** Results: every page read, with Review decisions. Images are never stored. */
  scans: ScannedPage[]
  createdAt: number
  updatedAt: number
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

export function letter(option: number): string {
  return OPTION_LETTERS[option] ?? '?'
}

/** "A" to 0, "e" to 4. Null for anything else. */
export function optionFromLetter(s: string): number | null {
  const i = OPTION_LETTERS.indexOf(s.trim().toUpperCase())
  return s.trim().length === 1 && i >= 0 ? i : null
}

export function newQuestion(options = DEFAULT_OPTIONS, marks = 1): Question {
  return {
    id: newId(),
    text: '',
    options: Array.from({ length: options }, () => ''),
    answer: null,
    marks,
    topic: '',
    misconceptions: Array.from({ length: options }, () => ''),
  }
}

export function defaultPrintSettings(): PrintSettings {
  return {
    mode: 'named-qr',
    learnerSource: 'pasted',
    classId: null,
    idDigits: 2,
    copies: 30,
    spares: 2,
    assign: 'round-robin',
    singleVersion: 'A',
  }
}

/**
 * A new, unsaved Assessment: one shared paper with the options shuffled once (it takes effect when
 * the questions have text or pictures). Versions are planned by `refreshVersions`.
 */
export function newAssessment(title: string, questions = 10, now = Date.now(), seed = randomSeed()): Assessment {
  const qs = Array.from({ length: questions }, () => newQuestion())
  return {
    id: newId(),
    title: title.trim() || 'Untitled assessment',
    questions: qs,
    versions: {
      count: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      shuffleShared: true,
      seed,
      plans: [identityPlan('A', qs)],
    },
    print: defaultPrintSettings(),
    learnerList: null,
    scans: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** The original (entered) order. */
export function identityPlan(version: SheetVersion, questions: readonly Pick<Question, 'options'>[]): VersionPlan {
  return {
    version,
    questionOrder: questions.map((_, i) => i),
    optionOrder: questions.map((q) => q.options.map((_, k) => k)),
  }
}

function resize<T>(items: readonly T[], length: number, fill: () => T): T[] {
  return Array.from({ length }, (_, i) => (i < items.length ? items[i] : fill()))
}

/** A question with a different number of options. A Memo beyond the new options is cleared. */
export function withOptionCount(q: Question, count: number): Question {
  const n = Math.max(MIN_OPTIONS, Math.min(MAX_OPTIONS, Math.round(count)))
  const out: Question = {
    ...q,
    options: resize(q.options, n, () => ''),
    misconceptions: resize(q.misconceptions, n, () => ''),
    answer: q.answer !== null && q.answer < n ? q.answer : null,
  }
  if (q.optionImages) {
    const images = resize(q.optionImages, n, () => null)
    if (images.some(Boolean)) out.optionImages = images
    else delete out.optionImages
  }
  return out
}

/** The picture of option k, or null. */
export function optionImage(q: Pick<Question, 'optionImages'>, k: number): QuestionImage | null {
  return q.optionImages?.[k] ?? null
}

/** The question with its picture set (or removed with null). */
export function withQuestionImage(q: Question, image: QuestionImage | null): Question {
  const out = { ...q }
  if (image) out.image = image
  else delete out.image
  return out
}

/** The question with option k's picture set (or removed with null). */
export function withOptionImage(q: Question, k: number, image: QuestionImage | null): Question {
  const images = q.options.map((_, j) => (j === k ? image : optionImage(q, j)))
  const out = { ...q }
  if (images.some(Boolean)) out.optionImages = images
  else delete out.optionImages
  return out
}

/** Whether the question has any picture. */
export function hasImages(q: Pick<Question, 'image' | 'optionImages'>): boolean {
  return Boolean(q.image) || (q.optionImages?.some(Boolean) ?? false)
}

/** Adds blank questions at the end, or removes questions from the end. */
export function withQuestionCount(a: Assessment, count: number): Assessment {
  const n = Math.max(1, Math.min(MAX_QUESTIONS, Math.round(count)))
  const last = a.questions[a.questions.length - 1]
  const options = last?.options.length ?? DEFAULT_OPTIONS
  const marks = last?.marks ?? 1
  return { ...a, questions: resize(a.questions, n, () => newQuestion(options, marks)) }
}

export function withQuestion(a: Assessment, index: number, change: Partial<Question>): Assessment {
  const questions = a.questions.slice()
  let q = { ...questions[index], ...change }
  if (change.options) q = withOptionCount(q, change.options.length)
  questions[index] = q
  return { ...a, questions }
}

/** Every Topic in use, in order of first use. */
export function topicsOf(questions: readonly Question[]): string[] {
  const seen = new Map<string, string>()
  for (const q of questions) {
    const t = q.topic.trim()
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  }
  return [...seen.values()]
}

/** Marks available from questions that have a Memo answer. */
export function totalMarks(questions: readonly Question[]): number {
  return questions.reduce((sum, q) => sum + (q.answer === null ? 0 : q.marks), 0)
}

/** Question numbers (1-based) that have no Memo answer yet. */
export function missingMemo(questions: readonly Question[]): number[] {
  return questions.flatMap((q, i) => (q.answer === null ? [i + 1] : []))
}

/** The parts of a question a question booklet prints. */
export type PrintableQuestion = Pick<Question, 'options'> & Partial<Pick<Question, 'text' | 'image' | 'optionImages'>>

/** Whether one question has text, option text or a picture to print. */
export function questionHasContent(q: PrintableQuestion): boolean {
  return (q.text ?? '').trim() !== '' || q.options.some((o) => o.trim() !== '') || hasImages(q)
}

/**
 * Whether there is a question paper to print: question text, option text or pictures. Without
 * any, the teacher uses their own paper, so the options print (and are marked) in the entered order.
 */
export function hasPrintedContent(questions: readonly PrintableQuestion[]): boolean {
  return questions.some(questionHasContent)
}

/** A copy with a new id (so a new Assessment code: its sheets must be printed again) and no results. */
export function duplicateAssessment(a: Assessment, now = Date.now()): Assessment {
  return {
    ...structuredClone(a),
    id: newId(),
    title: `${a.title} (copy)`,
    scans: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** A copy of a question for another Assessment, with a new id. */
export function copyQuestion(q: Question): Question {
  return { ...structuredClone(q), id: newId() }
}

/** "1 mark", "2 marks", "1.5 marks". */
export function marksText(n: number): string {
  return `${formatNumber(n)} mark${n === 1 ? '' : 's'}`
}

/** At most one decimal place, no trailing zero: 12, 12.5. */
export function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** A whole-number percentage, or a dash when there is nothing to divide by. */
export function percentText(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '-'
}

/** The learner source an Assessment saved before Learner lists existed used. */
export function legacyLearnerSource(print: Pick<PrintSettings, 'mode' | 'classId'>): LearnerSource {
  return print.mode === 'bubbled-id' && !print.classId ? 'none' : 'class'
}

/**
 * An Assessment saved by an earlier Red Pen, brought up to date without changing what it prints:
 * the shared shuffle stays off (its sheets were printed in the entered order), and its learners
 * still come from its Class list. An Assessment that is already current comes back unchanged.
 */
export function upgradeAssessment(a: Assessment): Assessment {
  const versions: Omit<VersionSettings, 'shuffleShared'> & { shuffleShared?: boolean } = a.versions
  const print: Omit<PrintSettings, 'learnerSource'> & { learnerSource?: LearnerSource } = a.print
  const learnerList: LearnerList | null | undefined = a.learnerList
  if (typeof versions.shuffleShared === 'boolean' && print.learnerSource && learnerList !== undefined) return a
  return {
    ...a,
    versions: { ...versions, shuffleShared: versions.shuffleShared ?? false },
    print: { ...print, learnerSource: print.learnerSource ?? legacyLearnerSource(print) },
    learnerList: learnerList ?? null,
  }
}
