// "Who is writing?" in Print: a saved Class list, or learners kept with the Assessment (pasted
// names, numbers only, or a CSV or Excel file with its columns picked), or, for Bubbled ID, no list.
// Drafts (typed names, a chosen spreadsheet) live here until the teacher uses them, so the Print
// screen can re-draw without losing them.
import {
  columnLetter,
  guessColumns,
  importSpreadsheet,
  newClassList,
  saveClass,
  SPREADSHEET_ACCEPT,
  tidyName,
  type ClassList,
  type ImportedSpreadsheet,
} from '../../shared/classes'
import {
  activeLearnerList,
  listFromCount,
  listFromNames,
  listFromRows,
  MAX_LEARNERS,
  type ImportChoices,
  type LearnerListDraft,
} from '../core/learners'
import type { LearnerList, LearnerSource, PrintSettings } from '../core/model'
import { errorMessage, h, plural, showMessage } from './dom'
import { setClassList, update, workspace } from './state'

const SOURCES: { source: LearnerSource; title: string; text: string; bubbledOnly?: boolean }[] = [
  {
    source: 'none',
    title: 'No list',
    text: 'Learners fill in their Learner ID. Results show IDs only.',
    bubbledOnly: true,
  },
  { source: 'class', title: 'A saved Class list', text: 'From Class lists on this device.' },
  { source: 'pasted', title: 'Paste names', text: 'One name per line. Learner IDs 1, 2, 3...' },
  { source: 'numbers', title: 'Numbers only', text: 'Learner IDs 1 to N, no names.' },
  { source: 'imported', title: 'Import a file', text: 'A CSV or Excel class list: pick the columns.' },
]

/** The preview shows at most this many rows. */
const PREVIEW_ROWS = 200

let pasteDraft: string | null = null
let imported: { file: string; sheets: ImportedSpreadsheet; sheet: number; choices: ImportChoices } | null = null
let importError = ''
let savedMessage = ''

/** Forgets the drafts, for example when another Assessment opens. */
export function resetLearnerDrafts(): void {
  pasteDraft = null
  imported = null
  importError = ''
  savedMessage = ''
}

function setPrint(change: Partial<PrintSettings>): void {
  update((a) => ({ ...a, print: { ...a.print, ...change } }))
}

/** Uses a Learner list as the learners (and its digits for a Bubbled ID grid). */
function useList(list: LearnerList): void {
  savedMessage = ''
  update((a) => ({
    ...a,
    learnerList: list,
    print: {
      ...a.print,
      learnerSource: list.source,
      ...(a.print.mode === 'bubbled-id' ? { idDigits: list.idDigits } : {}),
    },
  }))
}

function chooseSource(source: LearnerSource): void {
  savedMessage = ''
  const a = workspace().assessment
  const change: Partial<PrintSettings> = { learnerSource: source }
  if (a.print.mode === 'bubbled-id') {
    const digits =
      source === 'class'
        ? workspace().savedClass?.idDigits
        : a.learnerList?.source === source
          ? a.learnerList.idDigits
          : undefined
    if (digits) change.idDigits = digits
  }
  setPrint(change)
}

/** "Learner IDs 1 to 32 (2 digits)". */
function idRange(list: Pick<LearnerList, 'idDigits' | 'learners'>): string {
  const n = list.learners.length
  if (n === 0) return 'no learners'
  const first = list.learners[0].id
  const last = list.learners[n - 1].id
  return `Learner ID${n === 1 ? ` ${first}` : `s ${first} to ${last}`} (${plural(list.idDigits, 'digit')})`
}

