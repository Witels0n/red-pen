import { listClasses, type ClassList } from '../shared/classes'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { safeFileBase } from '../shared/pdf/file-names'
import { moveItem } from '../shared/pdf/list-order'
import { byId, pages as pagesLabel, startPdfTool } from '../shared/pdf/tool-page'
import { describeRange } from '../split/ranges'
import { zipFileName } from '../split/plan'
import { createEditor } from './editor'
import { createScanEngine, PhotoError } from './engine'
import { addTurn, FULL_QUAD, scaleQuad, straightenedSize, type Quad } from './geometry'
import { describeBytes, estimatePdfBytes, MARGINS, PAGE_SIZES, type PageSize } from './layout'
import { buildPdf, zipFiles, type PageJpeg } from './pdf'
import { SOURCE_SIDE, THUMB_SIDE, type PageLook } from './pipeline'
import { attachPointerSort } from './pointer-sort'
import { loadSettings, saveSettings } from './settings'
import { everyNStarts, learnerLabel, planScanSplit, type ScanPart } from './split-plan'
import './styles.css'

startPdfTool('Photos to PDF')

/** One page: a photo and how to finish it. */
interface ScanPage {
  id: number
  fileName: string
  source: Blob
  sourceWidth: number
  sourceHeight: number
  preview: Blob
  detected: Quad | null
  look: PageLook
  /** The first page of a learner's work (split mode). */
  first: boolean
  /** The learner's name, kept on their first page so it moves with it. */
  learnerName: string
  thumb: HTMLCanvasElement
  rendered: { key: string; page: PageJpeg } | null
}

const engine = createScanEngine()
const editor = createEditor(engine)
const settings = loadSettings()

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const progress = byId('progress')
const summary = byId('summary')
const grid = byId<HTMLOListElement>('page-grid')
const form = byId<HTMLFormElement>('output-form')
const fileName = byId<HTMLInputElement>('file-name')
const pageSize = byId<HTMLSelectElement>('page-size')
const margins = byId<HTMLSelectElement>('margins')
const quality = byId<HTMLInputElement>('quality')
const qualityValue = byId<HTMLOutputElement>('quality-value')
const estimate = byId('estimate')
const splitOptions = byId('split-options')
const everySize = byId<HTMLInputElement>('every-size')
const classField = byId('class-field')
const classSelect = byId<HTMLSelectElement>('class-select')
const fillNames = byId<HTMLButtonElement>('fill-names')
const noClasses = byId('no-classes')
const partsList = byId<HTMLOListElement>('parts')
const learnerNames = byId<HTMLDataListElement>('learner-names')
const downloadButton = byId<HTMLButtonElement>('download')

let pages: ScanPage[] = []
let nextId = 1
let adding = 0
let busy = false
let classes: ClassList[] = []

pageSize.append(...PAGE_SIZES.map((s) => new Option(s.label, s.value)))
margins.append(...MARGINS.map((m) => new Option(m.label, String(m.value))))
pageSize.value = settings.pageSize
margins.value = String(settings.marginMm)
quality.value = String(settings.quality)

function splitMode(): boolean {
  return (form.elements.namedItem('mode') as RadioNodeList).value === 'split'
}

