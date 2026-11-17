import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { itemAnalysis } from '../../src/mcq/core/analysis'
import { assessmentFromFile, assessmentToFile } from '../../src/mcq/core/assessment-file'
import { collate, markAll } from '../../src/mcq/core/marking'
import {
  itemAnalysisTable,
  marksheetCsv,
  marksheetHeader,
  marksheetRows,
  marksheetTable,
} from '../../src/mcq/core/marksheet'
import type { Assessment } from '../../src/mcq/core/model'
import { questionsFromCsv, questionsToCsv } from '../../src/mcq/core/questions-csv'
import { memoTable, renderMemoPdf } from '../../src/mcq/pdf/booklet'
import { renderFeedbackPdf, slipContent } from '../../src/mcq/pdf/feedback'
import { assessment, memoAnswers, pagesFor } from './fixtures'

/** The fixture without any Topics. */
function noTopics(n = 6): Assessment {
  const a = assessment(n)
  return { ...a, questions: a.questions.map((q) => ({ ...q, topic: '' })) }
}

function marked(a: Assessment) {
  const answers = memoAnswers(a)
  answers[0] = ((answers[0] as number) + 1) % 4
  const scans = [...pagesFor(a, '01', 'A', answers), ...pagesFor(a, '02', 'A', memoAnswers(a))]
  return markAll(a, collate({ ...a, scans }).learners)
}

describe('an Assessment with no Topics', () => {
  it('has no Topic columns in the marksheet, its CSV or XLSX rows', () => {
    const a = noTopics()
    const marks = marked(a)
    const rows = marksheetRows(a, marks, new Map())
    expect(marksheetHeader(a)).toEqual([
      'Learner ID',
      'Name',
      'Version',
      'Total',
      'Out of',
      'Percentage',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Note',
    ])
    expect(rows.every((r) => r.topics.length === 0)).toBe(true)
    expect(marksheetTable(a, rows).every((r) => r.length === 13)).toBe(true)
    expect(marksheetCsv(a, rows).split('\r\n')[0]).not.toContain('%')
  })

  it('has no Topic column in the item analysis export', () => {
    const a = noTopics()
    const table = itemAnalysisTable(a, itemAnalysis(a, marked(a)))
    expect(table[0]).not.toContain('Topic')
    expect(table[0].slice(0, 3)).toEqual(['Question', 'Memo', 'Correct %'])
    expect(table.every((r) => r.length === table[0].length)).toBe(true)
    // With Topics, the column is there.
    const tagged = assessment(6)
    expect(itemAnalysisTable(tagged, itemAnalysis(tagged, marked(tagged)))[0][1]).toBe('Topic')
  })

  it('leaves the Topic table and "Topics to revise" off the feedback slips', async () => {
    const a = noTopics()
    const [first] = marked(a)
    expect(slipContent(a, first)).toEqual({ topics: null, revise: null, look: [1] })
    const pdf = await renderFeedbackPdf(a, [{ mark: first }])
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })

  it('shows Topics on slips when some questions have one, counting only the tagged questions', () => {
    const base = noTopics()
    const a = { ...base, questions: base.questions.map((q, i) => (i < 2 ? { ...q, topic: 'Fractions' } : q)) }
    const [first] = marked(a)
    const content = slipContent(a, first)
    expect(content.topics).toEqual([{ topic: 'Fractions', earned: 1, possible: 2 }])
    expect(content.revise).toBe('Well done: you scored 50% or more in every Topic.')
  })

  it('has no Topic column in the Memo PDF', async () => {
    const a = noTopics()
    expect(memoTable(a, a.versions.plans[0]).map((c) => c.title)).toEqual(['Q', 'Answer', 'Marks'])
    expect((await PDFDocument.load(await renderMemoPdf(a))).getPageCount()).toBe(1)
    expect(memoTable(assessment(4), assessment(4).versions.plans[0]).map((c) => c.title)).toContain('Topic')
  })

  it('imports from a questions CSV without a topic column, and exports an empty one', () => {
    const result = questionsFromCsv('number,question,A,B,C,D,answer\n1,One,a,b,c,d,B\n2,Two,a,b,c,d,\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions.map((q) => q.topic)).toEqual(['', ''])
    const back = questionsFromCsv(questionsToCsv(result.questions))
    expect(back.ok && back.questions.map((q) => q.topic)).toEqual(['', ''])
  })

  it('is accepted in an Assessment file with empty or absent Topics', () => {
    const a = noTopics(3)
    expect(assessmentFromFile(assessmentToFile(a))).toEqual({ ok: true, assessment: a })
    const file = JSON.parse(assessmentToFile(a))
    delete file.assessment.questions[1].topic
    const back = assessmentFromFile(JSON.stringify(file))
    expect(back.ok && back.assessment.questions[1].topic).toBe('')
  })
})