function previewTable(draft: LearnerListDraft, caption: string): HTMLElement {
  const shown = draft.rows.slice(0, PREVIEW_ROWS)
  return h(
    'div',
    { class: 'table-wrap learner-preview' },
    h(
      'table',
      { class: 'data-table learner-table' },
      h('caption', { class: 'visually-hidden', text: caption }),
      h(
        'thead',
        {},
        h('tr', {}, h('th', { scope: 'col', text: 'Learner ID' }), h('th', { scope: 'col', text: 'Name' })),
      ),
      h(
        'tbody',
        {},
        shown.map((r) =>
          h(
            'tr',
            { class: r.problems.length ? 'problem' : '' },
            h('td', { class: 'id', text: r.id }),
            h(
              'td',
              {},
              r.name || h('span', { class: 'muted', text: 'No name' }),
              r.problems.length
                ? h('span', { class: 'problem-text', text: ` Row ${r.sourceRow}: ${r.problems.join(' ')}` })
                : null,
            ),
          ),
        ),
      ),
    ),
    draft.rows.length > shown.length
      ? h('p', { class: 'help', text: `And ${draft.rows.length - shown.length} more.` })
      : null,
  )
}

function draftSummary(draft: LearnerListDraft): string {
  const bad = draft.rows.filter((r) => r.problems.length).length
  if (!draft.list) return draft.problems[0] ?? 'No learners yet.'
  if (bad) {
    return `${plural(draft.list.learners.length, 'learner')}. ${bad} row${bad === 1 ? ' has a problem' : 's have problems'}: fix ${bad === 1 ? 'it' : 'them'} in the file or change the choices.`
  }
  return `${plural(draft.list.learners.length, 'learner')}, ${idRange(draft.list)}.`
}

/** What is in use now, with "Save as a Class list". */
function currentList(list: LearnerList, status: HTMLElement): HTMLElement {
  const name = h('input', {
    type: 'text',
    id: 'save-class-name',
    'aria-label': 'Name for the new Class list',
    placeholder: 'Class name, for example Grade 7B',
    value: list.fileName ? list.fileName.replace(/\.[^.]+$/, '') : '',
  })
  const save = h('button', { type: 'button', class: 'small', id: 'save-as-class', text: 'Save as a Class list' })
  save.addEventListener('click', async () => {
    const title = tidyName(name.value)
    if (!title) {
      status.classList.add('error')
      showMessage(status, 'Give the Class list a name.')
      name.focus()
      return
    }
    save.disabled = true
    try {
      const saved = await saveClass(newClassList(title, list.idDigits, list.learners))
      savedMessage = `Saved as the Class list "${saved.name}". Next time, choose it under A saved Class list.`
      status.classList.remove('error')
      showMessage(status, savedMessage)
    } catch (error) {
      status.classList.add('error')
      showMessage(status, errorMessage(error))
    } finally {
      save.disabled = false
    }
  })
  const named = list.learners.filter((l) => l.name).length
  return h(
    'div',
    { class: 'current-list' },
    h('p', {
      class: 'summary',
      id: 'learner-summary',
      text: `In use: ${plural(list.learners.length, 'learner')}${named ? '' : ' (no names)'}, ${idRange(list)}. Saved with this assessment.`,
    }),
    h(
      'details',
      { class: 'help-details' },
      h('summary', { text: 'Show the learners' }),
      previewTable(
        {
          list,
          rows: list.learners.map((l, i) => ({ sourceRow: i + 1, id: l.id, name: l.name ?? '', problems: [] })),
          problems: [],
        },
        'Learners in use',
      ),
    ),
    h('div', { class: 'inline save-class' }, name, save),
    h('p', {
      class: 'help',
      text: 'Keep this list for other assessments by saving it as a Class list. The names are kept in this assessment, and are in its Assessment file when you download it.',
    }),
  )
}

