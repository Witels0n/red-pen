import {
  classFromCsv,
  deleteClass,
  duplicateClassList,
  listClasses,
  newClassList,
  readTextFile,
  saveClass,
  tidyName,
  type ClassList,
} from '../shared/classes'
import { changedWhen, el, errorMessage, exportClassCsv, go, h, learnerCount, showMessage } from './dom'

const listEl = el<HTMLUListElement>('class-list')
const noClasses = el('no-classes')
const homeError = el('home-error')
const classFileInput = el<HTMLInputElement>('class-file-input')

/** Which card has its rename box or delete question open, so a re-render keeps it. */
let open: { id: string; mode: 'rename' | 'delete' } | null = null
let classes: ClassList[] = []

export async function showHome(): Promise<void> {
  open = null
  showMessage(homeError, '')
  await refresh()
}

async function refresh(focusId?: string, focusSelector?: string): Promise<void> {
  try {
    classes = await listClasses()
  } catch (error) {
    showMessage(homeError, errorMessage(error))
    classes = []
  }
  render()
  if (focusId && focusSelector) {
    listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] ${focusSelector}`)?.focus()
  }
}

function render(): void {
  noClasses.hidden = classes.length > 0
  listEl.replaceChildren(...classes.map(card))
}

function meta(list: ClassList): string {
  return `${learnerCount(list.learners.length)} · ${list.idDigits}-digit IDs · changed ${changedWhen(list.updatedAt)}`
}

function card(list: ClassList): HTMLLIElement {
  const li = h('li', { class: 'class-card', 'data-id': list.id })
  const title = h(
    'h3',
    { class: 'class-name' },
    h('a', { href: `#class/${encodeURIComponent(list.id)}`, text: list.name }),
  )
  li.append(h('div', { class: 'class-main' }, title, h('p', { class: 'meta', text: meta(list) })))

  if (open?.id === list.id && open.mode === 'rename') li.append(renameForm(list))
  else if (open?.id === list.id && open.mode === 'delete') li.append(deleteQuestion(list))
  else li.append(actions(list))
  return li
}

function button(text: string, label: string, onClick: () => void, cls = 'small'): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, text })
  b.addEventListener('click', onClick)
  return b
}

function actions(list: ClassList): HTMLElement {
  const named = (verb: string) => `${verb} ${list.name}`
  return h(
    'div',
    { class: 'class-actions' },
    h('a', {
      class: 'button small',
      href: `#class/${encodeURIComponent(list.id)}`,
      'aria-label': named('Open'),
      text: 'Open',
    }),
    button('Rename', named('Rename'), () => {
      open = { id: list.id, mode: 'rename' }
      render()
      listEl.querySelector<HTMLInputElement>(`[data-id="${CSS.escape(list.id)}"] input`)?.select()
    }),
    button('Duplicate', named('Duplicate'), () => void duplicate(list)),
    button('Export CSV', named('Export CSV of'), () => exportClassCsv(list)),
    button('Delete', named('Delete'), () => {
      open = { id: list.id, mode: 'delete' }
      render()
      listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(list.id)}"] .keep`)?.focus()
    }),
  )
}

function closeAndFocus(list: ClassList, selector: string): void {
  open = null
  render()
  listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(list.id)}"] ${selector}`)?.focus()
}

function renameForm(list: ClassList): HTMLFormElement {
  const input = h('input', { type: 'text', value: list.name, 'aria-label': 'New name for the class' })
  const form = h(
    'form',
    { class: 'inline-form' },
    input,
    h('button', { type: 'submit', class: 'small primary', text: 'Save name' }),
  )
  form.append(button('Cancel', 'Cancel renaming', () => closeAndFocus(list, '[aria-label^="Rename"]')))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAndFocus(list, '[aria-label^="Rename"]')
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = tidyName(input.value)
    if (!name) {
      input.focus()
      return
    }
    try {
      await saveClass({ ...list, name })
      open = null
      await refresh(list.id, '[aria-label^="Rename"]')
    } catch (error) {
      showMessage(homeError, errorMessage(error))
    }
  })
  return form
}

function deleteQuestion(list: ClassList): HTMLElement {
  const box = h(
    'div',
    { class: 'confirm', role: 'group', 'aria-label': `Delete ${list.name}?` },
    h('p', { text: `Delete ${list.name} and its ${learnerCount(list.learners.length)}? This cannot be undone.` }),
  )
  const yes = button(
    'Delete',
    `Yes, delete ${list.name}`,
    async () => {
      try {
        await deleteClass(list.id)
        open = null
        await refresh()
        el('new-class').focus()
      } catch (error) {
        showMessage(homeError, errorMessage(error))
      }
    },
    'small danger',
  )
  const keep = button('Keep it', `Keep ${list.name}`, () => closeAndFocus(list, '[aria-label^="Delete"]'), 'small keep')
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAndFocus(list, '[aria-label^="Delete"]')
  })
  box.append(h('div', { class: 'class-actions' }, keep, yes))
  return box
}

async function duplicate(list: ClassList): Promise<void> {
  try {
    const copy = await saveClass(duplicateClassList(list))
    await refresh(copy.id, '.class-name a')
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
}

classFileInput.addEventListener('change', async () => {
  const file = classFileInput.files?.[0]
  classFileInput.value = ''
  if (!file) return
  showMessage(homeError, '')
  try {
    const result = classFromCsv(await readTextFile(file))
    if (result.problems.length > 0) {
      showMessage(homeError, `${file.name} could not be imported.\n${result.problems.slice(0, 8).join('\n')}`)
      return
    }
    const name = file.name.replace(/\.csv$/i, '')
    const saved = await saveClass(newClassList(name, result.idDigits, result.learners))
    go(`#class/${encodeURIComponent(saved.id)}`)
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
})
