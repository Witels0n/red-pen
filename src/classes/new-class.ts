import {
  SPREADSHEET_ACCEPT,
  buildLearners,
  importSpreadsheet,
  maxLearnerNumber,
  newClassList,
  numberedLearners,
  rowsFromNames,
  saveClass,
  tidyName,
  type BuiltRow,
  type ImportedSpreadsheet,
  type Learner,
} from '../shared/classes'
import { el, errorMessage, go, h, learnerCount, showMessage } from './dom'
import { columnLetter, guessColumns } from './guess-columns'

type Method = 'names' | 'numbers' | 'import'

const form = el<HTMLFormElement>('new-form')
const nameInput = el<HTMLInputElement>('new-name')
const digitsSelect = el<HTMLSelectElement>('new-digits')
const namesText = el<HTMLTextAreaElement>('names-text')
const countInput = el<HTMLInputElement>('learner-count')
const sheetInput = el<HTMLInputElement>('sheet-input')
const sheetFileName = el('sheet-file-name')
const importError = el('import-error')
const importOptions = el('import-options')
const sheetField = el('sheet-field')
const sheetSelect = el<HTMLSelectElement>('sheet-select')
const headerRow = el<HTMLInputElement>('header-row')
const columnList = el<HTMLUListElement>('column-list')
const previewSummary = el('preview-summary')
const previewBody = el<HTMLTableElement>('preview-table').tBodies[0]
const previewMore = el('preview-more')
const newError = el('new-error')
const saveButton = el<HTMLButtonElement>('save-new')

sheetInput.accept = SPREADSHEET_ACCEPT

/** The preview shows at most this many rows; problems are always counted in full. */
const PREVIEW_ROWS = 500

let imported: ImportedSpreadsheet | null = null
let fileBaseName = ''
let nameOrder: number[] = []
let idColumn: number | undefined
let nameTouched = false

function method(): Method {
  return (form.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value ?? 'names') as Method
}

function digits(): number {
  return Number(digitsSelect.value)
}

/** Resets the form each time the screen opens. */
export function showNew(): void {
  form.reset()
  imported = null
  fileBaseName = ''
  nameOrder = []
  idColumn = undefined
  nameTouched = false
  sheetFileName.textContent = 'No file chosen'
  importOptions.hidden = true
  showMessage(importError, '')
  showMessage(newError, '')
  showMethod()
  update()
  nameInput.focus()
}

function showMethod(): void {
  const m = method()
  for (const panel of form.querySelectorAll<HTMLElement>('.method')) panel.hidden = panel.dataset.method !== m
}

interface Outcome {
  rows: BuiltRow[]
  learners: Learner[]
  problems: string[]
}

function outcome(): Outcome {
  const d = digits()
  const m = method()
  if (m === 'names') {
    return buildLearners(rowsFromNames(namesText.value), { headerRow: false, nameColumns: [0], idDigits: d })
  }
  if (m === 'numbers') {
    const count = Number(countInput.value)
    if (!Number.isInteger(count) || count < 1) return { rows: [], learners: [], problems: ['Enter how many learners, 1 or more.'] }
    if (count > maxLearnerNumber(d)) {
      return { rows: [], learners: [], problems: [`${count} learners need more than ${d}-digit IDs (the most is ${maxLearnerNumber(d)}).`] }
    }
    const learners = numberedLearners(count, d)
    return { rows: learners.map((l, i) => ({ sourceRow: i + 1, id: l.id, name: '', problems: [] })), learners, problems: [] }
  }
  const sheet = imported?.sheets[Number(sheetSelect.value) || 0]
  if (!sheet) return { rows: [], learners: [], problems: [] }
  if (nameOrder.length === 0 && idColumn === undefined) {
    return { rows: [], learners: [], problems: ['Tick at least one name column, or choose an ID column.'] }
  }
  return buildLearners(sheet.rows, { headerRow: headerRow.checked, nameColumns: nameOrder, idColumn, idDigits: d })
}

