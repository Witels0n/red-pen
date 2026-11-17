// The marksheet as plain rows: one row per learner with total, percentage, marks per question
// and percentage per Topic. Shared by the on-screen table, the CSV and the XLSX file.
import { writeCsv } from '../../shared/classes/csv'
import { type ItemStats } from './analysis'
import type { LearnerMark, Outcome } from './marking'
import { formatNumber, letter, topicsOf, type Assessment } from './model'

export interface MarksheetRow {
  learnerId: string
  name: string
  version: string
  score: number
  outOf: number
  /** 0 to 100, rounded to a whole number. */
  percent: number
  /** Marks earned per original question. */
  questions: number[]
  outcomes: Outcome[]
  /** Per Topic in topicsOf order: 0 to 100 rounded, or null when the Topic has no marked questions. */
  topics: (number | null)[]
  note: string
}

export function marksheetRows(
  a: Pick<Assessment, 'questions'>,
  marks: readonly LearnerMark[],
  names: ReadonlyMap<string, string>,
): MarksheetRow[] {
  const topics = topicsOf(a.questions)
  return marks.map((m) => ({
    learnerId: m.learnerId,
    name: names.get(m.learnerId) ?? '',
    version: m.version ?? '',
    score: m.score,
    outOf: m.outOf,
    percent: Math.round(m.fraction * 100),
    questions: m.perQuestion.map((q) => q.earned),
    outcomes: m.perQuestion.map((q) => q.outcome),
    topics: topics.map((t) => {
      const s = m.topics.find((x) => x.topic.toLowerCase() === t.toLowerCase())
      return s && s.possible > 0 ? Math.round((100 * s.earned) / s.possible) : null
    }),
    note: m.missingPages.length ? `Page ${m.missingPages.join(', ')} not scanned` : '',
  }))
}

export function marksheetHeader(a: Pick<Assessment, 'questions'>): string[] {
  return [
    'Learner ID',
    'Name',
    'Version',
    'Total',
    'Out of',
    'Percentage',
    ...a.questions.map((_, i) => `Q${i + 1}`),
    ...topicsOf(a.questions).map((t) => `${t} %`),
    'Note',
  ]
}

/** One row of cells per learner, with numbers as numbers (for the XLSX file). */
export function marksheetTable(
  a: Pick<Assessment, 'questions'>,
  rows: readonly MarksheetRow[],
): (string | number | null)[][] {
  return [
    marksheetHeader(a),
    ...rows.map((r) => [
      r.learnerId,
      r.name,
      r.version,
      r.score,
      r.outOf,
      r.percent,
      ...r.questions,
      ...r.topics,
      r.note,
    ]),
  ]
}

export function marksheetCsv(a: Pick<Assessment, 'questions'>, rows: readonly MarksheetRow[]): string {
  return writeCsv(
    marksheetTable(a, rows).map((row) =>
      row.map((v) => (v === null ? '' : typeof v === 'number' ? formatNumber(v) : v)),
    ),
  )
}

export function itemAnalysisTable(
  a: Pick<Assessment, 'questions'>,
  stats: readonly ItemStats[],
): (string | number | null)[][] {
  return [
    [
      'Question',
      'Topic',
      'Memo',
      'Correct %',
      'A',
      'B',
      'C',
      'D',
      'E',
      'Blank',
      'Multiple',
      'Most chosen wrong',
      'Misconception',
      'Discrimination',
      'Flags',
    ],
    ...stats.map((s) => {
      const q = a.questions[s.question]
      return [
        s.question + 1,
        q.topic,
        q.answer === null ? '' : letter(q.answer),
        s.pCorrect === null ? null : Math.round(s.pCorrect * 100),
        ...[0, 1, 2, 3, 4].map((k) => (k < q.options.length ? s.counts[k] : null)),
        s.blank,
        s.multiple,
        s.topWrong ? letter(s.topWrong.option) : '',
        s.topWrong?.misconception ?? '',
        s.discrimination === null ? null : Math.round(s.discrimination * 100) / 100,
        s.flags.map(flagText).join('; '),
      ]
    }),
  ]
}

export function flagText(flag: ItemStats['flags'][number]): string {
  switch (flag) {
    case 'too-easy':
      return 'Too easy'
    case 'too-hard':
      return 'Too hard'
    case 'negative-discrimination':
      return 'Top third did worse'
  }
}
