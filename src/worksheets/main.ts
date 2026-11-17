import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { downloadFile } from '../shared/pdf/download'
import { safeFileBase } from '../shared/pdf/file-names'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { byId } from '../shared/pdf/tool-page'
import { generateWorksheet, type GeneratedWorksheet } from './core/generate'
import {
  ACTIVITY_NAMES,
  ACTIVITY_TYPES,
  duplicateWorksheet,
  newActivity,
  newWorksheet,
  type Activity,
  type ActivityType,
  type Worksheet,
} from './core/model'
import { activityCard, type ActivityCard } from './editors'
import { renderWorksheetPdf, type PrintPart } from './pdf/render'
import { loadOpenId, loadWorksheets, saveOpenId, saveWorksheets } from './storage'

registerOffline(mountSiteHeader({ toolName: 'Worksheet maker' }))

const select = byId<HTMLSelectElement>('worksheet-select')
const newButton = byId<HTMLButtonElement>('new-worksheet')
const duplicateButton = byId<HTMLButtonElement>('duplicate-worksheet')
const deleteButton = byId<HTMLButtonElement>('delete-worksheet')
const saveStatus = byId('save-status')
const titleInput = byId<HTMLInputElement>('sheet-title')
const instructionsInput = byId<HTMLTextAreaElement>('sheet-instructions')
const learnerLines = byId<HTMLInputElement>('sheet-learner-lines')
const totalEl = byId('sheet-total')
const totalUnit = byId('sheet-total-unit')
const activitiesEl = byId('activities')
const addType = byId<HTMLSelectElement>('add-type')
const addButton = byId<HTMLButtonElement>('add-activity')
const printPart = byId<HTMLSelectElement>('print-part')
const downloadButton = byId<HTMLButtonElement>('download')
const previewStatus = byId('preview-status')
const previewPages = byId('preview-pages')
const downloadError = byId('download-error')

const PART_KEY = 'red-pen.worksheets.print'

addType.append(...ACTIVITY_TYPES.map((t) => new Option(ACTIVITY_NAMES[t], t)))

let worksheets: Worksheet[] = loadWorksheets()
let current: Worksheet
let cards = new Map<string, ActivityCard>()

function open(w: Worksheet): void {
  current = w
  saveOpenId(w.id)
  titleInput.value = w.title
  instructionsInput.value = w.instructions
  learnerLines.checked = w.learnerLines
  rebuildCards()
  refreshList()
  refresh()
}

function refreshList(): void {
  const label = (w: Worksheet) => w.title.trim() || 'Untitled worksheet'
  select.replaceChildren(...worksheets.map((w) => new Option(label(w), w.id)))
  select.value = current.id
  deleteButton.disabled = false
}

function rebuildCards(): void {
  cards = new Map()
  activitiesEl.replaceChildren(
    ...current.activities.map((a) => {
      const card = activityCard(a, {
        changed: () => edited(),
        move: (x, delta) => moveActivity(x, delta),
        remove: (x) => removeActivity(x),
      })
      cards.set(a.id, card)
      return card.element
    }),
  )
}

let generated: GeneratedWorksheet

/** Updates marks, warnings and numbering from the current worksheet. */
function refresh(): void {
  generated = generateWorksheet(current)
  generated.activities.forEach((g, i) => cards.get(g.id)?.update(g, i, generated.activities.length))
  totalEl.textContent = String(generated.total)
  totalUnit.textContent = generated.total === 1 ? 'mark' : 'marks'
  schedulePreview()
}

// ---------- Saving ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveNow(): void {
  clearTimeout(saveTimer)
  const result = saveWorksheets(worksheets)
  saveStatus.classList.toggle('problem', result !== 'saved')
  saveStatus.textContent =
    result === 'saved'
      ? 'Saved on this device.'
      : result === 'full'
        ? "Not saved: this browser's storage is full. Pictures take the most space; remove one or delete an old worksheet. The download still works."
        : 'Not saved: this browser is not letting Red Pen keep worksheets (private browsing can do this). The download still works.'
}

function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 400)
}

function edited(): void {
  current.updatedAt = Date.now()
  // The most recently changed worksheet goes first in the list.
  worksheets = [current, ...worksheets.filter((w) => w !== current)]
  scheduleSave()
  refresh()
}

window.addEventListener('pagehide', () => {
  if (saveTimer !== undefined) saveNow()
})

// ---------- Worksheet fields ----------

titleInput.addEventListener('input', () => {
  current.title = titleInput.value
  edited()
  const option = select.selectedOptions[0]
  if (option) option.textContent = current.title.trim() || 'Untitled worksheet'
})
instructionsInput.addEventListener('input', () => {
  current.instructions = instructionsInput.value
  edited()
})
learnerLines.addEventListener('change', () => {
  current.learnerLines = learnerLines.checked
  edited()
})

// ---------- Activities ----------