function showError(message: string): void {
  const target = pages.length > 0 ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function baseName(): string {
  return safeFileBase(fileName.value, 'Scan')
}

// Pages

function iconButton(action: string, label: string, text: string, disabled = false): HTMLButtonElement {
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

function learnerNumbers(): Map<number, number> {
  const out = new Map<number, number>()
  let n = 0
  pages.forEach((p, i) => {
    if (i === 0 || p.first) out.set(p.id, ++n)
  })
  return out
}

function renderGrid(): void {
  const split = splitMode()
  const learners = learnerNumbers()
  grid.classList.toggle('split', split)
  grid.replaceChildren(
    ...pages.map((page, i) => {
      const n = i + 1
      const li = document.createElement('li')
      li.className = 'page-card'
      li.dataset.id = String(page.id)
      const starts = split && learners.has(page.id)
      li.classList.toggle('starts', starts)

      const thumb = document.createElement('button')
      thumb.type = 'button'
      thumb.className = 'thumb'
      thumb.dataset.action = 'edit'
      thumb.setAttribute('aria-label', `Edit page ${n}`)
      thumb.append(page.thumb)
      if (starts) {
        const badge = document.createElement('span')
        badge.className = 'learner-badge'
        badge.textContent = page.learnerName.trim() || `Learner ${learners.get(page.id)}`
        thumb.append(badge)
      }

      const caption = document.createElement('p')
      caption.className = 'page-caption'
      const handle = document.createElement('span')
      handle.className = 'drag-handle'
      handle.title = 'Drag to reorder'
      handle.setAttribute('aria-hidden', 'true')
      handle.textContent = '⠿'
      const label = document.createElement('span')
      label.className = 'page-label'
      label.textContent = `Page ${n}`
      caption.append(handle, label)

      const row1 = document.createElement('div')
      row1.className = 'page-actions'
      row1.append(
        iconButton('earlier', `Move page ${n} earlier`, '←', i === 0),
        iconButton('later', `Move page ${n} later`, '→', i === pages.length - 1),
        iconButton('turn', `Turn page ${n}`, '↻'),
      )
      const row2 = document.createElement('div')
      row2.className = 'page-actions'
      row2.append(iconButton('duplicate', `Duplicate page ${n}`, '⧉'), iconButton('delete', `Delete page ${n}`, '✕'))

      li.append(thumb, caption, row1, row2)
      if (split) {
        const first = document.createElement('button')
        first.type = 'button'
        first.className = 'first-toggle'
        first.dataset.action = 'first'
        first.setAttribute('aria-pressed', String(starts))
        first.textContent = 'First page of a learner'
        first.disabled = i === 0
        if (i === 0) first.title = 'Page 1 always starts the first learner.'
        li.append(first)
      }
      return li
    }),
  )
}

function render(): void {
  const count = pages.length
  openScreen.hidden = count > 0 || adding > 0
  workScreen.hidden = !openScreen.hidden
  summary.textContent = pagesLabel(count)
  const split = splitMode()
  splitOptions.hidden = !split
  downloadButton.textContent = split ? 'Download .zip' : 'Download PDF'
  downloadButton.disabled = count === 0 || busy || adding > 0
  renderGrid()
  if (split) renderParts()
  scheduleEstimate()
}

async function drawThumb(page: ScanPage): Promise<void> {
  try {
    const img = await engine.thumb(page.preview, page.look, THUMB_SIDE)
    page.thumb.width = img.width
    page.thumb.height = img.height
    page.thumb
      .getContext('2d')
      ?.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    page.thumb.dataset.rendered = 'true'
  } catch {
    page.thumb.classList.add('thumbnail-failed')
  }
}

function newCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  c.setAttribute('role', 'img')
  c.setAttribute('aria-label', 'Page preview')
  return c
}

async function addPhotos(files: File[]): Promise<void> {
  clearErrors()
  const photos = files.filter(
    (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name),
  )
  const skipped = files.filter((f) => !photos.includes(f))
  const problems: string[] = skipped.map((f) => `"${f.name}" is not a photo.`)
  adding += photos.length
  render()
  let done = 0
  for (const file of photos) {
    progress.textContent =
      photos.length === 1 ? 'Adding the photo...' : `Adding photo ${done + 1} of ${photos.length}...`
    try {
      const photo = await engine.ingest(file)
      const page: ScanPage = {
        id: nextId++,
        fileName: file.name,
        source: photo.source,
        sourceWidth: photo.sourceWidth,
        sourceHeight: photo.sourceHeight,
        preview: photo.preview,
        detected: photo.corners,
        look: { corners: photo.corners ?? FULL_QUAD, turns: 0, filter: settings.filter },
        first: false,
        learnerName: '',
        thumb: newCanvas(),
        rendered: null,
      }
      await drawThumb(page)
      pages.push(page)
    } catch (e) {
      problems.push(e instanceof PhotoError ? e.message : `"${file.name}" could not be added.`)
    }
    done++
    adding--
    render()
  }
  progress.textContent = photos.length ? `${pagesLabel(pages.length)} in the scan.` : ''
  if (problems.length) showError(problems.join('\n'))
}

function indexOfCard(target: Element): number {
  const card = target.closest<HTMLElement>('.page-card')
  return card ? pages.findIndex((p) => String(p.id) === card.dataset.id) : -1
}

function focusAfterRender(id: number | undefined, action: string): void {
  const card = grid.querySelector<HTMLElement>(`[data-id="${id}"]`)
  const preferred = card?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
  const fallback = card?.querySelector<HTMLButtonElement>('button:not(:disabled)')
  ;(preferred && !preferred.disabled ? preferred : (fallback ?? downloadButton)).focus()
}

async function editPage(index: number): Promise<void> {
  const page = pages[index]
  const result = await editor.open({
    title: `Page ${index + 1}`,
    preview: page.preview,
    look: page.look,
    detected: page.detected,
  })
  if (!result) {
    focusAfterRender(page.id, 'edit')
    return
  }
  page.look = result.look
  page.rendered = null
  settings.filter = result.look.filter
  saveSettings(settings)
  const changed = [page]
  if (result.filterForAll) {
    for (const p of pages) {
      if (p === page || p.look.filter === result.look.filter) continue
      p.look = { ...p.look, filter: result.look.filter }
      p.rendered = null
      changed.push(p)
    }
  }
  render()
  focusAfterRender(page.id, 'edit')
  for (const p of changed) await drawThumb(p)
  scheduleEstimate()
}

function duplicate(page: ScanPage): ScanPage {
  const thumb = newCanvas()
  thumb.width = page.thumb.width
  thumb.height = page.thumb.height
  thumb.getContext('2d')?.drawImage(page.thumb, 0, 0)
  thumb.dataset.rendered = page.thumb.dataset.rendered ?? ''
  return { ...page, id: nextId++, look: { ...page.look }, first: false, learnerName: '', thumb }
}

grid.addEventListener('click', (e) => {
  const target = (e.target as Element).closest<HTMLButtonElement>('button[data-action]')
  if (!target) return
  const index = indexOfCard(target)
  if (index < 0) return
  const page = pages[index]
  const action = target.dataset.action!
  switch (action) {
    case 'edit':
      void editPage(index)
      return
    case 'earlier':
    case 'later':
      pages = moveItem(pages, index, action === 'earlier' ? index - 1 : index + 1)
      break
    case 'turn':
      page.look = { ...page.look, turns: addTurn(page.look.turns, 1) }
      page.rendered = null
      void drawThumb(page)
      break
    case 'duplicate':
      pages.splice(index + 1, 0, duplicate(page))
      break
    case 'delete':
      pages.splice(index, 1)
      render()
      focusAfterRender(pages[Math.min(index, pages.length - 1)]?.id, 'delete')
      return
    case 'first':
      page.first = !page.first
      break
  }
  render()
  focusAfterRender(page.id, action)
})

attachPointerSort(grid, '.page-card', '.drag-handle', (from, to) => {
  pages = moveItem(pages, from, to)
  render()
})

// Split mode

function plannedParts(): ScanPart[] {
  return planScanSplit(
    pages.map((p) => ({ first: p.first, name: p.learnerName })),
    `${baseName()}.pdf`,
  )
}

function renderParts(): void {
  const parts = plannedParts()
  partsList.replaceChildren(
    ...parts.map((part, i) => {
      const li = document.createElement('li')
      li.className = 'part'
      const head = document.createElement('div')
      head.className = 'part-head'
      const range = document.createElement('span')
      range.className = 'part-range'
      range.textContent = describeRange(part)
      const file = document.createElement('span')
      file.className = 'part-name'
      file.textContent = part.fileName
      head.append(range, file)
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'part-learner'
      input.value = pages[part.firstIndex].learnerName
      input.placeholder = 'Learner name (optional)'
      input.autocomplete = 'off'
      input.setAttribute('list', 'learner-names')
      input.setAttribute('aria-label', `Name of learner ${i + 1}`)
      input.dataset.page = String(pages[part.firstIndex].id)
      li.append(head, input)
      return li
    }),
  )
}

/** Updates the file names after a name is typed, without redrawing the inputs (keeps the keyboard open). */
function refreshPartNames(): void {
  const parts = plannedParts()
  partsList.querySelectorAll('.part-name').forEach((el, i) => (el.textContent = parts[i]?.fileName ?? ''))
  renderGrid()
}

partsList.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  const page = pages.find((p) => String(p.id) === input.dataset.page)
  if (!page) return
  page.learnerName = input.value
  refreshPartNames()
})

