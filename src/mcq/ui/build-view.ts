// Build: title, questions, options, marks, Memo, Topics, texts and misconceptions; Versions;
// questions CSV; and the question bank.
import {
  DEFAULT_OPTIONS,
  formatNumber,
  letter,
  MAX_MARKS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_VERSIONS,
  MIN_OPTIONS,
  missingMemo,
  randomSeed,
  topicsOf,
  totalMarks,
  withOptionCount,
  withQuestion,
  withQuestionCount,
  type Assessment,
  type Question,
} from '../core/model'
import { questionsFileName, questionsFromCsv, questionsToCsv, QUESTION_CSV_HEADER } from '../core/questions-csv'
import { withVersionSettings } from '../core/versions'
import { clear, confirmInPage, download, h, MIME, plural, showMessage } from './dom'
import { memoEntry } from './memo-entry'
import { questionBank } from './question-bank'
import { update, workspace, type ChangeInfo } from './state'

const ORIGIN = 'build'

function change(fn: (a: Assessment) => Assessment, info: Omit<ChangeInfo, 'origin'> = {}): void {
  update(fn, { ...info, origin: ORIGIN })
}

function field(label: string, control: HTMLElement, cls = ''): HTMLLabelElement {
  return h('label', { class: `field ${cls}` }, h('span', { text: label }), control)
}

function numberInput(value: number, min: number, max: number, step: number, label?: string): HTMLInputElement {
  return h('input', {
    type: 'number',
    min,
    max,
    step,
    value: formatNumber(value),
    inputmode: step < 1 ? 'decimal' : 'numeric',
    ...(label ? { 'aria-label': label } : {}),
  })
}

function optionSelect(value: number, label?: string): HTMLSelectElement {
  const select = h('select', label ? { 'aria-label': label } : {})
  for (let n = MIN_OPTIONS; n <= MAX_OPTIONS; n++) {
    select.append(h('option', { value: n, text: `${n} (A to ${letter(n - 1)})`, selected: n === value }))
  }
  return select
}

/** A warning shown when an edit would change the printed answer sheets. */
function structureWarning(a: Assessment): HTMLElement | null {
  if (a.scans.length === 0) return null
  return h('p', {
    class: 'warning',
    text: 'This assessment already has results. Changing the number of questions, options or Versions changes the answer sheets, so sheets printed before will no longer be read correctly. Editing text, marks, Topics or the Memo is safe.',
  })
}

function detailsPanel(root: HTMLElement): HTMLElement {
  const { assessment: a } = workspace()
  const title = h('input', { type: 'text', value: a.title, id: 'build-title', autocomplete: 'off' })
  title.addEventListener('input', () => {
    change((x) => ({ ...x, title: title.value }), { textOnly: true })
    document.getElementById('work-title')!.textContent = title.value || 'Untitled assessment'
  })
  title.addEventListener('change', () => {
    if (!title.value.trim()) {
      title.value = 'Untitled assessment'
      change((x) => ({ ...x, title: title.value }), { textOnly: true })
    }
  })

  const count = numberInput(a.questions.length, 1, MAX_QUESTIONS, 1)
  count.id = 'question-count'
  count.addEventListener('change', () => {
    const n = Number(count.value)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QUESTIONS) {
      count.value = String(workspace().assessment.questions.length)
      return
    }
    change((x) => withQuestionCount(x, n))
    renderBuild(root)
  })

  const bulkOptions = optionSelect(a.questions[0]?.options.length ?? DEFAULT_OPTIONS, 'Options for every question')
  const applyOptions = h('button', {
    type: 'button',
    class: 'small',
    text: 'Apply to all',
    onclick: () => {
      change((x) => ({ ...x, questions: x.questions.map((q) => withOptionCount(q, Number(bulkOptions.value))) }))
      renderBuild(root)
    },
  })
  const bulkMarks = numberInput(1, 0.5, MAX_MARKS, 0.5, 'Marks for every question')
  const applyMarks = h('button', {
    type: 'button',
    class: 'small',
    text: 'Apply to all',
    onclick: () => {
      const m = Number(bulkMarks.value)
      if (!(m > 0 && m <= MAX_MARKS)) return
      change((x) => ({ ...x, questions: x.questions.map((q) => ({ ...q, marks: m })) }))
      renderBuild(root)
    },
  })

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'details-title' },
    h('h2', { id: 'details-title', text: 'Assessment' }),
    h('div', { class: 'row-fields' }, field('Title', title, 'grow'), field('Number of questions', count, 'narrow')),
    h(
      'div',
      { class: 'row-fields bulk' },
      h(
        'div',
        { class: 'field' },
        h('span', { text: 'Options per question' }),
        h('div', { class: 'inline' }, bulkOptions, applyOptions),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { text: 'Marks per question' }),
        h('div', { class: 'inline' }, bulkMarks, applyMarks),
      ),
    ),
    h('p', { class: 'help', id: 'total-marks' }),
  )
}

