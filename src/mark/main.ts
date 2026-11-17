import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { attachAnnotationLayer, type AnnotationLayer, type ClickMark } from './annotation-layer'
import { applyIcons } from './icons'
import { attachSelection, type Selection } from './selection'
import { attachHistoryKeys } from './history-keys'
import { attachNoteEditing, editTextAt, placeTotalWithPrompt } from './note-editing'
import { attachToolbarDrag } from './toolbar-drag'
import { exportMarkedPdf, markedFileName } from './export'
import { createBrowserInk } from './ink'
import { attachInkSwatches } from './ink-swatches'
import { createMarkingModel } from './marking-model'
import { attachReasonPopup } from './reason-popup'
import { createBrowserReasonsList } from './reasons'
import { openReasonsEditor } from './reasons-editor'
import { looksLikePdf } from '../shared/pdf/pdf-file'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { getOpenedTest, setOpenedTest } from './session'
import { createViewer, type Viewer } from './viewer'

const siteHeader = mountSiteHeader({ toolName: 'Mark a test' })
registerOffline(siteHeader)
applyIcons()

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const openScreen = el('open-screen')
const viewerScreen = el('viewer-screen')
const dropZone = el('drop-zone')
const fileInput = el<HTMLInputElement>('file-input')
const openError = el('open-error')
const viewerError = el('viewer-error')
const fileName = el('file-name')
const zoomLevel = el('zoom-level')
const viewerEl = el('viewer')
const markCount = el('mark-count')
// The file name and mark count live in the Red Pen header bar, where there is room, keeping the
// toolbar to one row on a laptop. They stay hidden until a Test is open.
siteHeader.querySelector('.spacer')!.before(fileName, markCount)

let viewer: Viewer | null = null
let annotationLayer: AnnotationLayer | null = null
let selection: Selection | null = null
let detachNoteEditing: (() => void) | null = null
const model = createMarkingModel()
const ink = createBrowserInk()
attachInkSwatches(el('ink-swatches'), ink)
/** True when the model has changed since the last export (or since the Test was opened). */
let unexported = false
model.onChange(() => {
  unexported = true
})

const reasons = createBrowserReasonsList()
attachReasonPopup({ root: viewerEl, model, reasons, onEditReasons: () => openReasonsEditor(reasons) })
el('edit-reasons').addEventListener('click', () => openReasonsEditor(reasons))

function showError(message: string): void {
  // Errors never replace what is on screen: a previously opened Test stays usable.
  const target = viewer ? viewerError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  viewerError.hidden = true
}

function updateZoomLabel(scale: number): void {
  // Show zoom relative to 100% = 96 dpi (1 PDF unit = 96/72 CSS px).
  zoomLevel.textContent = `${Math.round(((scale * 72) / 96) * 100)}%`
}

async function openFile(file: File): Promise<void> {
  clearErrors()
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    showError(`"${file.name}" could not be read.`)
    return
  }
  if (!looksLikePdf(bytes)) {
    showError(`"${file.name}" is not a PDF file. Please choose a scanned test saved as a PDF.`)
    return
  }
  let doc
  try {
    doc = await loadPdf(bytes)
  } catch (e) {
    const reason = (e as Error)?.name === 'PasswordException' ? 'it is password protected' : 'it appears to be damaged'
    showError(`"${file.name}" could not be opened: ${reason}.`)
    return
  }

  viewer?.destroy()
  selection?.destroy()
  detachNoteEditing?.()
  annotationLayer?.destroy()
  viewer = null
  annotationLayer = null
  selection = null
  openScreen.hidden = true
  viewerScreen.hidden = false
  fileName.textContent = file.name
  fileName.title = file.name
  fileName.hidden = false
  markCount.hidden = false
  setOpenedTest({ name: file.name, bytes })
  model.reset() // marking never carries over to the next Test
  unexported = false
  const next = await createViewer(viewerEl, doc)
  next.onScaleChange(updateZoomLabel)
  updateZoomLabel(next.scale)
  viewer = next
  annotationLayer = attachAnnotationLayer(next, model, () => clickMark)
  selection = attachSelection(next, model, annotationLayer)
  detachNoteEditing = attachNoteEditing(next, model)
}

