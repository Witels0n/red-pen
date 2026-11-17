import './styles.css'
import { PDFDocument } from 'pdf-lib'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { formatDate, type DateStyle } from './dates'
import { withoutCovered, type DetectedBox } from './detect'
import { createDetector, type Detector } from './detection'
import { buildSignedPdf, signedFileName } from './export'
import { attachFormLayer, type FormLayer } from './form-fields'
import { boxAt, DEFAULT_TEXT_SIZE, fitImage, fitMark, fitText, hitArea } from './geometry'
import { attachItemsLayer, type ItemsLayer } from './items-layer'
import { createSignModel, type Ink, type Item } from './model'
import { looksLikePdf } from './pdf-file'
import { loadPdf } from './pdf-worker'
import { createSavedSignatures, type SignatureKind } from './saved-signature'
import { imageAspect, openSignatureDialog } from './signature-dialog'
import { createViewer, type PageView, type Viewer } from './viewer'

registerOffline(mountSiteHeader({ toolName: 'Sign and fill' }))

type Tool = 'text' | 'tick' | 'cross' | 'date' | 'initials' | 'signature'

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
const hint = el('hint')
const sizeInput = el<HTMLInputElement>('text-size')
const showDetected = el<HTMLInputElement>('show-detected')
const dateStyle = el<HTMLSelectElement>('date-style')
const undoButton = el<HTMLButtonElement>('undo')
const redoButton = el<HTMLButtonElement>('redo')
const deleteButton = el<HTMLButtonElement>('delete')

const model = createSignModel()
const saved = createSavedSignatures()
/** The signature and initials made (or loaded) for this visit. */
const images: Record<SignatureKind, string | null> = { signature: saved.load('signature'), initials: saved.load('initials') }

let opened: { name: string; bytes: Uint8Array } | null = null
let viewer: Viewer | null = null
let items: ItemsLayer | null = null
let form: FormLayer | null = null
let detector: Detector | null = null
const detected = new Map<number, DetectedBox[]>()
const detectedLayers = new Map<number, HTMLElement>()
/** Bumped for every opened file, so late detection results for an old file are dropped. */
let generation = 0
let tool: Tool = 'text'
let ink: Ink = 'black'
let textSize = DEFAULT_TEXT_SIZE
let unsaved = false
let detectionStatus = ''

model.onChange(() => {
  unsaved = true
  items?.render()
  syncHistoryButtons()
})

// Date format choices show today's date in each style.
const today = new Date()
for (const option of dateStyle.options) option.textContent = formatDate(today, option.value as DateStyle)

function showError(message: string): void {
  const target = viewer ? viewerError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  viewerError.hidden = true
}

function updateZoomLabel(scale: number): void {
  zoomLevel.textContent = `${Math.round(((scale * 72) / 96) * 100)}%`
}

const TOOL_HINTS: Record<Tool, string> = {
  text: 'Click a dashed box or line to fill it in, or click anywhere to add text.',
  tick: 'Click to place a tick. Clicking a tick box ticks it.',
  cross: 'Click to place a cross.',
  date: "Click where today's date goes.",
  initials: 'Click where your initials go.',
  signature: 'Click where your signature goes.',
}

function updateHint(): void {
  hint.textContent = [TOOL_HINTS[tool], detectionStatus].filter(Boolean).join(' ')
}

function setTool(next: Tool): void {
  tool = next
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tools .tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === next))
  viewerEl.dataset.tool = next
  updateHint()
}

function setInk(next: Ink): void {
  ink = next
  for (const b of document.querySelectorAll<HTMLButtonElement>('#ink .swatch')) b.setAttribute('aria-checked', String(b.dataset.ink === next))
}

function syncHistoryButtons(): void {
  undoButton.disabled = !model.canUndo()
  redoButton.disabled = !model.canRedo()
}

function onSelect(item: Item | null): void {
  deleteButton.disabled = !item
  if (item?.type === 'text') sizeInput.value = String(item.size)
  if (item && 'ink' in item) setInk(item.ink)
}

// ---- Detected boxes ---------------------------------------------------------------------

