// Build: title, questions, options, marks, Memo, Topics, texts, pictures and misconceptions; the
// question paper (one shared paper, shuffled once, or Versions); questions CSV; and the question bank.
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
  optionImage,
  questionHasContent,
  randomSeed,
  topicsOf,
  totalMarks,
  withOptionCount,
  withOptionImage,
  withQuestion,
  withQuestionCount,
  withQuestionImage,
  type Assessment,
  type Question,
  type QuestionImage,
} from '../core/model'
import {
  anyImages,
  keepImages,
  questionsFileName,
  questionsFromCsv,
  questionsToCsv,
  QUESTION_CSV_HEADER,
} from '../core/questions-csv'
import { balancedSeed, printedMemo, sharedShuffleActive, withVersionSettings } from '../core/versions'
import { choiceInPage, clear, confirmInPage, download, errorMessage, h, MIME, plural, showMessage } from './dom'
import { pictureFile, pictureFromFile } from './image-input'
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
        root.querySelector('#paper-panel')?.replaceWith(paperPanel(root))
      },
    }),
  )
}

function topicList(): HTMLDataListElement {
  const list = h('datalist', { id: 'topic-options' })
  for (const t of topicsOf(workspace().assessment.questions)) list.append(h('option', { value: t }))
  return list
}

/** Where each question's options print on the shared paper, when its options are shuffled (else null). */
function sharedOrder(a: Assessment): number[][] | null {
  if (a.versions.count !== 1 || !sharedShuffleActive(a.questions, a.versions)) return null
  return a.versions.plans[0].optionOrder
}

/** "Printed as C": where the correct answer lands on the shared paper. Empty when nothing is shuffled. */
function printedAsText(a: Assessment, i: number): string {
  const order = sharedOrder(a)
  const answer = a.questions[i].answer
  if (!order || answer === null) return ''
  return `Printed as ${letter(order[i].indexOf(answer))}`
}

/** Updates the "Printed as" letters in place (after typing, which may turn the shuffle on or off). */
function refreshPrintedLetters(root: HTMLElement): void {
  const a = workspace().assessment
  const order = sharedOrder(a)
  for (const badge of root.querySelectorAll<HTMLElement>('.q-printed')) {
    const i = Number(badge.dataset.index)
    badge.textContent = printedAsText(a, i)
    badge.hidden = badge.textContent === ''
  }
  for (const tag of root.querySelectorAll<HTMLElement>('.option-printed')) {
    const i = Number(tag.dataset.index)
    const k = Number(tag.dataset.option)
    tag.textContent = order ? `prints as ${letter(order[i].indexOf(k))}` : ''
    tag.hidden = !order
  }
}

let shuffleWasActive: boolean | null = null

/** After an edit that may add or remove the last question text or picture: keep the paper panel and letters in step. */
function afterContentEdit(root: HTMLElement): void {
  const a = workspace().assessment
  const active = sharedShuffleActive(a.questions, a.versions)
  if (active !== shuffleWasActive) {
    shuffleWasActive = active
    root.querySelector('#paper-panel')?.replaceWith(paperPanel(root))
  }
  refreshPrintedLetters(root)
  const note = root.querySelector<HTMLElement>('#csv-pictures-note')
  if (note) note.hidden = !anyImages(a.questions)
}

/**
 * A picture slot for a question or an option: a thumbnail with Replace and Remove, or Add picture.
 * A picture can also be dropped on the slot or pasted into it (or into the text box beside it).
 */