async function exportMarked(): Promise<void> {
  const test = getOpenedTest()
  if (!test) return
  let marked: Uint8Array
  try {
    marked = await exportMarkedPdf(test.bytes, model.getAnnotations(), ink.rgb())
  } catch {
    showError('The marked PDF could not be created.')
    return
  }
  const url = URL.createObjectURL(new Blob([marked as BlobPart], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = markedFileName(test.name)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  unexported = false
}

attachHistoryKeys(model)

// A Test has at most one Total: grey out its tool once placed.
const totalTool = el('tool-total')
const syncTotalTool = () => totalTool.setAttribute('aria-disabled', String(model.getTotal() !== undefined))
model.onChange(syncTotalTool)
syncTotalTool()

attachToolbarDrag(
  el('toolbar'),
  () => viewer,
  (tool, page, x, y) => {
    if (tool === 'subtotal') model.placeSubtotal(page.pageNumber, x, y)
    else if (tool === 'total') void placeTotalWithPrompt(model, page, x, y)
    else if (tool === 'text') {
      editTextAt(page, x, y, '', (text) => {
        if (text !== '') model.placeText(page.pageNumber, x, y, text)
      })
    }
  },
  viewerEl,
)

el('export').addEventListener('click', () => void exportMarked())

// Warn before the tab closes while there is marking that has not been exported.
window.addEventListener('beforeunload', (e) => {
  if (!unexported) return
  e.preventDefault()
  e.returnValue = ''
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = '' // allow re-opening the same file
  if (file) void openFile(file)
})

el('zoom-in').addEventListener('click', () => viewer?.zoomIn())
el('zoom-out').addEventListener('click', () => viewer?.zoomOut())
el('zoom-fit').addEventListener('click', () => viewer?.fitToWidth())

// Drag and drop works anywhere in the window, on both screens.
let dragDepth = 0
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dropZone.classList.add('drag-over')
})
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault()
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropZone.classList.remove('drag-over')
})
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dropZone.classList.remove('drag-over')
  const file = e.dataTransfer?.files[0]
  if (file) void openFile(file)
})

// --- Toolbar: click mode, undo and redo, mark count, More menu and tips ---

/** What a plain click places; a right-click places the other. Not remembered between visits. */
let clickMark: ClickMark = 'tick'
const modeTick = el<HTMLButtonElement>('mode-tick')
const modeCross = el<HTMLButtonElement>('mode-cross')
const hintClick = el('hint-click')
const hintRight = el('hint-right')
function setClickMark(mark: ClickMark): void {
  clickMark = mark
  modeTick.setAttribute('aria-pressed', String(mark === 'tick'))
  modeCross.setAttribute('aria-pressed', String(mark === 'cross'))
  viewerEl.dataset.clickMark = mark
  hintClick.textContent = mark
  hintRight.textContent = mark === 'tick' ? 'cross' : 'tick'
}
modeTick.addEventListener('click', () => setClickMark('tick'))
modeCross.addEventListener('click', () => setClickMark('cross'))
setClickMark('tick')

// T and X switch the click mode while a Test is open (never while typing).
document.addEventListener('keydown', (e) => {
  if (viewerScreen.hidden || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, select, [contenteditable]') || t.isContentEditable)) return
  const key = e.key.toLowerCase()
  if (key === 't') setClickMark('tick')
  else if (key === 'x') setClickMark('cross')
})

const undoButton = el<HTMLButtonElement>('undo')
const redoButton = el<HTMLButtonElement>('redo')
undoButton.addEventListener('click', () => model.undo())
redoButton.addEventListener('click', () => model.redo())

const tickCount = el('tick-count')
const crossCount = el('cross-count')
function syncToolbarState(): void {
  undoButton.disabled = !model.canUndo()
  redoButton.disabled = !model.canRedo()
  const annotations = model.getAnnotations()
  tickCount.textContent = String(annotations.filter((a) => a.type === 'tick').length)
  crossCount.textContent = String(annotations.filter((a) => a.type === 'cross').length)
}
model.onChange(syncToolbarState)
syncToolbarState()

// On narrow screens the less-used groups fold away behind "More".
const toolbar = el('toolbar')
const moreButton = el<HTMLButtonElement>('more')
moreButton.addEventListener('click', () => {
  const open = toolbar.classList.toggle('show-more')
  moreButton.setAttribute('aria-expanded', String(open))
})

// The tips strip shows until the teacher hides it; that choice is remembered on this device.
const HINT_KEY = 'red-pen.mark.hideTips'
const hint = el('hint')
function readHintHidden(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}
hint.hidden = readHintHidden()
el('hint-close').addEventListener('click', () => {
  hint.hidden = true
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    // Storage blocked: the tips simply come back next visit.
  }
})

// The "Open" labels stand in for the hidden file input, so make them work from the keyboard too.
for (const label of document.querySelectorAll<HTMLLabelElement>('label[for="file-input"]')) {
  label.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    fileInput.click()
  })
}