function renderTotals(): void {
  const { assessment: a } = workspace()
  const missing = missingMemo(a.questions)
  const total = document.getElementById('total-marks')
  if (total) {
    total.textContent = `${plural(a.questions.length, 'question')}, ${formatNumber(totalMarks(a.questions))} marks with a Memo answer. ${
      missing.length
        ? `Memo still to set: ${missing.length === a.questions.length ? 'all' : missing.length > 12 ? plural(missing.length, 'question') : `question ${missing.join(', ')}`}.`
        : 'Memo complete.'
    }`
  }
}

function memoPanel(root: HTMLElement): HTMLElement {
  const { assessment: a } = workspace()
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'memo-title' },
    h('h2', { id: 'memo-title', text: 'Memo' }),
    h('p', {
      class: 'help',
      text: 'Click the first box and type the answers: each letter sets the answer and moves to the next question. Backspace clears; the arrow keys move.',
    }),
    memoEntry({
      questions: a.questions,
      onSet: (i, answer) => {
        change((x) => withQuestion(x, i, { answer }))
        renderTotals()
        refreshQuestionRow(root, i)
      },
    }),
  )
}

function topicList(): HTMLDataListElement {
  const list = h('datalist', { id: 'topic-options' })
  for (const t of topicsOf(workspace().assessment.questions)) list.append(h('option', { value: t }))
  return list
}

function questionRow(root: HTMLElement, i: number, open = false): HTMLLIElement {
  const q = workspace().assessment.questions[i]
  const n = i + 1
  const set = (c: Partial<Question>, textOnly = true) => {
    change((x) => withQuestion(x, i, c), { textOnly })
    toggle.textContent = hasText(workspace().assessment.questions[i]) ? 'Edit text' : 'Add text'
  }

  const options = optionSelect(q.options.length, `Question ${n} options`)
  options.addEventListener('change', () => {
    change((x) => ({
      ...x,
      questions: x.questions.map((qq, k) => (k === i ? withOptionCount(qq, Number(options.value)) : qq)),
    }))
    renderBuild(root)
  })
  const marks = numberInput(q.marks, 0.5, MAX_MARKS, 0.5, `Question ${n} marks`)
  marks.addEventListener('change', () => {
    const m = Number(marks.value)
    if (m > 0 && m <= MAX_MARKS) {
      set({ marks: m }, false)
      renderTotals()
    } else marks.value = formatNumber(workspace().assessment.questions[i].marks)
  })
  const topic = h('input', {
    type: 'text',
    value: q.topic,
    list: 'topic-options',
    'aria-label': `Question ${n} Topic`,
    placeholder: 'Topic',
  })
  topic.addEventListener('input', () => set({ topic: topic.value }, false))
  topic.addEventListener('change', () => {
    document.getElementById('topic-options')?.replaceWith(topicList())
  })

  const detail = h('div', { class: 'q-detail', id: `q-detail-${i}`, hidden: !open })
  const toggle = h('button', {
    type: 'button',
    class: 'small toggle',
    'aria-expanded': String(open),
    'aria-controls': detail.id,
    text: hasText(q) ? 'Edit text' : 'Add text',
  })
  toggle.addEventListener('click', () => {
    const show = detail.hidden
    detail.hidden = !show
    toggle.setAttribute('aria-expanded', String(show))
    if (show) detail.querySelector('textarea')?.focus()
  })

  const text = h('textarea', {
    rows: 2,
    'aria-label': `Question ${n} text`,
    placeholder: 'Question text (optional, for the question booklet)',
  })
  text.value = q.text
  text.addEventListener('input', () => set({ text: text.value }))
  detail.append(field('Question text', text))
  const optionsList = h('ol', { class: 'option-list' })
  q.options.forEach((value, k) => {
    const correct = q.answer === k
    const optionText = h('input', {
      type: 'text',
      value,
      'aria-label': `Question ${n} option ${letter(k)}`,
      placeholder: `Option ${letter(k)}`,
    })
    optionText.addEventListener('input', () => {
      const current = workspace().assessment.questions[i]
      set({ options: current.options.map((o, j) => (j === k ? optionText.value : o)) })
    })
    const misconception = correct
      ? h('span', { class: 'correct-note', text: 'Correct answer' })
      : h('input', {
          type: 'text',
          value: q.misconceptions[k],
          'aria-label': `Question ${n} option ${letter(k)} misconception`,
          placeholder: 'Misconception if chosen (optional)',
        })
    if (misconception instanceof HTMLInputElement) {
      misconception.addEventListener('input', () => {
        const current = workspace().assessment.questions[i]
        set({ misconceptions: current.misconceptions.map((o, j) => (j === k ? misconception.value : o)) })
      })
    }
    optionsList.append(
      h(
        'li',
        { class: `option-row${correct ? ' is-correct' : ''}` },
        h('span', { class: 'option-letter', text: letter(k) }),
        optionText,
        misconception,
      ),
    )
  })
  detail.append(optionsList)

  return h(
    'li',
    { class: 'q-row', 'data-index': i },
    h(
      'div',
      { class: 'q-line' },
      h('span', { class: 'q-no', text: String(n) }),
      h('span', {
        class: `q-answer${q.answer === null ? ' unset' : ''}`,
        title: 'Memo',
        text: q.answer === null ? '?' : letter(q.answer),
      }),
      h('label', { class: 'mini' }, h('span', { text: 'Options' }), options),
      h('label', { class: 'mini marks' }, h('span', { text: 'Marks' }), marks),
      h('label', { class: 'mini grow' }, h('span', { text: 'Topic' }), topic),
      toggle,
    ),
    detail,
  )
}

