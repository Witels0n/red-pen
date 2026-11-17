// The Assessment file: one JSON file with the Assessment, its Class list link and its results
// (reads and Review decisions; never scans). Versioned, and checked thoroughly on import.
import {
  MAX_MARKS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_VERSIONS,
  MIN_OPTIONS,
  newId,
  VERSION_LETTERS,
  type Assessment,
  type Decision,
  type PrintSettings,
  type Question,
  type ScannedPage,
  type StoredRead,
  type VersionPlan,
} from './model'
import { safeFileName } from './questions-csv'

export const FILE_FORMAT = 'red-pen-mcq-assessment'
export const FILE_SCHEMA = 1

export interface AssessmentFile {
  format: typeof FILE_FORMAT
  schema: number
  exportedAt: string
  assessment: Assessment
  /** For people reading the file: the linked Class list's name. Learner names are never in the file. */
  className?: string
}

export function assessmentToFile(a: Assessment, className?: string, now = new Date()): string {
  const file: AssessmentFile = {
    format: FILE_FORMAT,
    schema: FILE_SCHEMA,
    exportedAt: now.toISOString(),
    ...(className ? { className } : {}),
    assessment: a,
  }
  return JSON.stringify(file, null, 2)
}

export function assessmentFileName(a: Pick<Assessment, 'title'>): string {
  return `${safeFileName(a.title)} assessment.json`
}

export type AssessmentFileResult = { ok: true; assessment: Assessment } | { ok: false; problems: string[] }

/** "assessment.questions[3].marks" -> "Question 4: marks". */
function readablePath(path: string): string {
  const p = path
    .replace(/^assessment\.questions\[(\d+)\]\.?/, (_, i) => `Question ${Number(i) + 1}: `)
    .replace(/^assessment\.scans\[(\d+)\]\.?/, (_, i) => `Scanned page ${Number(i) + 1}: `)
    .replace(/^assessment\.?/, '')
  return (p.endsWith(': ') ? p.slice(0, -2) : p) || 'The assessment'
}

/** A small checker that collects every problem with a path, rather than stopping at the first. */
class Checker {
  problems: string[] = []
  fail(path: string, wants: string): void {
    if (this.problems.length < 12) this.problems.push(`${readablePath(path)} ${wants}.`)
  }
  object(v: unknown, path: string): Record<string, unknown> | null {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
    this.fail(path, 'must be an object')
    return null
  }
  array(v: unknown, path: string, min = 0, max = Infinity): unknown[] | null {
    if (!Array.isArray(v)) {
      this.fail(path, 'must be a list')
      return null
    }
    if (v.length < min || v.length > max) {
      this.fail(path, `must have ${min === max ? min : `${min} to ${max}`} items, not ${v.length}`)
      return null
    }
    return v
  }
  string(v: unknown, path: string, max = 10_000): string {
    if (typeof v !== 'string' || v.length > max) {
      this.fail(path, 'must be text')
      return ''
    }
    return v
  }
  number(v: unknown, path: string, min: number, max: number, integer = false): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      this.fail(path, `must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`)
      return min
    }
    return v
  }
  boolean(v: unknown, path: string): boolean {
    if (typeof v !== 'boolean') this.fail(path, 'must be true or false')
    return v === true
  }
  oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
    if (typeof v !== 'string' || !options.includes(v as T)) {
      this.fail(path, `must be one of ${options.join(', ')}`)
      return options[0]
    }
    return v as T
  }
}

function isPermutation(order: unknown, n: number): boolean {
  return (
    Array.isArray(order) &&
    order.length === n &&
    new Set(order).size === n &&
    order.every((x) => Number.isInteger(x) && x >= 0 && x < n)
  )
}

function checkQuestion(c: Checker, v: unknown, path: string): Question {
  const o = c.object(v, path) ?? {}
  const options = (c.array(o.options, `${path}.options`, MIN_OPTIONS, MAX_OPTIONS) ?? ['', '', '', '']).map((t, k) =>
    c.string(t, `${path}.options[${k}]`),
  )
  const misconceptions = (
    c.array(o.misconceptions, `${path}.misconceptions`, options.length, options.length) ?? options.map(() => '')
  ).map((t, k) => c.string(t, `${path}.misconceptions[${k}]`))
  const answer = o.answer === null ? null : c.number(o.answer, `${path}.answer`, 0, options.length - 1, true)
  return {
    id: c.string(o.id, `${path}.id`, 100) || newId(),
    text: c.string(o.text, `${path}.text`),
    options,
    answer,
    marks: c.number(o.marks, `${path}.marks`, 0.5, MAX_MARKS),
    topic: c.string(o.topic, `${path}.topic`, 200),
    misconceptions,
  }
}