function update(): void {
  const result = outcome()
  const shown = result.rows.slice(0, PREVIEW_ROWS)
  previewBody.replaceChildren(
    ...shown.map((r) => {
      const nameCell = h('td', {}, r.name || h('span', { class: 'muted', text: 'No name' }))
      if (r.problems.length > 0) nameCell.append(h('span', { class: 'problem-text', text: ` ${r.problems.join(' ')}` }))
      const showRow = method() === 'import' ? `Row ${r.sourceRow}: ` : ''
      return h(
        'tr',
        { class: r.problems.length > 0 ? 'problem' : undefined, title: r.problems.length > 0 ? `${showRow}${r.problems.join(' ')}` : undefined },
        h('td', { class: 'id', text: r.id }),
        nameCell,
      )
    }),
  )
  const more = result.rows.length - shown.length
  showMessage(previewMore, more > 0 ? `And ${more} more.` : '')

  const problemRows = result.rows.filter((r) => r.problems.length > 0).length
  if (result.rows.length === 0) {
    previewSummary.textContent = result.problems[0] ?? 'No learners yet.'
  } else if (problemRows > 0) {
    previewSummary.textContent = `${learnerCount(result.learners.length)}. ${problemRows} row${problemRows === 1 ? ' has a problem' : 's have problems'}: fix ${problemRows === 1 ? 'it' : 'them'} in the file or change the choices above.`
  } else {
    previewSummary.textContent = learnerCount(result.learners.length)
  }
  previewSummary.classList.toggle('has-problems', problemRows > 0)
  saveButton.disabled = result.learners.length === 0 || result.problems.length > 0
}

// ---------- Spreadsheet import ----------

function currentRows(): string[][] {
  return imported?.sheets[Number(sheetSelect.value) || 0]?.rows ?? []
}

function columnTitle(c: number): string {
  const rows = currentRows()
  const title = headerRow.checked ? (rows[0]?.[c] ?? '').trim() : ''
  return title ? `${columnLetter(c)}: ${title}` : `Column ${columnLetter(c)}`
}

function columnSample(c: number): string {
  const rows = currentRows().slice(headerRow.checked ? 1 : 0)
  return rows.map((r) => (r[c] ?? '').trim()).find((v) => v !== '') ?? ''
}

const ORDINALS = ['1st', '2nd', '3rd']

/** Builds the column choices for the current sheet. */
function buildColumns(): void {
  const width = currentRows()[0]?.length ?? 0
  columnList.replaceChildren(
    ...Array.from({ length: width }, (_, c) => {
      const sample = columnSample(c)
      return h(
        'li',
        { class: 'column', 'data-column': c },
        h(
          'div',
          { class: 'column-label' },
          h('span', { class: 'column-title', text: columnTitle(c) }),
          sample ? h('span', { class: 'column-sample', text: `e.g. ${sample}` }) : h('span', { class: 'column-sample', text: 'empty' }),
        ),
        h(
          'div',
          { class: 'column-choices' },
          h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', class: 'name-part', value: c, 'aria-label': `${columnTitle(c)} is part of the name` }),
            ' Name',
            h('span', { class: 'order' }),
          ),
          h(
            'label',
            { class: 'check' },
            h('input', { type: 'radio', name: 'id-column', value: c, 'aria-label': `${columnTitle(c)} holds the Learner ID` }),
            ' Learner ID',
          ),
        ),
      )
    }),
  )
  syncColumns()
}

/** Shows the current choices on the column controls, without rebuilding them (so focus stays put). */
function syncColumns(): void {
  for (const li of columnList.querySelectorAll<HTMLLIElement>('.column')) {
    const c = Number(li.dataset.column)
    const position = nameOrder.indexOf(c)
    li.querySelector<HTMLInputElement>('.name-part')!.checked = position >= 0
    li.querySelector('.order')!.textContent = position >= 0 && nameOrder.length > 1 ? ` (${ORDINALS[position] ?? `${position + 1}th`})` : ''
    li.querySelector<HTMLInputElement>('input[name="id-column"]')!.checked = idColumn === c
    li.classList.toggle('chosen', position >= 0 || idColumn === c)
  }
  const none = form.querySelector<HTMLInputElement>('input[name="id-column"][value=""]')!
  none.checked = idColumn === undefined
}