function classBody(classes: ClassList[]): HTMLElement {
  const { assessment: a, classList } = workspace()
  const p = a.print
  const qr = p.mode !== 'bubbled-id'
  const select = h(
    'select',
    { id: 'class-select' },
    h('option', { value: '', text: qr ? 'Choose a Class list' : 'None (Learner IDs only)' }),
  )
  for (const c of classes)
    select.append(
      h('option', {
        value: c.id,
        text: `${c.name} (${plural(c.learners.length, 'learner')})`,
        selected: c.id === p.classId,
      }),
    )
  select.addEventListener('change', () => {
    const chosen = classes.find((c) => c.id === select.value) ?? null
    setClassList(chosen)
    if (chosen && p.mode === 'bubbled-id') setPrint({ idDigits: chosen.idDigits })
  })
  return h(
    'div',
    { class: 'source-body' },
    h('label', { class: 'field grow' }, h('span', { text: 'Class list' }), select),
    classes.length === 0
      ? h(
          'p',
          { class: 'help' },
          'No Class lists on this device yet. ',
          h('a', { href: `${import.meta.env.BASE_URL}classes/#new`, text: 'Make one in Class lists' }),
          ', or paste the names here instead.',
        )
      : null,
    p.classId && !classList
      ? h('p', {
          class: 'warning',
          text: 'The Class list this assessment used is not on this device. Choose another, or import it in Class lists.',
        })
      : null,
  )
}

function pasteBody(status: HTMLElement): HTMLElement {
  const a = workspace().assessment
  const list = activeLearnerList(a)
  if (pasteDraft === null)
    pasteDraft = list?.source === 'pasted' ? list.learners.map((l) => l.name ?? '').join('\n') : ''
  const text = h('textarea', {
    id: 'paste-names',
    rows: 8,
    'aria-label': 'Names, one per line',
    placeholder: 'Thandi Mokoena\nSipho Dlamini\n...',
  })
  text.value = pasteDraft
  const summary = h('p', { class: 'help', id: 'paste-summary', role: 'status' })
  const use = h('button', { type: 'button', class: 'primary small', id: 'use-names', text: 'Use these names' })
  const refresh = () => {
    pasteDraft = text.value
    const draft = listFromNames(text.value)
    summary.textContent = draft.list ? draftSummary(draft) : (draft.problems[0] ?? '')
    // Nothing to use when these are the names already in use.
    const same =
      list?.source === 'pasted' && JSON.stringify(list.learners) === JSON.stringify(draft.list?.learners ?? null)
    use.disabled = !draft.list || draft.list.learners.length === 0
    use.hidden = same
    use.textContent = list?.source === 'pasted' ? 'Use these names instead' : 'Use these names'
  }
  text.addEventListener('input', refresh)
  use.addEventListener('click', () => {
    const draft = listFromNames(text.value)
    if (draft.list) useList(draft.list)
  })
  refresh()
  return h(
    'div',
    { class: 'source-body' },
    h(
      'label',
      { class: 'field' },
      h('span', { text: 'Names, one per line (you can paste a column from a spreadsheet)' }),
      text,
    ),
    summary,
    h('div', { class: 'actions' }, use),
    list?.source === 'pasted' ? currentList(list, status) : null,
  )
}

function numbersBody(status: HTMLElement): HTMLElement {
  const a = workspace().assessment
  const list = activeLearnerList(a)
  const count = h('input', {
    type: 'number',
    id: 'learner-count',
    min: 1,
    max: MAX_LEARNERS,
    step: 1,
    inputmode: 'numeric',
    value: list?.source === 'numbers' ? list.learners.length : '',
  })
  const problem = h('p', { class: 'error', role: 'alert', hidden: true })
  count.addEventListener('change', () => {
    const draft = listFromCount(Number(count.value))
    if (!draft.list) showMessage(problem, draft.problems[0] ?? '')
    else useList(draft.list)
  })
  return h(
    'div',
    { class: 'source-body' },
    h('label', { class: 'field narrow' }, h('span', { text: 'How many learners?' }), count),
    problem,
    list?.source === 'numbers' ? currentList(list, status) : null,
  )
}

const ORDINALS = ['1st', '2nd', '3rd']