function checkPlan(c: Checker, v: unknown, path: string, questions: Question[], index: number): VersionPlan {
  const o = c.object(v, path) ?? {}
  const version = c.oneOf(o.version, VERSION_LETTERS, `${path}.version`)
  if (version !== VERSION_LETTERS[index]) c.fail(`${path}.version`, `must be ${VERSION_LETTERS[index]}`)
  const n = questions.length
  if (!isPermutation(o.questionOrder, n)) c.fail(`${path}.questionOrder`, `must list each of the ${n} questions once`)
  const questionOrder = isPermutation(o.questionOrder, n) ? (o.questionOrder as number[]) : questions.map((_, i) => i)
  const optionOrder = (c.array(o.optionOrder, `${path}.optionOrder`, n, n) ?? []).map((order, p) => {
    const options = questions[questionOrder[p]]?.options.length ?? 0
    if (!isPermutation(order, options))
      c.fail(`${path}.optionOrder[${p}]`, `must list each of the ${options} options once`)
    return order as number[]
  })
  return { version, questionOrder, optionOrder }
}

function checkPrint(c: Checker, v: unknown, path: string): PrintSettings {
  const o = c.object(v, path) ?? {}
  return {
    mode: c.oneOf(o.mode, ['named-qr', 'id-qr', 'bubbled-id'] as const, `${path}.mode`),
    classId: o.classId === null ? null : c.string(o.classId, `${path}.classId`, 100),
    idDigits: c.number(o.idDigits, `${path}.idDigits`, 1, 4, true),
    copies: c.number(o.copies, `${path}.copies`, 0, 9999, true),
    spares: c.number(o.spares, `${path}.spares`, 0, 999, true),
    assign: c.oneOf(o.assign, ['round-robin', 'single'] as const, `${path}.assign`),
    singleVersion: c.oneOf(o.singleVersion, VERSION_LETTERS, `${path}.singleVersion`),
  }
}

function checkAnswer(c: Checker, v: unknown, path: string): number | null | 'multiple' {
  if (v === null || v === 'multiple') return v
  return c.number(v, path, 0, MAX_OPTIONS - 1, true)
}

function checkRead(c: Checker, v: unknown, path: string): StoredRead {
  const o = c.object(v, path) ?? {}
  const answers = (c.array(o.answers, `${path}.answers`, 0, 50) ?? []).map((x, i) =>
    checkAnswer(c, x, `${path}.answers[${i}]`),
  )
  const confidences = (c.array(o.confidences, `${path}.confidences`, answers.length, answers.length) ?? []).map(
    (x, i) => c.number(x, `${path}.confidences[${i}]`, 0, 1),
  )
  const flags = (c.array(o.flags, `${path}.flags`, answers.length, answers.length) ?? []).map((list, i) =>
    (c.array(list, `${path}.flags[${i}]`, 0, 4) ?? []).map((f) =>
      c.oneOf(f, ['light', 'erasure', 'multiple', 'misaligned'] as const, `${path}.flags[${i}]`),
    ),
  )
  const read: StoredRead = {
    ok: c.boolean(o.ok, `${path}.ok`),
    idSource: c.oneOf(o.idSource, ['qr', 'bubbles'] as const, `${path}.idSource`),
    idConfidence: c.number(o.idConfidence, `${path}.idConfidence`, 0, 1),
    page: c.number(o.page, `${path}.page`, 1, 9, true),
    pages: c.number(o.pages, `${path}.pages`, 1, 9, true),
    questionStart: c.number(o.questionStart, `${path}.questionStart`, 0, MAX_QUESTIONS, true),
    answers,
    confidences,
    flags,
    problems: (c.array(o.problems, `${path}.problems`, 0, 50) ?? []).map((p, i) =>
      c.string(p, `${path}.problems[${i}]`, 1000),
    ),
  }
  if (o.kind !== undefined) read.kind = c.oneOf(o.kind, ['answer-sheet', 'cover'] as const, `${path}.kind`)
  if (o.learnerId !== undefined) read.learnerId = checkLearnerId(c, o.learnerId, `${path}.learnerId`)
  if (o.assessmentCode !== undefined) read.assessmentCode = c.string(o.assessmentCode, `${path}.assessmentCode`, 6)
  if (o.version !== undefined) read.version = c.oneOf(o.version, VERSION_LETTERS, `${path}.version`)
  return read
}

