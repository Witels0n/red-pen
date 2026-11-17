import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { moveItem } from '../shared/pdf/list-order'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { attachSortable } from '../shared/pdf/sortable'
import { COMBINED_FILE_NAME, combinePdfs } from './combine'
import './styles.css'

startPdfTool('Combine PDFs')

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const list = byId<HTMLOListElement>('file-list')
const summary = byId('summary')
const status = byId('status')
const combineButton = byId<HTMLButtonElement>('combine')

interface Entry extends OpenedPdf {
  id: number
}

let entries: Entry[] = []
let nextId = 1

function showError(message: string): void {
  const target = entries.length > 0 ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function announce(message: string): void {
  status.textContent = message
}

function button(className: string, label: string, text: string, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `icon ${className}`
  b.setAttribute('aria-label', label)
  b.title = label
  b.textContent = text
  b.disabled = disabled
  return b
}

function render(): void {
  openScreen.hidden = entries.length > 0
  workScreen.hidden = entries.length === 0
  const total = entries.reduce((sum, e) => sum + e.pageCount, 0)
  summary.textContent = `${entries.length} ${entries.length === 1 ? 'file' : 'files'}, ${pages(total)}`
  combineButton.disabled = entries.length === 0

  list.replaceChildren(
    ...entries.map((entry, i) => {
      const li = document.createElement('li')
      li.className = 'file-item'
      li.draggable = true
      li.dataset.id = String(entry.id)

      const handle = document.createElement('span')
      handle.className = 'drag-handle'
      handle.setAttribute('aria-hidden', 'true')
      handle.textContent = '⠿'

      const info = document.createElement('span')
      info.className = 'file-info'
      const name = document.createElement('span')
      name.className = 'file-name'
      name.textContent = entry.name
      const count = document.createElement('span')
      count.className = 'file-pages'
      count.textContent = pages(entry.pageCount)
      info.append(name, count)

      const actions = document.createElement('span')
      actions.className = 'file-actions'
      actions.append(
        button('move-up', `Move ${entry.name} up`, '↑', i === 0),
        button('move-down', `Move ${entry.name} down`, '↓', i === entries.length - 1),
        button('remove', `Remove ${entry.name}`, '✕'),
      )

      li.append(handle, info, actions)
      return li
    }),
  )
}

/** Re-render, then put focus back on `selector` in the item with this id (or a sensible fallback). */
function renderAndFocus(id: number | undefined, selector: string): void {
  render()
  const item = list.querySelector<HTMLElement>(`[data-id="${id}"]`)
  const preferred = item?.querySelector<HTMLButtonElement>(selector)
  const fallback = item?.querySelector<HTMLButtonElement>('button:not(:disabled)')
  ;(preferred && !preferred.disabled ? preferred : (fallback ?? combineButton)).focus()
}

function move(from: number, to: number): void {
  if (to < 0 || to >= entries.length) return
  const entry = entries[from]
  entries = moveItem(entries, from, to)
  announce(`${entry.name} moved to position ${to + 1} of ${entries.length}.`)
}

async function addFiles(files: File[]): Promise<void> {
  clearErrors()
  const problems: string[] = []
  for (const file of files) {
    try {
      const opened = await openPdfFile(file)
      entries.push({ ...opened, id: nextId++ })
    } catch (e) {
      problems.push(openErrorMessage(e, file.name))
    }
  }
  render()
  if (problems.length > 0) showError(problems.join('\n'))
  else announce(`${files.length === 1 ? 'File' : 'Files'} added. ${summary.textContent}.`)
}

async function combineAndDownload(): Promise<void> {
  clearErrors()
  if (entries.length === 0) return
  combineButton.disabled = true
  try {
    const bytes = await combinePdfs(entries.map((e) => e.doc))
    downloadFile(bytes, COMBINED_FILE_NAME, 'application/pdf')
    announce(`Downloaded ${COMBINED_FILE_NAME}.`)
  } catch {
    showError('The combined PDF could not be created.')
  } finally {
    combineButton.disabled = entries.length === 0
  }
}

list.addEventListener('click', (e) => {
  const target = (e.target as Element).closest('button')
  const item = target?.closest<HTMLElement>('.file-item')
  if (!target || !item) return
  const index = entries.findIndex((entry) => String(entry.id) === item.dataset.id)
  if (index < 0) return
  const id = entries[index].id
  if (target.classList.contains('move-up')) {
    move(index, index - 1)
    renderAndFocus(id, '.move-up')
  } else if (target.classList.contains('move-down')) {
    move(index, index + 1)
    renderAndFocus(id, '.move-down')
  } else if (target.classList.contains('remove')) {
    const [removed] = entries.splice(index, 1)
    clearErrors()
    announce(`${removed.name} removed.`)
    const neighbour = entries[Math.min(index, entries.length - 1)]
    renderAndFocus(neighbour?.id, '.remove')
  }
})

attachSortable(list, '.file-item', (from, to) => {
  move(from, to)
  render()
})

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: (files) => void addFiles(files),
})

combineButton.addEventListener('click', () => void combineAndDownload())
render()