function importBody(status: HTMLElement, redraw: () => void): HTMLElement {
  const a = workspace().assessment
  const list = activeLearnerList(a)
  const input = h('input', { type: 'file', id: 'learners-file', accept: SPREADSHEET_ACCEPT, hidden: true })
  const errorLine = h('p', { class: 'error', role: 'alert', hidden: !importError, text: importError })
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const sheets = await importSpreadsheet(file)
      const sheet = Math.max(
        0,
        sheets.sheets.findIndex((s) => s.rows.length > 0),
      )
      const guess = guessColumns(sheets.sheets[sheet].rows)
      imported = { file: file.name, sheets, sheet, choices: guess }
      importError = ''
    } catch (error) {
      imported = null
      importError = errorMessage(error)
    }
    redraw()
  })
  const body = h(
    'div',
    { class: 'source-body' },
    h(
      'div',
      { class: 'inline' },
      h('label', {
        class: 'button small',
        for: 'learners-file',
        text: imported ? 'Choose another file' : 'Choose a CSV or Excel file',
      }),
      input,
      h('span', { class: 'help', text: imported ? imported.file : 'No file chosen' }),
    ),
    errorLine,
  )
  if (imported) {
    const im = imported
    const rows = im.sheets.sheets[im.sheet].rows
    const choices = im.choices
    const draft = listFromRows(rows, choices, im.file)
    const sheetSelect = h('select', { id: 'learners-sheet' })
    im.sheets.sheets.forEach((s, i) =>
      sheetSelect.append(
        h('option', { value: i, text: `${s.name} (${plural(s.rows.length, 'row')})`, selected: i === im.sheet }),
      ),
    )
    sheetSelect.addEventListener('change', () => {
      im.sheet = Number(sheetSelect.value)
      im.choices = guessColumns(im.sheets.sheets[im.sheet].rows)
      redraw()
    })
    const header = h('input', { type: 'checkbox', id: 'learners-header', checked: choices.headerRow })
    header.addEventListener('change', () => {
      im.choices = { ...im.choices, headerRow: header.checked }
      redraw()
    })
    const width = rows[0]?.length ?? 0
    const title = (c: number) => {
      const t = choices.headerRow ? (rows[0]?.[c] ?? '').trim() : ''
      return t ? `${columnLetter(c)}: ${t}` : `Column ${columnLetter(c)}`
    }
    const sample = (c: number) =>
      rows
        .slice(choices.headerRow ? 1 : 0)
        .map((r) => (r[c] ?? '').trim())
        .find((v) => v !== '') ?? ''
    const columns = h('ul', { class: 'column-list' })
    const noId = h('input', {
      type: 'radio',
      name: 'learners-id-column',
      value: '',
      checked: choices.idColumn === undefined,
    })
    noId.addEventListener('change', () => {
      im.choices = { ...im.choices, idColumn: undefined }
      redraw()
    })
    for (let c = 0; c < width; c++) {
      const position = choices.nameColumns.indexOf(c)
      const name = h('input', {
        type: 'checkbox',
        checked: position >= 0,
        'aria-label': `${title(c)} is part of the name`,
      })
      name.addEventListener('change', () => {
        const order = im.choices.nameColumns.filter((n) => n !== c)
        im.choices = {
          ...im.choices,
          nameColumns: name.checked ? [...order, c] : order,
          idColumn: name.checked && im.choices.idColumn === c ? undefined : im.choices.idColumn,
        }
        redraw()
      })
      const id = h('input', {
        type: 'radio',
        name: 'learners-id-column',
        value: c,
        checked: choices.idColumn === c,
        'aria-label': `${title(c)} holds the Learner ID`,
      })
      id.addEventListener('change', () => {
        im.choices = { ...im.choices, idColumn: c, nameColumns: im.choices.nameColumns.filter((n) => n !== c) }
        redraw()
      })
      columns.append(
        h(
          'li',
          { class: `column${position >= 0 || choices.idColumn === c ? ' chosen' : ''}` },
          h(
            'span',
            { class: 'column-label' },
            h('span', { class: 'column-title', text: title(c) }),
            h('span', { class: 'column-sample', text: sample(c) ? `e.g. ${sample(c)}` : 'empty' }),
          ),
          h(
            'span',
            { class: 'column-choices' },
            h(
              'label',
              { class: 'check' },
              name,
              ' Name',
              position >= 0 && choices.nameColumns.length > 1
                ? h('span', { class: 'order', text: ` (${ORDINALS[position] ?? `${position + 1}th`})` })
                : null,
            ),
            h('label', { class: 'check' }, id, ' Learner ID'),
          ),
        ),
      )
    }
    const use = h('button', {
      type: 'button',
      class: 'primary small',
      id: 'use-imported',
      text: draft.list ? `Use these ${plural(draft.list.learners.length, 'learner')}` : 'Use these learners',
      disabled: !draft.list || draft.list.learners.length === 0 || draft.problems.length > 0,
    })
    use.addEventListener('click', () => {
      if (draft.list) {
        useList(draft.list)
        imported = null
      }
    })
    if (im.sheets.sheets.length > 1)
      body.append(h('label', { class: 'field' }, h('span', { text: 'Sheet' }), sheetSelect))
    body.append(
      h('label', { class: 'check' }, header, ' The first row holds column titles'),
      h(
        'fieldset',
        { class: 'columns' },
        h('legend', { text: 'Columns' }),
        h('p', {
          class: 'help',
          text: 'Tick the columns that make up the name, in order (for example first name, then surname). Choose a Learner ID column to keep the IDs in the file; without one, learners are numbered 1, 2, 3...',
        }),
        columns,
        h('label', { class: 'check' }, noId, ' No ID column: number the learners'),
      ),
      h('p', {
        class: `summary${draft.problems.length ? ' has-problems' : ''}`,
        id: 'import-summary',
        text: draftSummary(draft),
      }),
      draft.rows.length ? previewTable(draft, 'Preview of the imported learners') : '',
      h('div', { class: 'actions' }, use),
    )
  }
  if (list?.source === 'imported') body.append(currentList(list, status))
  return body
}

