// Questions as CSV, for editing in a spreadsheet and moving between Assessments. Round-trip safe.
//
// Columns (a header row is required; columns may be in any order, and unknown columns are ignored):
//   number            the question number (for people; rows are taken in file order)
//   question          the question text (optional)
//   A, B, C, D, E     the option texts (optional)
//   answer            the Memo letter, A to E (empty when not set yet)
//   marks             marks for the question (default 1)
//   topic             the Topic (optional)
//   misconception_A to misconception_E   why a learner might choose that wrong option (optional)
//   options           how many options the question has, 2 to 5 (optional: without it, the last
//                     option letter used by an option text, the answer or a misconception, and at
//                     least 2; or 4 when the row uses none)
import { parseCsv, writeCsv } from '../../shared/classes/csv'
import {
  DEFAULT_OPTIONS,
  formatNumber,
  letter,
  MAX_MARKS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  newQuestion,
  OPTION_LETTERS,
  optionFromLetter,
  type Question,
} from './model'

const LETTERS = [...OPTION_LETTERS]
export const QUESTION_CSV_HEADER = [
  'number',
  'question',
  ...LETTERS,
  'answer',
  'marks',
  'topic',
  ...LETTERS.map((l) => `misconception_${l}`),
  'options',
]

export function questionsToCsv(questions: readonly Question[]): string {
  const rows = questions.map((q, i) => [
    String(i + 1),
    q.text,
    ...LETTERS.map((_, k) => q.options[k] ?? ''),
    q.answer === null ? '' : letter(q.answer),
    formatNumber(q.marks),
    q.topic,
    ...LETTERS.map((_, k) => (k < q.options.length ? (q.misconceptions[k] ?? '') : '')),
    String(q.options.length),
  ])
  return writeCsv([QUESTION_CSV_HEADER, ...rows])
}

export type QuestionsCsvResult = { ok: true; questions: Question[] } | { ok: false; problems: string[] }

/** "Misconception A", "misconception-a" and "MISCONCEPTION_A" all name the same column. */
function columnKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
}

const MAX_PROBLEMS = 10

export function questionsFromCsv(text: string): QuestionsCsvResult {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, problems: ['The file is empty.'] }
  const header = rows[0].map(columnKey)
  const col = (name: string) => header.indexOf(name)
  const known = new Set(QUESTION_CSV_HEADER.map(columnKey))
  if (!header.some((h) => known.has(h) && h !== 'number')) {
    return {
      ok: false,
      problems: [
        'The first row must name the columns, for example number, question, A, B, C, D, answer, marks, topic.',
      ],
    }
  }

  const problems: string[] = []
  const questions: Question[] = []
  const cell = (row: string[], name: string) => {
    const i = col(name)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }

  rows.slice(1).forEach((row, r) => {
    const line = r + 2
    if (row.every((v) => v.trim() === '')) return
    const say = (p: string) => problems.push(`Row ${line}: ${p}`)

    const optionTexts = LETTERS.map((l) => cell(row, columnKey(l)))
    const misconceptions = LETTERS.map((l) => cell(row, `misconception_${l.toLowerCase()}`))
    const answerText = cell(row, 'answer')
    const answer = answerText === '' ? null : optionFromLetter(answerText)
    if (answerText !== '' && answer === null) say(`the answer "${answerText}" must be a letter from A to E.`)

    let options: number
    const optionsText = cell(row, 'options')
    if (optionsText !== '') {
      options = Number(optionsText)
      if (!Number.isInteger(options) || options < MIN_OPTIONS || options > MAX_OPTIONS) {
        say(`"${optionsText}" options: a question has 2 to 5 options.`)
        options = DEFAULT_OPTIONS
      }
    } else {
      const lastUsed = Math.max(
        ...optionTexts.map((t, k) => (t ? k : -1)),
        ...misconceptions.map((t, k) => (t ? k : -1)),
        answer ?? -1,
      )
      options = lastUsed < 0 ? DEFAULT_OPTIONS : Math.max(MIN_OPTIONS, lastUsed + 1)
    }
    if (answer !== null && answer >= options)
      say(`the answer ${answerText.toUpperCase()} is not one of its ${options} options.`)
    optionTexts.forEach((t, k) => {
      if (t && k >= options) say(`option ${LETTERS[k]} has text, but the question has ${options} options.`)
    })

    const marksText = cell(row, 'marks')
    let marks = 1
    if (marksText !== '') {
      marks = Number(marksText.replace(',', '.'))
      if (!Number.isFinite(marks) || marks <= 0 || marks > MAX_MARKS) {
        say(`"${marksText}" marks: use a number from 0.5 to ${MAX_MARKS}.`)
        marks = 1
      }
    }

    const q = newQuestion(options, marks)
    q.text = cell(row, 'question')
    q.options = optionTexts.slice(0, options)
    q.misconceptions = misconceptions.slice(0, options)
    q.answer = answer !== null && answer < options ? answer : null
    q.topic = cell(row, 'topic')
    questions.push(q)
  })

  if (questions.length === 0) problems.push('The file has a header row but no questions.')
  if (questions.length > MAX_QUESTIONS)
    problems.push(`An assessment has at most ${MAX_QUESTIONS} questions, not ${questions.length}.`)
  if (problems.length) {
    const shown = problems.slice(0, MAX_PROBLEMS)
    if (problems.length > MAX_PROBLEMS) shown.push(`And ${problems.length - MAX_PROBLEMS} more problems.`)
    return { ok: false, problems: shown }
  }
  return { ok: true, questions }
}

/** "Grade 9 test" -> "Grade 9 test questions.csv". */
export function questionsFileName(title: string): string {
  return `${safeFileName(title)} questions.csv`
}

/** A file name without characters that file systems refuse. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'assessment'
  )
}
