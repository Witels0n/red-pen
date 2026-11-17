// The question bank: questions from the other Assessments on this device, filtered by Topic or
// text, to insert into the open one.
import { copyQuestion, letter, topicsOf, type Question } from '../core/model'
import { listAssessments } from '../storage'
import { clear, errorMessage, h, plural } from './dom'

interface BankEntry {
  question: Question
  source: string
  number: number
}

const SHOWN = 60

function describe(q: Question, number: number): string {
  return q.text.trim() || `Question ${number} (no text)`
}

export async function questionBank(opts: {
  excludeId: string
  onInsert(questions: Question[]): void
}): Promise<HTMLElement> {
  const panel = h('div', { class: 'bank', id: 'question-bank', role: 'region', 'aria-label': 'Question bank' })
  let entries: BankEntry[]
  try {
    entries = (await listAssessments())
      .filter((a) => a.id !== opts.excludeId)
      .flatMap((a) => a.questions.map((question, i) => ({ question, source: a.title, number: i + 1 })))
  } catch (error) {
    panel.append(h('p', { class: 'error', text: errorMessage(error) }))
    return panel
  }
  if (entries.length === 0) {
    panel.append(
      h('p', {
        class: 'empty',
        text: 'The question bank is empty: questions from your other assessments on this device appear here.',
      }),
    )
    return panel
  }

  const topic = h('select', { 'aria-label': 'Topic' }, h('option', { value: '', text: 'All Topics' }))
  for (const t of topicsOf(entries.map((e) => e.question)))
    topic.append(h('option', { value: t.toLowerCase(), text: t }))
  const search = h('input', {
    type: 'search',
    placeholder: 'Search question text',
    'aria-label': 'Search question text',
  })
  const list = h('ul', { class: 'bank-list' })
  const summary = h('p', { class: 'help', role: 'status' })
  const chosen = new Set<BankEntry>()
  const insert = h('button', { type: 'button', class: 'primary', text: 'Add selected', disabled: true })

  const refreshButton = () => {
    insert.disabled = chosen.size === 0
    insert.textContent = chosen.size ? `Add ${plural(chosen.size, 'question')}` : 'Add selected'
  }

  const render = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = entries.filter((e) => {
      if (topic.value && e.question.topic.trim().toLowerCase() !== topic.value) return false
      const hay = `${e.question.text} ${e.question.options.join(' ')} ${e.question.topic} ${e.source}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    clear(
      list,
      matches.slice(0, SHOWN).map((e) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(e) })
        box.addEventListener('change', () => {
          if (box.checked) chosen.add(e)
          else chosen.delete(e)
          refreshButton()
        })
        const q = e.question
        return h(
          'li',
          {},
          h(
            'label',
            { class: 'bank-item' },
            box,
            h(
              'span',
              { class: 'bank-text' },
              h('span', { class: 'bank-question', text: describe(q, e.number) }),
              h('span', {
                class: 'meta',
                text: [
                  e.source,
                  q.topic || 'No Topic',
                  `${q.options.length} options`,
                  q.answer === null ? 'no Memo' : `Memo ${letter(q.answer)}`,
                ].join(' · '),
              }),
            ),
          ),
        )
      }),
    )
    summary.textContent =
      matches.length > SHOWN
        ? `Showing ${SHOWN} of ${matches.length} matching questions. Narrow the search to see the rest.`
        : `${plural(matches.length, 'matching question')}.`
  }
  topic.addEventListener('change', render)
  search.addEventListener('input', render)
  insert.addEventListener('click', () => {
    opts.onInsert([...chosen].map((e) => copyQuestion(e.question)))
  })
  render()
  panel.append(
    h(
      'div',
      { class: 'row-fields' },
      h('label', { class: 'field' }, h('span', { text: 'Topic' }), topic),
      h('label', { class: 'field grow' }, h('span', { text: 'Search' }), search),
    ),
    summary,
    list,
    h('div', { class: 'actions' }, insert),
  )
  return panel
}