/** The "Who is writing?" panel, with the spare sheets (QR) or the ID digits and sheet count (Bubbled ID). */
export function learnersPanel(classes: ClassList[], controls: HTMLElement[], redraw: () => void): HTMLElement {
  const { assessment: a } = workspace()
  const p = a.print
  const bubbled = p.mode === 'bubbled-id'
  const status = h('p', { class: 'status', role: 'status', hidden: !savedMessage, text: savedMessage })
  const group = h('div', {
    class: 'mode-choices source-choices',
    role: 'radiogroup',
    'aria-labelledby': 'learners-title',
  })
  for (const s of SOURCES) {
    if (s.bubbledOnly && !bubbled) continue
    const input = h('input', {
      type: 'radio',
      name: 'learner-source',
      value: s.source,
      checked: p.learnerSource === s.source,
    })
    input.addEventListener('change', () => chooseSource(s.source))
    group.append(
      h(
        'label',
        { class: 'mode-choice' },
        input,
        h('span', { class: 'mode-text' }, h('strong', { text: s.title }), h('span', { text: s.text })),
      ),
    )
  }
  let body: HTMLElement | null = null
  switch (p.learnerSource) {
    case 'class':
      body = classBody(classes)
      break
    case 'pasted':
      body = pasteBody(status)
      break
    case 'numbers':
      body = numbersBody(status)
      break
    case 'imported':
      body = importBody(status, redraw)
      break
    case 'none':
      body = h('p', {
        class: 'help source-body',
        text: 'No names are needed: each learner fills in their Learner ID on the sheet. Choose a list as well if you want names in the results.',
      })
  }
  const panel = h(
    'section',
    { class: 'panel', id: 'learners-panel', 'aria-labelledby': 'learners-title' },
    h('h2', { id: 'learners-title', text: 'Who is writing?' }),
    h('p', {
      class: 'help',
      text: bubbled
        ? 'Optional for Bubbled ID: a list adds names to the results and checks the IDs learners fill in.'
        : 'The learners to print a sheet for. You do not need a saved Class list: paste the names, give a number, or import a file.',
    }),
    a.scans.length
      ? h('p', {
          class: 'warning',
          text: 'This assessment already has results. Keep the learners the sheets were printed for: changing them changes whose sheet is whose.',
        })
      : null,
    group,
    body,
    status,
    h('div', { class: 'row-fields' }, controls),
  )
  return panel
}