function pictureSlot(
  label: string,
  image: QuestionImage | null,
  status: HTMLElement,
  set: (image: QuestionImage | null) => void,
  pasteTargets: HTMLElement[] = [],
): HTMLElement {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/*', hidden: true })
  const slot = h('div', {
    class: `picture-slot${image ? ' has-picture' : ''}`,
    tabindex: 0,
    role: 'group',
    'aria-label': `${label}. Drop or paste a picture here.`,
    title: 'Drop or paste a picture here',
  })
  const use = async (file: File | null) => {
    if (!file) return
    slot.classList.add('busy')
    showMessage(status, '')
    try {
      set(await pictureFromFile(file))
    } catch (error) {
      status.classList.add('error')
      showMessage(status, errorMessage(error))
    } finally {
      slot.classList.remove('busy')
    }
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0] ?? null
    input.value = ''
    void use(file)
  })
  const choose = () => input.click()
  if (image) {
    slot.append(
      h('img', { class: 'thumb', src: image.src, alt: label, width: image.width, height: image.height }),
      h(
        'span',
        { class: 'picture-actions' },
        h('button', {
          type: 'button',
          class: 'small',
          text: 'Replace',
          'aria-label': `Replace ${label}`,
          onclick: choose,
        }),
        h('button', {
          type: 'button',
          class: 'small',
          text: 'Remove',
          'aria-label': `Remove ${label}`,
          onclick: () => set(null),
        }),
      ),
    )
  } else {
    slot.append(
      h('button', {
        type: 'button',
        class: 'small add-picture',
        text: 'Add picture',
        'aria-label': `Add ${label}`,
        onclick: choose,
      }),
    )
  }
  slot.append(input)
  slot.addEventListener('dragover', (e) => {
    e.preventDefault()
    slot.classList.add('drag')
  })
  slot.addEventListener('dragleave', () => slot.classList.remove('drag'))
  slot.addEventListener('drop', (e) => {
    e.preventDefault()
    slot.classList.remove('drag')
    void use(pictureFile(e.dataTransfer))
  })
  for (const target of [slot, ...pasteTargets]) {
    target.addEventListener('paste', (e) => {
      const file = pictureFile(e.clipboardData)
      if (!file || !file.type.startsWith('image/')) return
      e.preventDefault()
      void use(file)
    })
  }
  return slot
}

function questionRow(root: HTMLElement, i: number, open = false): HTMLLIElement {
  const q = workspace().assessment.questions[i]
  const n = i + 1
  const set = (c: Partial<Question>, textOnly = true) => {
    change((x) => withQuestion(x, i, c), { textOnly })
    toggle.textContent = toggleText(workspace().assessment.questions[i])
    afterContentEdit(root)
  }
  const setPicture = (fn: (q: Question) => Question) => {
    change((x) => ({ ...x, questions: x.questions.map((qq, k) => (k === i ? fn(qq) : qq)) }))
    refreshQuestionRow(root, i)
    afterContentEdit(root)
  }
  const pictureStatus = h('p', { class: 'status picture-status', role: 'alert', hidden: true })

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
    placeholder: 'For example Fractions',
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
    text: toggleText(q),
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
  detail.append(
    h(
      'div',
      { class: 'stem-row' },
      field('Question text', text, 'grow'),
      h(
        'div',
        { class: 'field picture-field' },
        h('span', { text: 'Picture' }),
        pictureSlot(
          `Question ${n} picture`,
          q.image ?? null,
          pictureStatus,
          (image) => setPicture((qq) => withQuestionImage(qq, image)),
          [text],
        ),
      ),
    ),
  )
  const order = sharedOrder(workspace().assessment)
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
        h(
          'span',
          { class: 'option-key' },
          h('span', { class: 'option-letter', text: letter(k) }),
          h('span', {
            class: 'option-printed',
            'data-index': i,
            'data-option': k,
            text: order ? `prints as ${letter(order[i].indexOf(k))}` : '',
            hidden: !order,
          }),
        ),
        optionText,
        misconception,
        pictureSlot(
          `Question ${n} option ${letter(k)} picture`,
          optionImage(q, k),
          pictureStatus,
          (image) => setPicture((qq) => withOptionImage(qq, k, image)),
          [optionText],
        ),
      ),
    )
  })
  detail.append(optionsList, pictureStatus)
  const printedAs = printedAsText(workspace().assessment, i)

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
      h('span', {
        class: 'q-printed',
        'data-index': i,
        title: 'On the shared paper, the correct answer is printed with this letter',
        text: printedAs,
        hidden: !printedAs,
      }),
      h('label', { class: 'mini' }, h('span', { text: 'Options' }), options),
      h('label', { class: 'mini marks' }, h('span', { text: 'Marks' }), marks),
      h('label', { class: 'mini grow' }, h('span', { text: 'Topic (optional)' }), topic),
      toggle,
    ),
    detail,
  )
}

function toggleText(q: Question): string {
  return questionHasContent(q) ? 'Edit text and pictures' : 'Add text or pictures'
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
    let questions = result.questions
    const replace = `Replace the ${plural(current.questions.length, 'question')} here with the ${plural(result.questions.length, 'question')} in the file?`
    if (anyImages(current.questions)) {
      // A CSV has no pictures: the teacher chooses whether the pictures stay with their question numbers.
      const choice = await choiceInPage(
        status.parentElement!,
        `${replace} The CSV has no pictures. Keep the pictures here for the questions whose number is still in the file?`,
        [
          { value: 'keep', label: 'Replace, keep pictures' },
          { value: 'drop', label: 'Replace, remove pictures' },
        ],
      )
      if (!choice) return
      if (choice === 'keep') questions = keepImages(current.questions, questions)
    } else if (current.questions.some((q) => questionHasContent(q) || q.answer !== null || q.topic)) {
      const ok = await confirmInPage(status.parentElement!, replace, 'Replace')
      if (!ok) return
    }
    change((x) => ({ ...x, questions }))
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
      h('p', {
        class: 'help',
        text: 'Pictures are not included in the CSV: they are kept in this assessment and in its Assessment file.',
      }),
    ),
    h('p', {
      class: 'help',
      id: 'csv-pictures-note',
      text: 'Exporting questions as CSV leaves out the pictures. They stay in this assessment and in the Assessment file.',
      hidden: !anyImages(a.questions),
    }),
    status,
    bankHost,
    topicList(),
    h('p', {
      class: 'help',
      text: 'Set the Memo above, in your own order. Question text, option text and pictures are optional: they are only needed for a printed question booklet. A Topic is optional too. A misconception note on a wrong option appears in the item analysis when many learners choose it.',
    }),
    list,
  )
}

/** How often each letter is the correct answer on a plan: "A 3, B 2, C 3, D 2". */
function letterSpread(a: Assessment): string {
  const memo = printedMemo(a, a.versions.plans[0])
  const counts = new Map<string, number>()
  for (const m of memo) if (m !== null) counts.set(letter(m), (counts.get(letter(m)) ?? 0) + 1)
  return [...counts.keys()]
    .sort()
    .map((l) => `${l} ${counts.get(l)}`)
    .join(', ')
}

async function reshuffle(root: HTMLElement, host: HTMLElement): Promise<void> {
  const a = workspace().assessment
  if (a.scans.length > 0) {
    const ok = await confirmInPage(
      host,
      'This assessment already has results. Shuffling again changes the printed paper and the Memo letters, so sheets already written would be marked against the wrong letters. Shuffle anyway?',
      'Shuffle again',
    )
    if (!ok) return
  }
  // A fresh seed, picked so the correct answers spread evenly across the letters.
  change((x) => withVersionSettings(x, { seed: balancedSeed(x.questions, randomSeed()) }))
  renderBuild(root)
}

function paperPanel(root: HTMLElement): HTMLElement {
  const { assessment: a } = workspace()
  const v = a.versions
  const content = sharedShuffleActive(a.questions, { shuffleShared: true })
  const active = sharedShuffleActive(a.questions, v)
  shuffleWasActive = active
  const panel = h('section', { class: 'panel', id: 'paper-panel', 'aria-labelledby': 'paper-title' })

  const shared = h('input', {
    type: 'checkbox',
    id: 'shuffle-shared',
    checked: v.shuffleShared && content,
    disabled: !content,
  })
  shared.addEventListener('change', () => {
    change((x) =>
      withVersionSettings(x, {
        shuffleShared: shared.checked,
        ...(shared.checked && x.scans.length === 0 ? { seed: balancedSeed(x.questions, x.versions.seed) } : {}),
      }),
    )
    renderBuild(root)
  })
  const sharedLabel =
    v.count > 1 ? "Shuffle Version A's options once too" : 'Shuffle the options once (same for everyone)'
  const again = h('button', {
    type: 'button',
    class: 'small',
    id: 'shuffle-again',
    text: 'Shuffle again',
    onclick: () => void reshuffle(root, panel),
  })
  let sharedHelp: HTMLElement
  if (!content) {
    sharedHelp = h('p', {
      class: 'help',
      id: 'shuffle-help',
      text: 'There is no question text or picture yet, so you will use your own question paper. The options are printed and marked in the order you entered them, so shuffling is off. Add question text or pictures to shuffle.',
    })
  } else if (active) {
    sharedHelp = h(
      'div',
      { class: 'stack-tight' },
      h('p', {
        class: 'help',
        id: 'shuffle-help',
        text: `Every learner gets the same paper, with each question's options in a shuffled order so the correct answers are spread across the letters. Type the Memo in your own order: the "Printed as" letter shows where each correct answer lands, and marking maps the printed letters back. Correct answers on the paper: ${letterSpread(a) || 'set the Memo to see them'}.`,
      }),
      h('p', { class: 'help' }, again, ' Shuffling again changes the printed paper, so only shuffle before you print.'),
    )
  } else {
    sharedHelp = h('p', {
      class: 'help',
      id: 'shuffle-help',
      text: 'The options are printed in the order you entered them.',
    })
  }

  const radios = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Number of Versions' })
  for (let n = 1; n <= MAX_VERSIONS; n++) {
    const input = h('input', { type: 'radio', name: 'version-count', value: n, checked: v.count === n })
    input.addEventListener('change', () => {
      change((x) => withVersionSettings(x, { count: n }))
      renderBuild(root)
    })
    radios.append(h('label', {}, input, h('span', { text: n === 1 ? '1 (one shared paper)' : String(n) })))
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
  const advanced = h(
    'details',
    { class: 'advanced', open: v.count > 1, id: 'versions-details' },
    h('summary', { text: v.count > 1 ? `Versions (${v.count})` : 'Versions (advanced)' }),
    h('p', {
      class: 'help',
      text: 'Versions print the questions and options in a different order per Version (2 to 4), so learners next to each other have different papers. Each Version needs its own question booklet. Version A keeps the question order. Marking maps every Version back to your order.',
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
            onclick: () => void reshuffle(root, panel),
          }),
          ' Only before printing.',
        )
      : null,
  )
  panel.append(
    h('h2', { id: 'paper-title', text: 'Question paper' }),
    h('p', {
      class: 'help',
      text:
        v.count > 1
          ? `${v.count} Versions: each learner gets one of them.`
          : 'One question paper that every learner shares.',
    }),
    h('label', { class: `check${content ? '' : ' disabled'}` }, shared, ` ${sharedLabel}`),
    sharedHelp,
    advanced,
  )
  return panel
}

export function renderBuild(root: HTMLElement): void {
  const { assessment: a } = workspace()
  const focusedId = (document.activeElement as HTMLElement | null)?.id
  clear(root, structureWarning(a), detailsPanel(root), memoPanel(root), questionsPanel(root), paperPanel(root))
  renderTotals()
  if (focusedId) document.getElementById(focusedId)?.focus()
}

export const buildStep = {
  show: renderBuild,
  refresh(root: HTMLElement, info: ChangeInfo) {
    if (!info.textOnly) renderBuild(root)
  },
}
