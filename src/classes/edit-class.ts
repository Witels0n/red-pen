import {
  addLearner,
  changeIdDigits,
  getClass,
  moveLearner,
  nextLearnerId,
  removeLearner,
  renameLearner,
  saveClass,
  sortByName,
  tidyName,
  type ClassList,
  type Learner,
} from '../shared/classes'
import { el, errorMessage, exportClassCsv, go, h, learnerCount, showMessage } from './dom'

const title = el('edit-title')
const summary = el('edit-summary')
const status = el('edit-status')
const nameInput = el<HTMLInputElement>('edit-name')
const digitsSelect = el<HTMLSelectElement>('edit-digits')
const digitsWarning = el('digits-warning')
const listEl = el<HTMLOListElement>('learner-list')
const noLearners = el('no-learners')
const addForm = el<HTMLFormElement>('add-form')
const addName = el<HTMLInputElement>('add-name')
const addButton = el<HTMLButtonElement>('add-learner')

let current: ClassList | null = null
/** The list before the last removal, for Undo. */
let beforeRemoval: ClassList | null = null

export async function showEdit(id: string): Promise<void> {
  showMessage(status, '')
  showMessage(digitsWarning, '')
  beforeRemoval = null
  let list: ClassList | undefined
  try {
    list = await getClass(id)
  } catch (error) {
    go('')
    showMessage(el('home-error'), errorMessage(error))
    return
  }
  if (!list) {
    go('')
    return
  }
  current = list
  nameInput.value = list.name
  render()
}

// Saves run one after another so a quick burst of edits is stored in order.
let saving = Promise.resolve()

function save(list: ClassList, message = 'Saved.'): Promise<void> {
  current = list
  saving = saving.then(async () => {
    try {
      await saveClass(list)
      status.replaceChildren(message)
      status.hidden = false
    } catch (error) {
      showMessage(status, errorMessage(error))
    }
  })
  return saving
}

/** Applies an edit, saves it and redraws. */
function change(edit: (list: ClassList) => ClassList, message?: string): void {
  if (!current) return
  const next = edit(current)
  if (next === current) return
  void save(next, message)
  render()
}

function render(): void {
  const list = current
  if (!list) return
  title.textContent = list.name
  summary.textContent = `${learnerCount(list.learners.length)} · ${list.idDigits}-digit Learner IDs`
  digitsSelect.value = String(list.idDigits)
  noLearners.hidden = list.learners.length > 0
  listEl.replaceChildren(...list.learners.map((l, i) => row(l, i, list.learners.length)))
  const full = nextLearnerId(list) === null
  addButton.disabled = full
  addButton.title = full ? `No ${list.idDigits}-digit Learner IDs are left. Use more digits to add learners.` : ''
}

function iconButton(text: string, label: string, action: string, disabled = false): HTMLButtonElement {
  return h('button', { type: 'button', class: 'icon small', 'aria-label': label, 'data-action': action, disabled, text })
}

function row(learner: Learner, index: number, count: number): HTMLLIElement {
  const label = learner.name ? `${learner.id} ${learner.name}` : learner.id
  return h(
    'li',
    { class: 'learner-row', 'data-id': learner.id },
    h('span', { class: 'id', text: learner.id }),
    h('input', {
      type: 'text',
      class: 'learner-name',
      value: learner.name ?? '',
      placeholder: 'No name',
      'aria-label': `Name for Learner ID ${learner.id}`,
    }),
    h(
      'span',
      { class: 'row-actions' },
      iconButton('↑', `Move ${label} up`, 'up', index === 0),
      iconButton('↓', `Move ${label} down`, 'down', index === count - 1),
      iconButton('✕', `Remove ${label}`, 'remove'),
    ),
  )
}

function focusRow(id: string, selector: string): void {
  const rowEl = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)
  const target = rowEl?.querySelector<HTMLButtonElement>(selector)
  if (target && !target.disabled) target.focus()
  else rowEl?.querySelector<HTMLInputElement>('.learner-name')?.focus()
}