function renderDetected(page: PageView): void {
  let layer = detectedLayers.get(page.pageNumber)
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'detected-layer'
    page.overlay.prepend(layer)
    detectedLayers.set(page.pageNumber, layer)
  }
  const boxes = detected.get(page.pageNumber) ?? []
  const s = page.scale
  layer.replaceChildren(
    ...boxes.map((b) => {
      const a = hitArea(b)
      const d = document.createElement('div')
      d.className = `detected detected-${b.kind}`
      d.style.left = `${a.x * s}px`
      d.style.top = `${a.y * s}px`
      d.style.width = `${a.width * s}px`
      d.style.height = `${a.height * s}px`
      return d
    }),
  )
}

async function runDetection(pages: readonly PageView[], gen: number): Promise<void> {
  detector ??= createDetector()
  let found = 0
  viewerEl.dataset.detection = 'running'
  for (const page of pages) {
    detectionStatus = pages.length > 1 ? `Looking for boxes to fill in (page ${page.pageNumber} of ${pages.length})...` : 'Looking for boxes to fill in...'
    updateHint()
    let boxes: DetectedBox[] = []
    try {
      boxes = await detector.detect(page.pdfPage)
    } catch {
      boxes = [] // detection only helps; the page still works without it
    }
    if (gen !== generation) return
    boxes = withoutCovered(boxes, form?.rects(page.pageNumber) ?? [])
    detected.set(page.pageNumber, boxes)
    found += boxes.length
    renderDetected(page)
  }
  detectionStatus = found ? `Found ${found} likely ${found === 1 ? 'place' : 'places'} to fill in.` : ''
  if (form && form.count) detectionStatus = `This PDF has ${form.count} form ${form.count === 1 ? 'field' : 'fields'}. ${detectionStatus}`
  viewerEl.dataset.detection = 'done'
  updateHint()
}

showDetected.addEventListener('change', () => viewerEl.classList.toggle('hide-detected', !showDetected.checked))

// ---- Opening ----------------------------------------------------------------------------

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
    showError(`"${file.name}" is not a PDF file. Please choose a PDF.`)
    return
  }
  // pdf-lib must be able to write the file, so check it first. It refuses encrypted files.
  try {
    await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    const encrypted = /encrypt/i.test(String((e as Error)?.message))
    showError(
      encrypted
        ? `"${file.name}" is password protected or encrypted, so it cannot be filled in here. Save an unprotected copy and try again.`
        : `"${file.name}" could not be opened: it appears to be damaged.`,
    )
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

  const gen = ++generation
  items?.destroy()
  form?.destroy()
  viewer?.destroy()
  items = null
  form = null
  viewer = null
  detected.clear()
  detectedLayers.clear()
  detectionStatus = ''
  openScreen.hidden = true
  viewerScreen.hidden = false
  fileName.textContent = file.name
  opened = { name: file.name, bytes }
  model.reset()
  unsaved = false

  const next = await createViewer(viewerEl, doc)
  viewer = next
  updateZoomLabel(next.scale)
  form = await attachFormLayer(next.pages, () => (unsaved = true))
  items = attachItemsLayer(next.pages, model, onSelect)
  next.onScaleChange((scale) => {
    updateZoomLabel(scale)
    items?.render()
    form?.layout()
    next.pages.forEach(renderDetected)
  })
  syncHistoryButtons()
  setTool('text')
  void runDetection(next.pages, gen)
}

// ---- Placing ----------------------------------------------------------------------------

async function chooseImage(kind: SignatureKind): Promise<boolean> {
  const result = await openSignatureDialog(kind, images[kind], saved)
  if (!result) return false
  images[kind] = result.src
  return true
}

function toggleTickIn(page: PageView, box: DetectedBox, type: 'tick' | 'cross'): void {
  const existing = model.items().find((i) => {
    if (i.page !== page.pageNumber || (i.type !== 'tick' && i.type !== 'cross')) return false
    const cx = i.x + i.size / 2
    const cy = i.y + i.size / 2
    return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height
  })
  if (existing) model.remove(existing.id)
  else model.add({ type, page: page.pageNumber, ...fitMark(box), ink })
}

