import { zipSync } from 'fflate'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { createViewer, type Viewer } from '../shared/pdf/page-viewer'
import { loadPdf, pdfjs } from '../shared/pdf/pdf-worker'
import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { attachBoxesLayer, type BoxesLayer } from './boxes-layer'
import { createLayoutModel, parseLayout, redactedPages, type Fill, type RedactionBox } from './model'
import { DEFAULT_PREFIX, keyCsv, listOrder, planNames, shuffledOrder, type NamedFile } from './names'
import { redactPdf } from './redact'
import './styles.css'

startPdfTool('Redact and anonymise')

const SETTINGS_KEY = 'red-pen.redact.settings'
const LAYOUT_KEY = 'red-pen.redact.layout'

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const viewerEl = byId('viewer')
const viewFile = byId<HTMLSelectElement>('view-file')
const hint = byId('hint')
const drawButton = byId<HTMLButtonElement>('draw')
const boxEvery = byId<HTMLInputElement>('box-every')
const boxLabel = byId<HTMLInputElement>('box-label')
const deleteButton = byId<HTMLButtonElement>('delete')
const undoButton = byId<HTMLButtonElement>('undo')
const redoButton = byId<HTMLButtonElement>('redo')
const zoomLevel = byId('zoom-level')
const fileList = byId<HTMLOListElement>('file-list')
const fileCount = byId('file-count')
const renameInput = byId<HTMLInputElement>('rename')
const prefixInput = byId<HTMLInputElement>('prefix')
const startInput = byId<HTMLInputElement>('start')
const shuffleInput = byId<HTMLInputElement>('shuffle')
const reshuffleButton = byId<HTMLButtonElement>('reshuffle')
const dpiSelect = byId<HTMLSelectElement>('dpi')
const downloadButton = byId<HTMLButtonElement>('download')
const keyButton = byId<HTMLButtonElement>('download-key')
const progress = byId('progress')
const useSaved = byId<HTMLButtonElement>('use-saved')

const model = createLayoutModel()
let files: OpenedPdf[] = []
let viewIndex = 0
let viewer: Viewer | null = null
let layer: BoxesLayer | null = null
let fill: Fill = 'black'
let drawing = true
let order: number[] = []
let plan: NamedFile[] = []
let busy = false
/** Bumped for every file shown, so a slow load of an earlier file is dropped. */
let generation = 0

// ---- Settings ----------------------------------------------------------------------------

interface Settings {
  rename: boolean
  prefix: string
  start: number
  shuffle: boolean
  dpi: number
}

function loadSettings(): Settings {
  const fallback: Settings = { rename: true, prefix: DEFAULT_PREFIX, start: 1, shuffle: true, dpi: 200 }
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null
    if (!raw || typeof raw !== 'object') return fallback
    return {
      rename: typeof raw.rename === 'boolean' ? raw.rename : fallback.rename,
      prefix: typeof raw.prefix === 'string' ? raw.prefix.slice(0, 40) : fallback.prefix,
      start: typeof raw.start === 'number' && raw.start >= 0 ? Math.floor(raw.start) : fallback.start,
      shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : fallback.shuffle,
      dpi: [150, 200, 300].includes(raw.dpi as number) ? (raw.dpi as number) : fallback.dpi,
    }
  } catch {
    return fallback
  }
}

function readSettings(): Settings {
  const start = Number(startInput.value)
  return {
    rename: renameInput.checked,
    prefix: prefixInput.value,
    start: startInput.value.trim() === '' || !Number.isFinite(start) ? 1 : Math.max(0, Math.floor(start)),
    shuffle: shuffleInput.checked,
    dpi: Number(dpiSelect.value),
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(readSettings()))
  } catch {
    // Used for this visit only.
  }
}

function savedLayout(): Omit<RedactionBox, 'id'>[] {
  try {
    return parseLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'))
  } catch {
    return []
  }
}

function saveLayout(): void {
  const boxes = model.boxes()
  if (boxes.length === 0) return
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(boxes.map(({ id: _, ...b }) => b)))
  } catch {
    // Used for this visit only.
  }
}

{
  const s = loadSettings()
  renameInput.checked = s.rename
  prefixInput.value = s.prefix
  startInput.value = String(s.start)
  shuffleInput.checked = s.shuffle
  dpiSelect.value = String(s.dpi)
}

// ---- Messages ----------------------------------------------------------------------------

