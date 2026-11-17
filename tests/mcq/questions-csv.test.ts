import { describe, expect, it } from 'vitest'
import { newQuestion, type Question } from '../../src/mcq/core/model'
import { QUESTION_CSV_HEADER, questionsFromCsv, questionsToCsv } from '../../src/mcq/core/questions-csv'

function q(change: Partial<Question>, options = 4): Question {
  return { ...newQuestion(options), ...change }
}

const strip = (qs: Question[]) => qs.map(({ id: _id, ...rest }) => rest)

describe('questions CSV', () => {
  it('writes the documented columns', () => {
    const csv = questionsToCsv([q({ answer: 1 })])
    expect(csv.split('\r\n')[0]).toBe(
      'number,question,A,B,C,D,E,answer,marks,topic,misconception_A,misconception_B,misconception_C,misconception_D,misconception_E,options',
    )
    expect(QUESTION_CSV_HEADER).toHaveLength(16)
  })

  it('round-trips text with commas, quotes, line breaks and accents, and every option count', () => {
    const questions = [
      q({
        text: 'Which is bigger, ¾ or "0,7"?\nShow your thinking.',
        options: ['¾', '0,7', 'They are equal', 'Cannot tell'],
        answer: 0,
        marks: 2,
        topic: 'Fractions',
        misconceptions: ['', 'Reads the decimal comma as a separator', 'Rounds', ''],
      }),
      q({ answer: 1, topic: 'True or false' }, 2),
      q({ answer: null, marks: 1.5 }, 3),
      q({ options: ['a', 'b', 'c', 'd', 'e'], answer: 4, misconceptions: ['x', '', '', '', ''] }, 5),
      q({ text: '  leading and trailing spaces  ' }, 4),
    ]
    const result = questionsFromCsv(questionsToCsv(questions))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(strip(result.questions)).toEqual(
      strip(questions).map((x, i) => (i === 4 ? { ...x, text: x.text.trim() } : x)),
    )
  })

  it('reads a hand-made file: columns in any order, semicolons, no options column', () => {
    const text =
      'Topic;Answer;Question;A;B;C;Misconception A\nAlgebra;c;Solve x + 2 = 5;1;2;3;Subtracts wrongly\n;;;;;;\n'
    const result = questionsFromCsv(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toMatchObject({
      text: 'Solve x + 2 = 5',
      options: ['1', '2', '3'],
      answer: 2,
      topic: 'Algebra',
      marks: 1,
      misconceptions: ['Subtracts wrongly', '', ''],
    })
  })

  it('gives a question with no option letters used 4 options', () => {
    const result = questionsFromCsv('number,topic\n1,Fractions\n')
    expect(result.ok && result.questions[0].options).toHaveLength(4)
  })

  it('lists problems with row numbers and refuses the file', () => {
    const result = questionsFromCsv('number,answer,marks,options,E\n1,F,1,4,\n2,B,-1,4,\n3,A,1,7,\n4,A,1,3,text\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toEqual([
      'Row 2: the answer "F" must be a letter from A to E.',
      'Row 3: "-1" marks: use a number from 0.5 to 100.',
      'Row 4: "7" options: a question has 2 to 5 options.',
      'Row 5: option E has text, but the question has 3 options.',
    ])
  })

  it('refuses a file without a header row', () => {
    const result = questionsFromCsv('1,2,3\n')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems[0]).toMatch(/first row must name the columns/)
  })
})
