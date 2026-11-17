import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { withSuffix } from '../shared/pdf/file-names'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { createThumbnailRenderer, type ThumbnailRenderer } from '../shared/pdf/thumbnails'
import { impose } from './impose'
import {
  bookletSheets,
  describePair,
  loadSettings,
  sanitiseSettings,
  saveSettings,
  type Mode,
  type Settings,
} from './layout'
import './styles.css'

startPdfTool('Booklet printing')

/** How many output pages the preview draws. */
const PREVIEW_SHEETS = 4
/** Above this many folded sheets a booklet gets a warning. */
const THICK_SHEETS = 12

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const summary = byId('summary')
const form = byId<HTMLFormElement>('layout-form')
const sheetSelect = byId<HTMLSelectElement>('sheet')
const sheetHint = byId('sheet-hint')
const nupSelect = byId<HTMLSelectElement>('nup')
const repeatSelect = byId<HTMLSelectElement>('repeat')
const orientationSelect = byId<HTMLSelectElement>('orientation')
const flipSelect = byId<HTMLSelectElement>('flip')
const marginInput = byId<HTMLInputElement>('margin')
const gapInput = byId<HTMLInputElement>('gap')
const creepInput = byId<HTMLInputElement>('creep')
const backCover = byId<HTMLInputElement>('back-cover')
const borders = byId<HTMLInputElement>('borders')
const cutLines = byId<HTMLInputElement>('cut-lines')
const downloadButton = byId<HTMLButtonElement>('download')
const sheetCount = byId('sheet-count')
const printTip = byId('print-tip')
const thickWarning = byId('thick-warning')
const sheetList = byId<HTMLOListElement>('sheets')
const order = byId<HTMLDetailsElement>('order')
const orderList = byId<HTMLOListElement>('order-list')

let opened: OpenedPdf | null = null
let settings = loadSettings()
let thumbnails: ThumbnailRenderer | null = null
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined

function showError(message: string): void {
  const target = opened ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function numberOr(input: HTMLInputElement, fallback: number): number {
  const n = Number(input.value)
  return input.value.trim() === '' || !Number.isFinite(n) ? fallback : n
}

function readForm(): Settings {
  return sanitiseSettings({
    mode: (form.elements.namedItem('mode') as RadioNodeList).value,
    sheet: sheetSelect.value,
    flip: flipSelect.value,
    keepBackCover: backCover.checked,
    creepMm: numberOr(creepInput, 0),
    nup: Number(nupSelect.value),
    repeat: Number(repeatSelect.value),
    orientation: orientationSelect.value,
    marginMm: numberOr(marginInput, 0),
    gapMm: numberOr(gapInput, 0),
    borders: borders.checked,
    cutLines: cutLines.checked,
  })
}

function writeForm(s: Settings): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${s.mode}"]`)
  if (radio) radio.checked = true
  sheetSelect.value = s.sheet
  flipSelect.value = s.flip
  backCover.checked = s.keepBackCover
  creepInput.value = String(s.creepMm)
  nupSelect.value = String(s.nup)
  repeatSelect.value = String(s.repeat)
  orientationSelect.value = s.orientation
  marginInput.value = String(s.marginMm)
  gapInput.value = String(s.gapMm)
  borders.checked = s.borders
  cutLines.checked = s.cutLines
}

function showModeFields(mode: Mode): void {
  for (const el of form.querySelectorAll<HTMLElement>('[data-modes]')) {
    el.hidden = !el.dataset.modes!.split(' ').includes(mode)
  }
  if (mode === 'booklet') {
    sheetHint.textContent = settings.sheet === 'A4' ? 'A4 sheets make an A5 booklet.' : 'A3 sheets make an A4 booklet.'
  } else sheetHint.textContent = ''
}

function suffix(s: Settings): string {
  if (s.mode === 'booklet') return 'booklet'
  if (s.mode === 'nup') return `${s.nup}-up`
  return `${s.repeat}-copies`
}