function checkLearnerId(c: Checker, v: unknown, path: string): string {
  const s = c.string(v, path, 100)
  if (!/^\d{1,4}$/.test(s)) c.fail(path, 'must be a Learner ID of 1 to 4 digits')
  return s
}

function checkScan(c: Checker, v: unknown, path: string): ScannedPage {
  const o = c.object(v, path) ?? {}
  const decisionsIn = c.object(o.decisions, `${path}.decisions`) ?? {}
  const decisions: Record<string, Decision> = {}
  for (const [k, d] of Object.entries(decisionsIn)) {
    if (!/^\d+$/.test(k)) c.fail(`${path}.decisions`, 'must be keyed by question index')
    else if (d === 'blank' || d === 'multiple') decisions[k] = d
    else decisions[k] = c.number(d, `${path}.decisions.${k}`, 0, MAX_OPTIONS - 1, true)
  }
  const scan: ScannedPage = {
    id: c.string(o.id, `${path}.id`, 100),
    fileName: c.string(o.fileName, `${path}.fileName`, 500),
    filePage: c.number(o.filePage, `${path}.filePage`, 1, 100_000, true),
    read: checkRead(c, o.read, `${path}.read`),
    decisions,
    addedAt: c.number(o.addedAt, `${path}.addedAt`, 0, 1e15),
  }
  if (o.learnerId !== undefined) scan.learnerId = checkLearnerId(c, o.learnerId, `${path}.learnerId`)
  if (o.learnerConfirmed !== undefined)
    scan.learnerConfirmed = c.boolean(o.learnerConfirmed, `${path}.learnerConfirmed`)
  if (o.version !== undefined) scan.version = c.oneOf(o.version, VERSION_LETTERS, `${path}.version`)
  if (o.ignored !== undefined) scan.ignored = c.boolean(o.ignored, `${path}.ignored`)
  return scan
}

/** Reads an Assessment file. Every problem found is listed, in words for the teacher. */
export function assessmentFromFile(text: string): AssessmentFileResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, problems: ['This is not an Assessment file: it is not valid JSON.'] }
  }
  const root = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  if (root.format !== FILE_FORMAT) {
    return { ok: false, problems: ['This is not a Red Pen Assessment file.'] }
  }
  if (typeof root.schema !== 'number' || !Number.isInteger(root.schema) || root.schema < 1) {
    return { ok: false, problems: ['The file does not say which version of the format it uses.'] }
  }
  if (root.schema > FILE_SCHEMA) {
    return { ok: false, problems: ['This file was made by a newer version of Red Pen. Reload the page to update it.'] }
  }

  const c = new Checker()
  const a = c.object(root.assessment, 'assessment') ?? {}
  const questions = (c.array(a.questions, 'assessment.questions', 1, MAX_QUESTIONS) ?? []).map((q, i) =>
    checkQuestion(c, q, `assessment.questions[${i}]`),
  )
  const v = c.object(a.versions, 'assessment.versions') ?? {}
  const count = c.number(v.count, 'assessment.versions.count', 1, MAX_VERSIONS, true)
  const plans = (c.array(v.plans, 'assessment.versions.plans', count, count) ?? []).map((p, i) =>
    checkPlan(c, p, `assessment.versions.plans[${i}]`, questions, i),
  )
  const assessment: Assessment = {
    id: c.string(a.id, 'assessment.id', 100),
    title: c.string(a.title, 'assessment.title', 300),
    questions,
    versions: {
      count,
      shuffleQuestions: c.boolean(v.shuffleQuestions, 'assessment.versions.shuffleQuestions'),
      shuffleOptions: c.boolean(v.shuffleOptions, 'assessment.versions.shuffleOptions'),
      seed: c.number(v.seed, 'assessment.versions.seed', 0, 2 ** 32 - 1, true),
      plans,
    },
    print: checkPrint(c, a.print, 'assessment.print'),
    scans: (c.array(a.scans, 'assessment.scans', 0, 5000) ?? []).map((s, i) =>
      checkScan(c, s, `assessment.scans[${i}]`),
    ),
    createdAt: c.number(a.createdAt, 'assessment.createdAt', 0, 1e15),
    updatedAt: c.number(a.updatedAt, 'assessment.updatedAt', 0, 1e15),
  }
  if (!assessment.id) c.fail('assessment.id', 'must not be empty')
  if (c.problems.length) return { ok: false, problems: ['This Assessment file has problems:', ...c.problems] }
  return { ok: true, assessment }
}