byId('apply-every').addEventListener('click', () => {
  const starts = everyNStarts(pages.length, Number(everySize.value))
  if (!starts) {
    showError('Enter a whole number of pages per learner, 1 or more.')
    return
  }
  clearErrors()
  const set = new Set(starts)
  pages.forEach((p, i) => (p.first = set.has(i)))
  render()
})

async function loadClasses(): Promise<void> {
  try {
    classes = await listClasses()
  } catch {
    classes = [] // Storage refused (a private window): names can still be typed.
  }
  classSelect.replaceChildren(
    new Option('Choose a class', ''),
    ...classes.map((c) => new Option(`${c.name} (${c.learners.length})`, c.id)),
  )
  classField.hidden = classes.length === 0
  fillNames.hidden = classes.length === 0
  noClasses.hidden = classes.length > 0
  updateLearnerNames()
}

function chosenClass(): ClassList | undefined {
  return classes.find((c) => c.id === classSelect.value)
}

function updateLearnerNames(): void {
  const list = chosenClass()
  learnerNames.replaceChildren(...(list?.learners ?? []).map((l) => new Option(learnerLabel(l))))
  fillNames.disabled = !list
}

classSelect.addEventListener('change', updateLearnerNames)
fillNames.addEventListener('click', () => {
  const list = chosenClass()
  if (!list) return
  plannedParts().forEach((part, i) => {
    const learner = list.learners[i]
    pages[part.firstIndex].learnerName = learner ? learnerLabel(learner) : ''
  })
  render()
})