function tipFor(s: Settings): string {
  if (s.mode === 'booklet') {
    const edge = s.flip === 'short' ? 'short' : 'long'
    return `Print double-sided, flipping on the ${edge} edge, at actual size (100%). Keep the sheets in order, fold the stack in half and staple along the fold.`
  }
  if (s.mode === 'repeat') return 'Print at actual size (100%), then cut along the dashed lines.'
  return 'Print at actual size (100%). Double-sided printing works too.'
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function renderOrder(pageCount: number): void {
  if (settings.mode !== 'booklet') {
    order.hidden = true
    return
  }
  order.hidden = false
  orderList.replaceChildren(
    ...bookletSheets(pageCount, settings.keepBackCover).map((sheet, i) => {
      const li = document.createElement('li')
      li.textContent = `Sheet ${i + 1}: front ${describePair(sheet.front)}, back ${describePair(sheet.back)}`
      return li
    }),
  )
}

async function refreshPreview(): Promise<void> {
  if (!opened) return
  const mine = ++generation
  const s = settings
  try {
    const { bytes, sheets } = await impose(opened.doc, s, PREVIEW_SHEETS)
    if (mine !== generation) return
    const renderer = await createThumbnailRenderer(bytes, 220)
    if (mine !== generation) {
      renderer.destroy()
      return
    }
    thumbnails?.destroy()
    thumbnails = renderer
    const pageCount = opened.pageCount
    if (s.mode === 'booklet') {
      const folded = sheets.length / 2
      const blanks = folded * 4 - pageCount
      sheetCount.textContent =
        `${pages(pageCount)} on ${plural(folded, 'sheet', 'sheets')} (printed on both sides)` +
        (blanks > 0 ? `, with ${plural(blanks, 'blank page', 'blank pages')} added at the end.` : '.')
      if (s.keepBackCover && blanks > 0)
        sheetCount.textContent = sheetCount.textContent.replace('at the end', 'before the back cover')
      thickWarning.hidden = folded <= THICK_SHEETS
    } else {
      sheetCount.textContent = `${pages(pageCount)} on ${plural(sheets.length, 'sheet', 'sheets')}.`
      thickWarning.hidden = true
    }
    printTip.textContent = tipFor(s)
    renderOrder(pageCount)
    const shown = sheets.slice(0, PREVIEW_SHEETS)
    sheetList.replaceChildren(
      ...shown.map((sheet, i) => {
        const li = document.createElement('li')
        li.className = 'sheet'
        const frame = document.createElement('div')
        frame.className = 'sheet-frame'
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        canvas.setAttribute('aria-hidden', 'true')
        frame.append(canvas)
        const label = document.createElement('span')
        label.className = 'sheet-label'
        label.textContent = sheet.label
        li.append(frame, label)
        renderer.observe(canvas, i)
        return li
      }),
    )
    downloadButton.disabled = false
  } catch {
    if (mine === generation) showError('The preview could not be made from this PDF.')
  }
}

function onChange(): void {
  settings = readForm()
  saveSettings(settings)
  showModeFields(settings.mode)
  clearTimeout(timer)
  timer = setTimeout(() => void refreshPreview(), 150)
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
  opened = next
  openScreen.hidden = true
  workScreen.hidden = false
  summary.textContent = `${next.name}, ${pages(next.pageCount)}`
  sheetList.replaceChildren()
  await refreshPreview()
}

async function download(): Promise<void> {
  clearErrors()
  if (!opened) return
  downloadButton.disabled = true
  try {
    const { bytes } = await impose(opened.doc, settings)
    downloadFile(bytes, withSuffix(opened.name, suffix(settings)), 'application/pdf')
  } catch {
    showError('The PDF could not be created.')
  } finally {
    downloadButton.disabled = false
  }
}

writeForm(settings)
showModeFields(settings.mode)
form.addEventListener('change', onChange)
form.addEventListener('input', onChange)
form.addEventListener('submit', (e) => e.preventDefault())
downloadButton.addEventListener('click', () => void download())

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: ([file]) => void openFile(file),
})
