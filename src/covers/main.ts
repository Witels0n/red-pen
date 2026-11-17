import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { ClassStorageError, listClasses, type ClassList } from '../shared/classes'
import { renderCoverSheetsPdf } from '../shared/omr'
import { downloadFile } from '../shared/pdf/download'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { byId } from '../shared/pdf/tool-page'
import { coverFileName, coverSpecs, type CoverChoices } from './covers'

registerOffline(mountSiteHeader({ toolName: 'Cover sheets' }))

const storageError = byId('storage-error')
const noClasses = byId('no-classes')
const coversForm = byId('covers-form')
const settings = byId<HTMLFormElement>('settings')
const classSelect = byId<HTMLSelectElement>('class-select')
const classSummary = byId('class-summary')
const testTitle = byId<HTMLInputElement>('test-title')
const subject = byId<HTMLInputElement>('subject')
const includeNames = byId<HTMLInputElement>('include-names')
const formError = byId('form-error')
const downloadButton = byId<HTMLButtonElement>('download')
const previewCaption = byId('preview-caption')
const canvas = byId<HTMLCanvasElement>('preview-canvas')

// Per-browser conveniences only: which class was used last and whether names are printed.
const CLASS_KEY = 'red-pen.covers.class'
const NAMES_KEY = 'red-pen.covers.names'

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage refused: the choice is simply not remembered.
  }
}

let classes: ClassList[] = []

function chosenClass(): ClassList | undefined {
  return classes.find((c) => c.id === classSelect.value)
}

function choices(): CoverChoices {
  return { title: testTitle.value, subject: subject.value, includeNames: includeNames.checked }
}

function showError(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

function learners(n: number): string {
  return `${n} ${n === 1 ? 'learner' : 'learners'}`
}

function updateSummary(): void {
  const list = chosenClass()
  const n = list?.learners.length ?? 0
  classSummary.textContent =
    n === 0 ? 'This class has no learners yet. Add them in Class lists.' : `${learners(n)}, one page each.`
  downloadButton.disabled = n === 0
  downloadButton.textContent = n === 0 ? 'Download Cover sheets' : `Download ${n} Cover ${n === 1 ? 'sheet' : 'sheets'}`
}

let previewGeneration = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined

/** Draws the first learner's Cover sheet. Later calls win, so typing never shows a stale page. */
async function renderPreview(): Promise<void> {
  const generation = ++previewGeneration
  const list = chosenClass()
  const first = list ? coverSpecs(list, choices())[0] : undefined
  if (!first) {
    canvas.hidden = true
    previewCaption.textContent = 'The preview appears once the class has learners.'
    return
  }
  try {
    const bytes = await renderCoverSheetsPdf([first])
    const pdf = await loadPdf(bytes)
    try {
      const page = await pdf.getPage(1)
      if (generation !== previewGeneration) return
      const base = page.getViewport({ scale: 1 })
      const cssWidth = Math.max(200, canvas.parentElement!.clientWidth || 360)
      const ratio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
      const next = document.createElement('canvas')
      next.width = Math.round(viewport.width)
      next.height = Math.round(viewport.height)
      await page.render({ canvas: next, viewport }).promise
      if (generation !== previewGeneration) return
      canvas.width = next.width
      canvas.height = next.height
      canvas.getContext('2d')!.drawImage(next, 0, 0)
      canvas.hidden = false
      canvas.dataset.rendered = 'true'
      previewCaption.textContent = `First page: Learner ID ${first.learnerId}${first.learnerName ? `, ${first.learnerName}` : ''}.`
    } finally {
      await pdf.loadingTask.destroy()
    }
  } catch {
    if (generation !== previewGeneration) return
    canvas.hidden = true
    previewCaption.textContent = 'The preview could not be drawn. The download still works.'
  }
}

function schedulePreview(delay = 250): void {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderPreview(), delay)
}

function changed(): void {
  showError(formError, '')
  updateSummary()
  schedulePreview()
}

async function download(): Promise<void> {
  const list = chosenClass()
  if (!list || list.learners.length === 0) return
  showError(formError, '')
  downloadButton.disabled = true
  try {
    const pdf = await renderCoverSheetsPdf(coverSpecs(list, choices()))
    downloadFile(pdf, coverFileName(list), 'application/pdf')
  } catch (error) {
    showError(
      formError,
      error instanceof Error && error.message
        ? `The Cover sheets could not be made. ${error.message}`
        : 'The Cover sheets could not be made.',
    )
  } finally {
    updateSummary()
  }
}

async function start(): Promise<void> {
  try {
    classes = await listClasses()
  } catch (error) {
    const reason = error instanceof ClassStorageError ? `${error.message} ` : ''
    showError(
      storageError,
      `${reason}Cover sheets are printed from a saved Class list, which this browser cannot read.`,
    )
    return
  }
  if (classes.length === 0) {
    noClasses.hidden = false
    return
  }
  classSelect.replaceChildren(...classes.map((c) => new Option(`${c.name} (${learners(c.learners.length)})`, c.id)))
  const last = remembered(CLASS_KEY)
  if (last && classes.some((c) => c.id === last)) classSelect.value = last
  includeNames.checked = remembered(NAMES_KEY) !== 'off'
  coversForm.hidden = false
  updateSummary()
  schedulePreview(0)
}

classSelect.addEventListener('change', () => {
  remember(CLASS_KEY, classSelect.value)
  changed()
})
includeNames.addEventListener('change', () => {
  remember(NAMES_KEY, includeNames.checked ? 'on' : 'off')
  changed()
})
testTitle.addEventListener('input', changed)
subject.addEventListener('input', changed)
settings.addEventListener('submit', (e) => {
  e.preventDefault()
  void download()
})
let width = window.innerWidth
window.addEventListener('resize', () => {
  if (window.innerWidth === width) return
  width = window.innerWidth
  schedulePreview()
})

void start()