addButton.addEventListener('click', () => {
  const a = newActivity(addType.value as ActivityType)
  current.activities.push(a)
  rebuildCards()
  edited()
  const card = cards.get(a.id)?.element
  card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  card?.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true })
})

function moveActivity(a: Activity, delta: -1 | 1): void {
  const i = current.activities.indexOf(a)
  const j = i + delta
  if (i < 0 || j < 0 || j >= current.activities.length) return
  ;[current.activities[i], current.activities[j]] = [current.activities[j], current.activities[i]]
  rebuildCards()
  edited()
  cards
    .get(a.id)
    ?.element.querySelector<HTMLButtonElement>(delta < 0 ? '.activity-tools .icon' : '.activity-tools .icon + .icon')
    ?.focus()
}

function removeActivity(a: Activity): void {
  if (!confirm(`Remove "${a.heading.trim() || ACTIVITY_NAMES[a.type]}" from this worksheet?`)) return
  current.activities = current.activities.filter((x) => x !== a)
  rebuildCards()
  edited()
}

// ---------- Saved worksheets ----------

select.addEventListener('change', () => {
  const w = worksheets.find((x) => x.id === select.value)
  if (w) open(w)
})

newButton.addEventListener('click', () => {
  const w = newWorksheet()
  w.title = ''
  w.instructions = ''
  w.activities = []
  worksheets = [w, ...worksheets]
  open(w)
  saveNow()
  titleInput.focus()
})

duplicateButton.addEventListener('click', () => {
  const copy = duplicateWorksheet(current)
  worksheets = [copy, ...worksheets]
  open(copy)
  saveNow()
})

deleteButton.addEventListener('click', () => {
  const name = current.title.trim() || 'Untitled worksheet'
  if (!confirm(`Delete "${name}" from this device? This cannot be undone.`)) return
  worksheets = worksheets.filter((w) => w !== current)
  if (worksheets.length === 0) worksheets = [newWorksheet()]
  open(worksheets[0])
  saveNow()
})

// ---------- Preview and download ----------

function part(): PrintPart {
  return printPart.value as PrintPart
}

try {
  const saved = localStorage.getItem(PART_KEY)
  if (saved === 'both' || saved === 'worksheet' || saved === 'memo') printPart.value = saved
} catch {
  // Storage blocked: start with both.
}

printPart.addEventListener('change', () => {
  try {
    localStorage.setItem(PART_KEY, printPart.value)
  } catch {
    // Not remembered.
  }
  schedulePreview(0)
})

let previewGeneration = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined

function schedulePreview(delay = 450): void {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderPreview(), delay)
}

/** Draws every page of the PDF. Later calls win, so typing never leaves a stale preview. */
async function renderPreview(): Promise<void> {
  const generation = ++previewGeneration
  previewStatus.textContent = 'Updating the preview...'
  try {
    const bytes = await renderWorksheetPdf(generated, part())
    if (generation !== previewGeneration) return
    const pdf = await loadPdf(bytes)
    try {
      const canvases: HTMLCanvasElement[] = []
      const cssWidth = Math.max(240, previewPages.clientWidth || 360)
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n)
        if (generation !== previewGeneration) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`)
        await page.render({ canvas, viewport }).promise
        canvases.push(canvas)
      }
      if (generation !== previewGeneration) return
      previewPages.replaceChildren(...canvases)
      previewPages.dataset.pages = String(canvases.length)
      previewStatus.textContent = `${canvases.length} ${canvases.length === 1 ? 'page' : 'pages'}.`
    } finally {
      await pdf.loadingTask.destroy()
    }
  } catch {
    if (generation !== previewGeneration) return
    previewStatus.textContent = 'The preview could not be drawn. The download may still work.'
  }
}

function fileName(): string {
  const base = safeFileBase(current.title, 'worksheet')
  return part() === 'memo' ? `${base} memo.pdf` : `${base}.pdf`
}

downloadButton.addEventListener('click', async () => {
  downloadError.hidden = true
  downloadButton.disabled = true
  try {
    const bytes = await renderWorksheetPdf(generateWorksheet(current), part())
    downloadFile(bytes, fileName(), 'application/pdf')
  } catch (error) {
    downloadError.textContent =
      error instanceof Error && error.message
        ? `The PDF could not be made. ${error.message}`
        : 'The PDF could not be made.'
    downloadError.hidden = false
  } finally {
    downloadButton.disabled = false
  }
})

let width = window.innerWidth
window.addEventListener('resize', () => {
  if (window.innerWidth === width) return
  width = window.innerWidth
  schedulePreview()
})

// ---------- Start ----------

if (worksheets.length === 0) {
  // First visit: an example worksheet, so the preview shows what the tool makes.
  worksheets = [newWorksheet()]
  saveWorksheets(worksheets)
}
const openId = loadOpenId()
open(worksheets.find((w) => w.id === openId) ?? worksheets[0])