listEl.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>('button[data-action]')
  if (!button || !current) return
  const id = button.closest<HTMLElement>('.learner-row')!.dataset.id!
  const index = current.learners.findIndex((l) => l.id === id)
  const action = button.dataset.action
  if (action === 'up' || action === 'down') {
    change((l) => moveLearner(l, index, action === 'up' ? index - 1 : index + 1))
    focusRow(id, `[data-action="${action}"]`)
  } else if (action === 'remove') {
    const removed = current.learners[index]
    beforeRemoval = current
    change((l) => removeLearner(l, id), '')
    const undo = h('button', { type: 'button', class: 'small', text: 'Undo' })
    undo.addEventListener('click', () => {
      if (!beforeRemoval) return
      const restore = beforeRemoval
      beforeRemoval = null
      change(() => restore, `Put back ${removed.id}.`)
      focusRow(removed.id, '[data-action="remove"]')
    })
    void saving.then(() => {
      status.replaceChildren(`Removed ${removed.name ? `${removed.name} (${removed.id})` : removed.id}. `, undo)
      status.hidden = false
    })
    const next = current.learners[Math.min(index, current.learners.length - 1)]
    if (next) focusRow(next.id, '[data-action="remove"]')
    else addName.focus()
  }
})

// Names save as you type (after a short pause) and again when you leave the box.
let typingTimer: number | undefined

function saveName(input: HTMLInputElement): void {
  window.clearTimeout(typingTimer)
  const id = input.closest<HTMLElement>('.learner-row')?.dataset.id
  if (!id || !current) return
  const learner = current.learners.find((l) => l.id === id)
  if ((learner?.name ?? '') === tidyName(input.value)) return
  void save(renameLearner(current, id, input.value))
}

listEl.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  window.clearTimeout(typingTimer)
  typingTimer = window.setTimeout(() => saveName(input), 400)
})
listEl.addEventListener('change', (e) => saveName(e.target as HTMLInputElement))
listEl.addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement
  if (e.key !== 'Enter' || !input.classList.contains('learner-name')) return
  e.preventDefault()
  saveName(input)
  // Enter moves to the next name, like a spreadsheet.
  const next = input.closest('li')?.nextElementSibling?.querySelector<HTMLInputElement>('.learner-name')
  ;(next ?? addName).focus()
})

let classNameTimer: number | undefined

function saveClassName(): void {
  window.clearTimeout(classNameTimer)
  const name = tidyName(nameInput.value)
  if (!current || !name || name === current.name) return
  title.textContent = name
  void save({ ...current, name })
}

nameInput.addEventListener('input', () => {
  window.clearTimeout(classNameTimer)
  classNameTimer = window.setTimeout(saveClassName, 400)
})
nameInput.addEventListener('change', () => {
  if (!tidyName(nameInput.value) && current) nameInput.value = current.name
  saveClassName()
})

digitsSelect.addEventListener('change', () => {
  if (!current) return
  const digits = Number(digitsSelect.value)
  const result = changeIdDigits(current, digits)
  if (!result.ok) {
    const ids = result.tooLong
    showMessage(
      digitsWarning,
      `Learner ID${ids.length === 1 ? '' : 's'} ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''} would not fit in ${digits} digit${digits === 1 ? '' : 's'}. Remove ${ids.length === 1 ? 'that learner' : 'those learners'} first, or keep ${current.idDigits} digits.`,
    )
    digitsSelect.value = String(current.idDigits)
    return
  }
  showMessage(
    digitsWarning,
    `Learner IDs now have ${digits} digit${digits === 1 ? '' : 's'}. Print new sheets for this class after a change like this.`,
  )
  change(() => result.list)
})

el('sort-names').addEventListener('click', () => change(sortByName, 'Sorted by name. Learner IDs have not changed.'))
el('export-csv').addEventListener('click', () => {
  if (current) exportClassCsv(current)
})

addForm.addEventListener('submit', (e) => {
  e.preventDefault()
  if (!current) return
  const before = current
  change((l) => addLearner(l, addName.value), 'Added.')
  if (current === before) return
  addName.value = ''
  addName.focus()
  listEl.lastElementChild?.scrollIntoView({ block: 'nearest' })
})