function applyGuess(): void {
  const guess = guessColumns(currentRows())
  headerRow.checked = guess.headerRow
  nameOrder = guess.nameColumns
  idColumn = guess.idColumn
  // A file that already has IDs needs as many digits as its longest ID.
  if (idColumn !== undefined) {
    const longest = Math.max(1, ...currentRows().slice(guess.headerRow ? 1 : 0).map((r) => (r[idColumn!] ?? '').trim().length))
    if (longest > digits() && longest <= 4) digitsSelect.value = String(longest)
  }
  buildColumns()
}

function suggestName(): void {
  if (nameTouched || !imported) return
  const sheets = imported.sheets
  const sheet = sheets[Number(sheetSelect.value) || 0]
  nameInput.value = sheets.length > 1 && sheet ? sheet.name : fileBaseName
}

sheetInput.addEventListener('change', async () => {
  const file = sheetInput.files?.[0]
  sheetInput.value = ''
  if (!file) return
  showMessage(importError, '')
  sheetFileName.textContent = file.name
  try {
    imported = await importSpreadsheet(file)
  } catch (error) {
    imported = null
    importOptions.hidden = true
    showMessage(importError, errorMessage(error))
    update()
    return
  }
  fileBaseName = file.name.replace(/\.[^.]+$/, '')
  const firstWithRows = Math.max(0, imported.sheets.findIndex((s) => s.rows.length > 0))
  sheetSelect.replaceChildren(
    ...imported.sheets.map((s, i) => h('option', { value: i, text: `${s.name} (${s.rows.length} rows)`, selected: i === firstWithRows })),
  )
  sheetField.hidden = imported.sheets.length < 2
  importOptions.hidden = false
  applyGuess()
  suggestName()
  update()
})

sheetSelect.addEventListener('change', () => {
  applyGuess()
  suggestName()
  update()
})

headerRow.addEventListener('change', () => {
  buildColumns()
  update()
})

columnList.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const c = Number(input.value)
  if (input.classList.contains('name-part')) {
    nameOrder = input.checked ? [...nameOrder.filter((n) => n !== c), c] : nameOrder.filter((n) => n !== c)
    if (input.checked && idColumn === c) idColumn = undefined
  } else if (input.name === 'id-column' && input.checked) {
    idColumn = c
    nameOrder = nameOrder.filter((n) => n !== c)
  }
  syncColumns()
  update()
})

form.querySelector('input[name="id-column"][value=""]')!.addEventListener('change', () => {
  idColumn = undefined
  syncColumns()
  update()
})

// ---------- The rest of the form ----------

nameInput.addEventListener('input', () => {
  nameTouched = true
})

for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="method"]')) {
  radio.addEventListener('change', () => {
    showMethod()
    showMessage(newError, '')
    update()
  })
}

for (const input of [digitsSelect, namesText, countInput]) input.addEventListener('input', update)
digitsSelect.addEventListener('change', update)

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = tidyName(nameInput.value)
  if (!name) {
    showMessage(newError, 'Give the class a name.')
    nameInput.focus()
    return
  }
  const result = outcome()
  if (result.learners.length === 0 || result.problems.length > 0) {
    showMessage(newError, result.problems[0] ?? 'Add at least one learner.')
    return
  }
  saveButton.disabled = true
  try {
    const saved = await saveClass(newClassList(name, digits(), result.learners))
    go(`#class/${encodeURIComponent(saved.id)}`)
  } catch (error) {
    showMessage(newError, errorMessage(error))
    saveButton.disabled = false
  }
})