function hasText(q: Question): boolean {
  return q.text.trim() !== '' || q.options.some((o) => o.trim() !== '')
}

function refreshQuestionRow(root: HTMLElement, i: number): void {
  const row = root.querySelector<HTMLLIElement>(`.q-row[data-index="${i}"]`)
  if (!row) return
  const open = !row.querySelector<HTMLElement>('.q-detail')!.hidden
  row.replaceWith(questionRow(root, i, open))
}

function questionsPanel(root: HTMLElement): HTMLElement {
  const { assessment: a } = workspace()
  const status = h('p', { class: 'status', role: 'status', hidden: true })
  const csvInput = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, id: 'questions-csv-input' })
  csvInput.addEventListener('change', async () => {
    const file = csvInput.files?.[0]
    csvInput.value = ''
    if (!file) return
    const result = questionsFromCsv(await file.text())
    status.classList.toggle('error', !result.ok)
    if (!result.ok) {
      showMessage(status, result.problems.join('\n'))
      return
    }
    const current = workspace().assessment
    if (current.questions.some((q) => hasText(q) || q.answer !== null || q.topic)) {
      const ok = await confirmInPage(
        status.parentElement!,
        `Replace the ${plural(current.questions.length, 'question')} here with the ${plural(result.questions.length, 'question')} in the file?`,
        'Replace',
      )
      if (!ok) return
    }
    change((x) => ({ ...x, questions: result.questions }))
    renderBuild(root)
    const after = root.querySelector<HTMLElement>('#questions-status')!
    after.classList.remove('error')
    showMessage(after, `Imported ${plural(result.questions.length, 'question')} from ${file.name}.`)
  })
  status.id = 'questions-status'

  const bankHost = h('div', { class: 'bank-host' })
  const bankButton = h('button', {
    type: 'button',
    text: 'Question bank',
    'aria-expanded': 'false',
    'aria-controls': 'question-bank',
  })
  bankButton.addEventListener('click', async () => {
    const open = bankButton.getAttribute('aria-expanded') === 'true'
    bankButton.setAttribute('aria-expanded', String(!open))
    if (open) {
      clear(bankHost)
      return
    }
    clear(
      bankHost,
      await questionBank({
        excludeId: workspace().assessment.id,
        onInsert: (questions) => {
          change((x) => ({ ...x, questions: [...x.questions, ...questions].slice(0, MAX_QUESTIONS) }))
          renderBuild(root)
          const after = root.querySelector<HTMLElement>('#questions-status')!
          showMessage(after, `Added ${plural(questions.length, 'question')} from the question bank at the end.`)
        },
      }),
    )
  })

  const list = h('ol', { class: 'q-list' })
  a.questions.forEach((_, i) => list.append(questionRow(root, i)))

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'questions-title' },
    h('h2', { id: 'questions-title', text: 'Questions' }),
    h(
      'div',
      { class: 'toolbar' },
      bankButton,
      h('button', {
        type: 'button',
        text: 'Export questions (CSV)',
        onclick: () => {
          const x = workspace().assessment
          download(questionsToCsv(x.questions), questionsFileName(x.title), MIME.csv)
        },
      }),
      h('label', { class: 'button', for: 'questions-csv-input', text: 'Import questions (CSV)' }),
      csvInput,
    ),
    h(
      'details',
      { class: 'help-details' },
      h('summary', { text: 'CSV columns' }),
      h('p', {
        class: 'help',
        text: `A header row with these columns, in any order: ${QUESTION_CSV_HEADER.join(', ')}.`,
      }),
      h('p', {
        class: 'help',
        text: 'answer is the Memo letter (A to E). options is how many options the question has (2 to 5); without it, the last option letter used counts. Text, Topic and misconception columns are optional. Importing replaces the questions here.',
      }),
    ),
    status,
    bankHost,
    topicList(),
    h('p', {
      class: 'help',
      text: 'Set the Memo above. Question text and option text are optional: they are only needed for a printed question booklet. A misconception note on a wrong option appears in the item analysis when many learners choose it.',
    }),
    list,
  )
}