// Size estimate and settings

let estimateTimer = 0
let estimateVersion = 0

function scheduleEstimate(): void {
  clearTimeout(estimateTimer)
  qualityValue.textContent = `${quality.value}%`
  if (pages.length === 0) {
    estimate.textContent = ''
    return
  }
  estimateTimer = window.setTimeout(() => void updateEstimate(), 400)
}

function fullPixels(page: ScanPage): number {
  const s = straightenedSize(scaleQuad(page.look.corners, page.sourceWidth, page.sourceHeight), SOURCE_SIDE)
  return s.width * s.height
}

async function updateEstimate(): Promise<void> {
  const version = ++estimateVersion
  const q = Number(quality.value) / 100
  const picks = [...new Set([0, Math.floor(pages.length / 2), pages.length - 1])].map((i) => pages[i])
  const samples = []
  for (const page of picks) {
    if (!page) continue
    try {
      const s = await engine.sample(page.preview, page.look, q)
      samples.push({ ...s, fullPixels: fullPixels(page) })
    } catch {
      // An estimate from the other pages is good enough.
    }
    if (version !== estimateVersion) return
  }
  const bytes = estimatePdfBytes(samples, pages.length)
  estimate.textContent = bytes ? `PDF ${describeBytes(bytes)}` : ''
}

function rememberSettings(): void {
  settings.pageSize = pageSize.value as PageSize
  settings.marginMm = Number(margins.value)
  settings.quality = Number(quality.value)
  saveSettings(settings)
}

quality.addEventListener('input', () => {
  rememberSettings()
  scheduleEstimate()
})
pageSize.addEventListener('change', rememberSettings)
margins.addEventListener('change', rememberSettings)
form.addEventListener('change', (e) => {
  if ((e.target as HTMLInputElement).name === 'mode') render()
})
fileName.addEventListener('input', () => {
  if (splitMode()) refreshPartNames()
})

// Download

function lookKey(page: ScanPage, q: number): string {
  return JSON.stringify([page.look, q])
}

/** Every page finished at full size, one at a time; finished pages are kept until they change. */
async function renderAll(): Promise<PageJpeg[]> {
  const q = Number(quality.value) / 100
  const out: PageJpeg[] = []
  for (const [i, page] of pages.entries()) {
    progress.textContent = `Preparing page ${i + 1} of ${pages.length}...`
    const key = lookKey(page, q)
    if (page.rendered?.key !== key) {
      const r = await engine.render(page.source, page.look, q)
      page.rendered = {
        key,
        page: { jpeg: new Uint8Array(await r.jpeg.arrayBuffer()), width: r.width, height: r.height },
      }
    }
    out.push(page.rendered.page)
  }
  return out
}

async function download(): Promise<void> {
  clearErrors()
  if (pages.length === 0 || busy) return
  busy = true
  render()
  const options = { pageSize: pageSize.value as PageSize, marginMm: Number(margins.value) }
  try {
    const finished = await renderAll()
    progress.textContent = 'Writing the PDF...'
    if (splitMode()) {
      const parts = plannedParts()
      const files = new Map<string, Uint8Array>()
      for (const part of parts) {
        const title = part.name || part.fileName.replace(/\.pdf$/, '')
        files.set(part.fileName, await buildPdf(finished.slice(part.start - 1, part.end), { ...options, title }))
      }
      downloadFile(zipFiles(files), zipFileName(`${baseName()}.pdf`), 'application/zip')
      progress.textContent = `${parts.length} ${parts.length === 1 ? 'PDF' : 'PDFs'} downloaded in a .zip.`
    } else {
      const bytes = await buildPdf(finished, { ...options, title: baseName() })
      downloadFile(bytes, `${baseName()}.pdf`, 'application/pdf')
      progress.textContent = `PDF downloaded, ${describeBytes(bytes.length).replace('about ', '')}.`
    }
  } catch {
    progress.textContent = ''
    showError('The PDF could not be created. Try fewer pages, or a lower quality.')
  } finally {
    busy = false
    render()
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  void download()
})

byId('start-over').addEventListener('click', () => {
  if (pages.length > 0 && !confirm('Remove every page and start again?')) return
  pages = []
  clearErrors()
  progress.textContent = ''
  render()
})

// The photo picker also takes photos dropped anywhere on the page; the camera takes one photo at a time.
attachFileIntake({
  input: byId<HTMLInputElement>('photo-input'),
  highlight: document.body,
  onFiles: (files) => void addPhotos(files),
})
const camera = byId<HTMLInputElement>('camera-input')
camera.addEventListener('change', () => {
  const files = [...(camera.files ?? [])]
  camera.value = ''
  if (files.length) void addPhotos(files)
})

void loadClasses()
render()
