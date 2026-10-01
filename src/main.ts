import { attachAnnotationLayer, type AnnotationLayer } from './annotation-layer'
import { exportMarkedPdf, markedFileName } from './export'
import { createMarkingModel } from './marking-model'
import { looksLikePdf } from './pdf-file'
import { loadPdf } from './pdf-worker'
import { getOpenedTest, setOpenedTest } from './session'
import { createViewer, type Viewer } from './viewer'

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

let viewer: Viewer | null = null
let annotationLayer: AnnotationLayer | null = null
const model = createMarkingModel()
/** True when the model has changed since the last export (or since the Test was opened). */
let unexported = false
model.onChange(() => {
  unexported = true
})

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
  zoomLevel.textContent = `${Math.round((scale * 72) / 96 * 100)}%`
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
    const reason =
      (e as Error)?.name === 'PasswordException'
        ? 'it is password protected'
        : 'it appears to be damaged'
    showError(`"${file.name}" could not be opened: ${reason}.`)
    return
  }

  viewer?.destroy()
  annotationLayer?.destroy()
  viewer = null
  annotationLayer = null
  openScreen.hidden = true
  viewerScreen.hidden = false
  fileName.textContent = file.name
  setOpenedTest({ name: file.name, bytes })
  model.reset() // marking never carries over to the next Test
  unexported = false
  const next = await createViewer(viewerEl, doc)
  next.onScaleChange(updateZoomLabel)
  updateZoomLabel(next.scale)
  viewer = next
  annotationLayer = attachAnnotationLayer(next, model)
}

async function exportMarked(): Promise<void> {
  const test = getOpenedTest()
  if (!test) return
  let marked: Uint8Array
  try {
    marked = await exportMarkedPdf(test.bytes, model.getAnnotations())
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