function versionsPanel(root: HTMLElement): HTMLElement {
  const { assessment: a } = workspace()
  const v = a.versions
  const radios = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Number of Versions' })
  for (let n = 1; n <= MAX_VERSIONS; n++) {
    const input = h('input', { type: 'radio', name: 'version-count', value: n, checked: v.count === n })
    input.addEventListener('change', () => {
      change((x) => withVersionSettings(x, { count: n }))
      renderBuild(root)
    })
    radios.append(h('label', {}, input, h('span', { text: n === 1 ? '1 (no shuffle)' : String(n) })))
  }
  const check = (label: string, key: 'shuffleQuestions' | 'shuffleOptions') => {
    const input = h('input', { type: 'checkbox', checked: v[key], disabled: v.count === 1 })
    input.addEventListener('change', () => {
      change((x) => withVersionSettings(x, { [key]: input.checked }))
      renderBuild(root)
    })
    return h('label', { class: 'check' }, input, ` ${label}`)
  }
  const preview =
    v.count > 1
      ? v.plans.slice(1).map((p) =>
          h('li', {
            text: `Version ${p.version} starts with question ${p.questionOrder
              .slice(0, 6)
              .map((q) => q + 1)
              .join(', ')}${p.questionOrder.length > 6 ? '...' : ''}`,
          }),
        )
      : []
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'versions-title' },
    h('h2', { id: 'versions-title', text: 'Versions' }),
    h('p', {
      class: 'help',
      text: 'Versions print the questions and options in a different order, so learners next to each other have different sheets. Version A keeps the original order. Marking maps every Version back to it.',
    }),
    radios,
    h(
      'div',
      { class: 'checks' },
      check('Shuffle the question order', 'shuffleQuestions'),
      check('Shuffle the option order (A, B, C...)', 'shuffleOptions'),
    ),
    v.count > 1 ? h('ul', { class: 'help version-preview' }, preview) : null,
    v.count > 1
      ? h(
          'p',
          { class: 'help' },
          'The shuffle is saved with the assessment, so a reprint matches. ',
          h('button', {
            type: 'button',
            class: 'small',
            text: 'Shuffle again',
            onclick: () => {
              change((x) => withVersionSettings(x, { seed: randomSeed() }))
              renderBuild(root)
            },
          }),
          ' Only before printing.',
        )
      : null,
  )
}

export function renderBuild(root: HTMLElement): void {
  const { assessment: a } = workspace()
  const focusedId = (document.activeElement as HTMLElement | null)?.id
  clear(root, structureWarning(a), detailsPanel(root), memoPanel(root), questionsPanel(root), versionsPanel(root))
  renderTotals()
  if (focusedId) document.getElementById(focusedId)?.focus()
}

export const buildStep = {
  show: renderBuild,
  refresh(root: HTMLElement, info: ChangeInfo) {
    if (!info.textOnly) renderBuild(root)
  },
}
