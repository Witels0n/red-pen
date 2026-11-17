import { byId, pages as pagesLabel, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { withSuffix } from '../shared/pdf/file-names'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { attachSortable } from '../shared/pdf/sortable'
import { createThumbnailRenderer, type ThumbnailRenderer } from '../shared/pdf/thumbnails'
import { organisePdf } from './organise'
import { initialPages, movePage, removePage, rotateAll, rotatePage, type PageSlot } from './page-order'
import './styles.css'

startPdfTool('Organise pages')

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const grid = byId<HTMLOListElement>('page-grid')
const summary = byId('summary')
const status = byId('status')
const saveButton = byId<HTMLButtonElement>('save')

let opened: OpenedPdf | null = null
let slots: PageSlot[] = []
let thumbnails: ThumbnailRenderer | null = null
/** One canvas per original page, kept across re-renders so a page is drawn only once. */
let canvases = new Map<number, HTMLCanvasElement>()

function showError(message: string): void {
  const target = opened ? workError : openError
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

function button(action: string, label: string, text: string, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon'
  b.dataset.action = action
  b.setAttribute('aria-label', label)
  b.title = label
  b.textContent = text
  b.disabled = disabled
  return b
}

function canvasFor(source: number): HTMLCanvasElement {
  let canvas = canvases.get(source)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    canvases.set(source, canvas)
    thumbnails?.observe(canvas, source)
  }
  return canvas
}

function render(): void {
  summary.textContent = opened ? `${opened.name}, ${pagesLabel(slots.length)}` : ''
  saveButton.disabled = slots.length === 0
  grid.replaceChildren(
    ...slots.map((slot, i) => {
      const n = slot.source + 1
      const li = document.createElement('li')
      li.className = 'page-card'
      li.draggable = true
      li.dataset.source = String(slot.source)
      li.dataset.turn = String(slot.turn)

      const thumb = document.createElement('div')
      thumb.className = 'thumb'
      const canvas = canvasFor(slot.source)
      canvas.style.transform = slot.turn ? `rotate(${slot.turn}deg)` : ''
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `Page ${n}${slot.turn ? `, turned ${slot.turn} degrees` : ''}`)
      thumb.append(canvas)

      const caption = document.createElement('p')
      caption.className = 'page-caption'
      caption.innerHTML = `<span class="drag-handle" aria-hidden="true">⠿</span> `
      const label = document.createElement('span')
      label.className = 'page-label'
      label.textContent = `Page ${n}`
      caption.append(label)

      const rotate = document.createElement('div')
      rotate.className = 'page-actions'
      rotate.append(
        button('rotate-left', `Rotate page ${n} left`, '↺'),
        button('rotate-right', `Rotate page ${n} right`, '↻'),
        button('delete', `Delete page ${n}`, '✕'),
      )
      const move = document.createElement('div')
      move.className = 'page-actions'
      move.append(
        button('move-earlier', `Move page ${n} earlier`, '←', i === 0),
        button('move-later', `Move page ${n} later`, '→', i === slots.length - 1),
      )

      li.append(thumb, caption, rotate, move)
      return li
    }),
  )
}

/** Re-render, then return focus to the same action on the page with this source (or a fallback). */
function renderAndFocus(source: number | undefined, action: string): void {
  render()
  const card = grid.querySelector<HTMLElement>(`[data-source="${source}"]`)
  const preferred = card?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
  const fallback = card?.querySelector<HTMLButtonElement>('button:not(:disabled)')
  ;(preferred && !preferred.disabled ? preferred : (fallback ?? saveButton)).focus()
}

async function openFile(file: File): Promise<void> {
  clearErrors()
  let next: OpenedPdf
  try {
    next = await openPdfFile(file)
  } catch (e) {
    showError(openErrorMessage(e, file.name))
    return
  }
  thumbnails?.destroy()
  thumbnails = null
  canvases = new Map()
  opened = next
  slots = initialPages(next.pageCount)
  openScreen.hidden = true
  workScreen.hidden = false
  try {
    thumbnails = await createThumbnailRenderer(next.bytes)
  } catch {
    // Organising still works without pictures of the pages.
    showError(`Previews of "${next.name}" could not be drawn, but its pages can still be organised.`)
  }
  render()
}

async function save(): Promise<void> {
  clearErrors()
  if (!opened || slots.length === 0) return
  saveButton.disabled = true
  try {
    const bytes = await organisePdf(opened.doc, slots)
    downloadFile(bytes, withSuffix(opened.name, 'organised'), 'application/pdf')
    announce('PDF saved.')
  } catch {
    showError('The organised PDF could not be created.')
  } finally {
    saveButton.disabled = slots.length === 0
  }
}

grid.addEventListener('click', (e) => {
  const target = (e.target as Element).closest<HTMLButtonElement>('button[data-action]')
  const card = target?.closest<HTMLElement>('.page-card')
  if (!target || !card) return
  const index = slots.findIndex((s) => String(s.source) === card.dataset.source)
  if (index < 0) return
  const source = slots[index].source
  const n = source + 1
  const action = target.dataset.action!
  switch (action) {
    case 'rotate-left':
    case 'rotate-right':
      slots = rotatePage(slots, index, action === 'rotate-left' ? 'left' : 'right')
      announce(`Page ${n} turned ${action === 'rotate-left' ? 'left' : 'right'}.`)
      renderAndFocus(source, action)
      break
    case 'move-earlier':
    case 'move-later': {
      const to = action === 'move-earlier' ? index - 1 : index + 1
      slots = movePage(slots, index, to)
      announce(`Page ${n} moved to position ${to + 1} of ${slots.length}.`)
      renderAndFocus(source, action)
      break
    }
    case 'delete': {
      slots = removePage(slots, index)
      announce(`Page ${n} deleted.`)
      const neighbour = slots[Math.min(index, slots.length - 1)]
      renderAndFocus(neighbour?.source, 'delete')
      break
    }
  }
})

attachSortable(grid, '.page-card', (from, to) => {
  const n = slots[from].source + 1
  slots = movePage(slots, from, to)
  announce(`Page ${n} moved to position ${to + 1} of ${slots.length}.`)
  render()
})

byId('rotate-all-left').addEventListener('click', () => {
  slots = rotateAll(slots, 'left')
  announce('Every page turned left.')
  render()
})
byId('rotate-all-right').addEventListener('click', () => {
  slots = rotateAll(slots, 'right')
  announce('Every page turned right.')
  render()
})
byId('reset').addEventListener('click', () => {
  if (!opened) return
  slots = initialPages(opened.pageCount)
  clearErrors()
  announce('Back to the original pages.')
  render()
})
saveButton.addEventListener('click', () => void save())

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: ([file]) => void openFile(file),
})