function showError(message: string): void {
  const target = files.length ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function updateHint(): void {
  const boxes = model.boxes().length
  if (drawing) {
    hint.textContent =
      boxes === 0
        ? 'Drag on a page to cover a name, or anything else that must not be seen.'
        : 'Drag to add another box. Select a box to move it, resize it from a corner, or repeat it on every page.'
  } else {
    hint.textContent = 'Scrolling. Tap a box to select it, or turn on Draw boxes to add one.'
  }
}

// ---- Names and the file list ---------------------------------------------------------------

function updatePlan(): void {
  const s = readSettings()
  plan = planNames(
    files.map((f) => f.name),
    { rename: s.rename, prefix: s.prefix, start: s.start, order },
  )
  reshuffleButton.disabled = !s.shuffle || files.length < 2
  fileCount.textContent = files.length > 1 ? `(${files.length})` : ''
  fileList.replaceChildren(
    ...files.map((f, i) => {
      const li = document.createElement('li')
      li.classList.toggle('viewing', i === viewIndex)
      const view = document.createElement('button')
      view.type = 'button'
      view.className = 'file-row'
      view.setAttribute('aria-current', String(i === viewIndex))
      const from = document.createElement('span')
      from.className = 'file-from'
      from.textContent = f.name
      const to = document.createElement('span')
      to.className = 'file-to'
      to.textContent = `${plan[i].output}, ${pages(f.pageCount)}`
      view.append(from, to)
      view.addEventListener('click', () => void showFile(i))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'icon'
      remove.textContent = '×'
      remove.setAttribute('aria-label', `Remove ${f.name}`)
      remove.addEventListener('click', () => removeFile(i))
      li.append(view, remove)
      return li
    }),
  )
  viewFile.replaceChildren(...files.map((f, i) => new Option(f.name, String(i))))
  viewFile.value = String(viewIndex)
  viewFile.hidden = files.length < 2
  downloadButton.textContent = files.length > 1 ? 'Download .zip' : 'Download redacted PDF'
  layer?.setLabel(plan[viewIndex]?.label ?? '')
  syncButtons()
}

function newOrder(): void {
  order = shuffleInput.checked ? shuffledOrder(files.length, secureRandom) : listOrder(files.length)
}

function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

// ---- Files and the viewer ------------------------------------------------------------------

async function addFiles(chosen: File[]): Promise<void> {
  clearErrors()
  const errors: string[] = []
  const added: OpenedPdf[] = []
  for (const file of chosen) {
    try {
      added.push(await openPdfFile(file))
    } catch (e) {
      errors.push(openErrorMessage(e, file.name))
    }
  }
  if (added.length) {
    const first = files.length === 0
    files = [...files, ...added]
    newOrder()
    if (first) {
      openScreen.hidden = true
      workScreen.hidden = false
      document.body.classList.add('working')
      const saved = savedLayout()
      useSaved.hidden = saved.length === 0 || model.boxes().length > 0
      useSaved.textContent = `Use the last box layout (${saved.length} ${saved.length === 1 ? 'box' : 'boxes'})`
      await showFile(0)
    } else {
      updatePlan()
    }
  }
  if (errors.length) showError(errors.join('\n'))
}

function removeFile(index: number): void {
  files = files.filter((_, i) => i !== index)
  if (files.length === 0) {
    generation++
    layer?.destroy()
    layer = null
    viewer?.destroy()
    viewer = null
    workScreen.hidden = true
    openScreen.hidden = false
    document.body.classList.remove('working')
    return
  }
  newOrder()
  if (index === viewIndex) void showFile(Math.min(index, files.length - 1))
  else {
    if (index < viewIndex) viewIndex--
    updatePlan()
  }
}

async function showFile(index: number): Promise<void> {
  const file = files[index]
  if (!file) return
  const mine = ++generation
  viewIndex = index
  updatePlan()
  const selected = layer?.selected() ?? null
  try {
    const doc = await loadPdf(file.bytes)
    if (mine !== generation) {
      void doc.loadingTask.destroy()
      return
    }
    layer?.destroy()
    viewer?.destroy()
    viewer = await createViewer(viewerEl, doc, { annotationMode: pdfjs.AnnotationMode.ENABLE })
    viewer.onScaleChange(updateZoomLabel)
    updateZoomLabel(viewer.scale)
    layer = attachBoxesLayer(viewer.pages, model, {
      drawing: () => drawing,
      fill: () => fill,
      onSelect: showSelected,
    })
    layer.setLabel(plan[viewIndex]?.label ?? '')
    if (selected !== null && model.get(selected)) layer.select(selected)
    viewerEl.dataset.file = String(index)
  } catch {
    showError(`"${file.name}" could not be shown.`)
  }
}

function updateZoomLabel(scale: number): void {
  zoomLevel.textContent = `${Math.round(((scale * 72) / 96) * 100)}%`
}

// ---- The selected box ----------------------------------------------------------------------

function showSelected(box: RedactionBox | null): void {
  boxEvery.disabled = !box
  boxLabel.disabled = !box
  deleteButton.disabled = !box
  boxEvery.checked = box?.everyPage ?? false
  boxLabel.checked = box?.label ?? false
  if (box) {
    setFill(box.fill, false)
    revealBoxTools()
  }
}

/** On a phone the toolbar scrolls sideways; bring the selected box's tools into view. */
function revealBoxTools(): void {
  const toolbar = byId('toolbar')
  if (toolbar.scrollWidth <= toolbar.clientWidth) return
  const tools = byId('box-tools')
  const left = tools.offsetLeft - 16
  if (left < toolbar.scrollLeft || tools.offsetLeft + tools.offsetWidth > toolbar.scrollLeft + toolbar.clientWidth)
    toolbar.scrollTo({ left, behavior: 'smooth' })
}

function selectedBox(): RedactionBox | undefined {
  const id = layer?.selected()
  return id == null ? undefined : model.get(id)
}

function setFill(next: Fill, applyToSelected = true): void {
  fill = next
  for (const b of document.querySelectorAll<HTMLButtonElement>('.fill'))
    b.setAttribute('aria-checked', String(b.dataset.fill === next))
  const box = selectedBox()
  if (applyToSelected && box && box.fill !== next) model.update(box.id, { fill: next })
}

function setDrawing(on: boolean): void {
  drawing = on
  drawButton.setAttribute('aria-pressed', String(on))
  viewerEl.dataset.drawing = String(on)
  updateHint()
}

function syncButtons(): void {
  undoButton.disabled = !model.canUndo()
  redoButton.disabled = !model.canRedo()
  const none = model.boxes().length === 0
  downloadButton.disabled = busy || none || files.length === 0
  keyButton.disabled = busy || files.length === 0
}

model.onChange(() => {
  layer?.render()
  const box = selectedBox()
  showSelected(box ?? null)
  syncButtons()
  updateHint()
  saveLayout()
  if (model.boxes().length > 0) useSaved.hidden = true
})

// ---- Downloads -----------------------------------------------------------------------------

async function download(): Promise<void> {
  clearErrors()
  const boxes = model.boxes()
  if (files.length === 0 || boxes.length === 0) return
  const s = readSettings()
  busy = true
  syncButtons()
  try {
    const outputs: Uint8Array[] = []
    for (const [i, f] of files.entries()) {
      const pagesToRedact = redactedPages(boxes, f.pageCount).length
      outputs.push(
        await redactPdf(f.bytes, boxes, {
          dpi: s.dpi,
          label: plan[i].label,
          title: plan[i].label,
          onPage: (p, count) => {
            const which = files.length > 1 ? `file ${i + 1} of ${files.length}, ` : ''
            progress.textContent = `Redacting ${which}page ${p + 1} of ${count} (${pagesToRedact} with boxes)…`
          },
        }),
      )
    }
    if (files.length === 1) downloadFile(outputs[0], plan[0].output, 'application/pdf')
    else {
      const zip = zipSync(Object.fromEntries(plan.map((p, i) => [p.output, outputs[i]])), { level: 0 })
      downloadFile(zip, s.rename ? 'anonymised-pdfs.zip' : 'redacted-pdfs.zip', 'application/zip')
    }
    progress.textContent = 'Done. Check the download before you share it.'
  } catch {
    progress.textContent = ''
    showError('The redacted files could not be made.')
  } finally {
    busy = false
    syncButtons()
  }
}

function downloadKey(): void {
  const csv = '﻿' + keyCsv(plan) // the mark tells Excel the file is UTF-8
  downloadFile(new TextEncoder().encode(csv), 'anonymised-key.csv', 'text/csv')
}

// ---- Wiring --------------------------------------------------------------------------------

drawButton.addEventListener('click', () => setDrawing(!drawing))
for (const b of document.querySelectorAll<HTMLButtonElement>('.fill'))
  b.addEventListener('click', () => setFill(b.dataset.fill as Fill))
boxEvery.addEventListener('change', () => {
  const box = selectedBox()
  if (box) model.update(box.id, { everyPage: boxEvery.checked })
})
boxLabel.addEventListener('change', () => {
  const box = selectedBox()
  if (box) model.update(box.id, { label: boxLabel.checked })
})
deleteButton.addEventListener('click', () => {
  const box = selectedBox()
  if (box) model.remove(box.id)
})
undoButton.addEventListener('click', () => model.undo())
redoButton.addEventListener('click', () => model.redo())
byId('zoom-in').addEventListener('click', () => viewer?.zoomIn())
byId('zoom-out').addEventListener('click', () => viewer?.zoomOut())
byId('zoom-fit').addEventListener('click', () => viewer?.fitToWidth())
viewFile.addEventListener('change', () => void showFile(Number(viewFile.value)))
for (const el of [renameInput, prefixInput, startInput, dpiSelect])
  el.addEventListener('input', () => {
    saveSettings()
    updatePlan()
  })
shuffleInput.addEventListener('change', () => {
  saveSettings()
  newOrder()
  updatePlan()
})
reshuffleButton.addEventListener('click', () => {
  newOrder()
  updatePlan()
})
downloadButton.addEventListener('click', () => void download())
keyButton.addEventListener('click', downloadKey)
useSaved.addEventListener('click', () => {
  model.replace(savedLayout())
  useSaved.hidden = true
})

document.addEventListener('keydown', (e) => {
  if (workScreen.hidden) return
  const target = e.target as HTMLElement
  if (target.matches('input[type="text"], input[type="number"], select')) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    model.undo()
  } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault()
    model.redo()
  } else if (e.key === 'Escape') {
    layer?.select(null)
  }
})

setDrawing(true)
syncButtons()

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: (chosen) => void addFiles(chosen),
})