async function placeAt(page: PageView, x: number, y: number): Promise<void> {
  const box = showDetected.checked ? boxAt(detected.get(page.pageNumber) ?? [], x, y) : undefined
  if (box?.kind === 'tick' && tool !== 'signature' && tool !== 'initials') {
    toggleTickIn(page, box, tool === 'cross' ? 'cross' : 'tick')
    return
  }
  const n = page.pageNumber
  switch (tool) {
    case 'text': {
      if (box) items!.startText({ page: n, ...fitText(box), ink })
      else items!.startText({ page: n, x, y: y + textSize * 0.35, size: textSize, ink })
      return
    }
    case 'date': {
      const text = formatDate(new Date(), dateStyle.value as DateStyle)
      const at = box ? fitText(box) : { x, y: y + textSize * 0.35, size: textSize, width: undefined }
      const id = model.add({ type: 'text', page: n, ...at, text, ink })
      items!.select(id)
      return
    }
    case 'tick':
    case 'cross': {
      const size = 14
      model.add({ type: tool, page: n, x: x - size / 2, y: y - size / 2, size, ink })
      return
    }
    case 'signature':
    case 'initials': {
      const src = images[tool]
      if (!src) return
      const aspect = await imageAspect(src)
      const r = fitImage(aspect, tool === 'signature' ? 150 : 50, box ?? { x, y })
      const id = model.add({ type: tool, page: n, ...r, src })
      items!.select(id)
      setTool('text')
    }
  }
}

// A click that ends typing (in a text item or form field) does not also stamp a mark, date or
// signature. With the Text tool it may: an empty new text item simply disappears.
let endedTyping = false
viewerEl.addEventListener(
  'pointerdown',
  () => {
    const active = document.activeElement
    endedTyping = !!active && active !== document.body && !!active.closest('.item, .form-field')
  },
  true,
)

viewerEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  if (target.closest('.item, .form-field')) return
  const skip = endedTyping && tool !== 'text'
  endedTyping = false
  if (skip) return
  const pageEl = target.closest('.page')
  const page = viewer?.pages.find((p) => p.element === pageEl)
  if (!page) return
  items?.select(null)
  const r = page.element.getBoundingClientRect()
  void placeAt(page, (e.clientX - r.left) / page.scale, (e.clientY - r.top) / page.scale)
})

for (const b of document.querySelectorAll<HTMLButtonElement>('#tools .tool')) {
  b.addEventListener('click', async () => {
    const t = b.dataset.tool as Tool
    if (t === 'signature' || t === 'initials') {
      if (!(await chooseImage(t))) return
    }
    setTool(t)
  })
}
dateStyle.addEventListener('change', () => setTool('date'))

for (const b of document.querySelectorAll<HTMLButtonElement>('#ink .swatch')) {
  b.addEventListener('click', () => {
    setInk(b.dataset.ink as Ink)
    const id = items?.selected()
    const item = id ? model.get(id) : undefined
    if (item && 'ink' in item) model.update(item.id, { ink })
  })
}

sizeInput.addEventListener('change', () => {
  const n = Number(sizeInput.value)
  if (!Number.isFinite(n) || n < 5 || n > 72) return
  textSize = n
  const id = items?.selected()
  const item = id ? model.get(id) : undefined
  if (item?.type === 'text') model.update(item.id, { size: n })
})

// ---- History, deleting, keys ------------------------------------------------------------

undoButton.addEventListener('click', () => model.undo())
redoButton.addEventListener('click', () => model.redo())
deleteButton.addEventListener('click', () => {
  const id = items?.selected()
  if (id) model.remove(id)
})

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return
  if (!viewer) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) model.undo()
    else if (key === 'y' || (key === 'z' && e.shiftKey)) model.redo()
    else return
    e.preventDefault()
    return
  }
  const id = items?.selected()
  if (id && (e.key === 'Delete' || e.key === 'Backspace')) {
    model.remove(id)
    e.preventDefault()
  } else if (e.key === 'Escape') items?.select(null)
})

// ---- Saving -----------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!opened || !items || !form) return
  items.commitTyping()
  clearErrors()
  let out: Uint8Array
  try {
    out = await buildSignedPdf(opened.bytes, model.items(), form.values())
  } catch {
    showError('The signed PDF could not be created.')
    return
  }
  const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = signedFileName(opened.name)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  unsaved = false
}

el('save').addEventListener('click', () => void save())

window.addEventListener('beforeunload', (e) => {
  if (!unsaved) return
  e.preventDefault()
  e.returnValue = ''
})

// ---- Zoom, file picker, drag and drop ---------------------------------------------------

el('zoom-in').addEventListener('click', () => viewer?.zoomIn())
el('zoom-out').addEventListener('click', () => viewer?.zoomOut())
el('zoom-fit').addEventListener('click', () => viewer?.fitToWidth())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) void openFile(file)
})

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
