import { zipSync } from 'fflate'
import { formatDate, type DateStyle } from '../shared/dates'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { uniqueNames, withSuffix } from '../shared/pdf/file-names'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import {
  DEFAULT_SETTINGS,
  sanitiseSettings,
  selectPages,
  SLOTS,
  type Align,
  type FontName,
  type NumberFormat,
  type PageScope,
  type Slot,
  type StampSettings,
  type WatermarkSize,
} from './layout'
import { LogoError, loadSavedLogo, logoDataUrl, readLogo, saveLogo } from './logo'
import { previewPage, stampPdf, type Logo } from './stamp'
import './styles.css'

startPdfTool('Stamp and number')

const SETTINGS_KEY = 'red-pen.stamp.settings'

const SLOT_LABELS: Record<Slot, string> = {
  'top-left': 'Top left',
  'top-centre': 'Top centre',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-centre': 'Bottom centre',
  'bottom-right': 'Bottom right',
}

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const summary = byId('summary')
const form = byId<HTMLFormElement>('stamp-form')
const fileList = byId<HTMLUListElement>('file-list')
const downloadButton = byId<HTMLButtonElement>('download')
const rangeInput = byId<HTMLInputElement>('range')
const rangeError = byId('range-error')
const previewCanvas = byId<HTMLCanvasElement>('preview')
const previewFile = byId<HTMLSelectElement>('preview-file')
const previewPageLabel = byId('preview-page')
const previewNote = byId('preview-note')
const prevPage = byId<HTMLButtonElement>('prev-page')
const nextPage = byId<HTMLButtonElement>('next-page')
const logoPreview = byId<HTMLImageElement>('logo-preview')
const logoChoose = byId('logo-choose')
const logoRemove = byId<HTMLButtonElement>('logo-remove')

const input = <T extends HTMLElement = HTMLInputElement>(id: string) => byId<T>(id)
const controls = {
  wmOn: input('wm-on'),
  wmPreset: input<HTMLSelectElement>('wm-preset'),
  wmCustom: input('wm-custom'),
  wmCustomField: byId('wm-custom-field'),
  wmDirection: input<HTMLSelectElement>('wm-direction'),
  wmSize: input<HTMLSelectElement>('wm-size'),
  wmColour: input('wm-colour'),
  wmOpacity: input('wm-opacity'),
  wmOpacityValue: byId<HTMLOutputElement>('wm-opacity-value'),
  numOn: input('num-on'),
  numFormat: input<HTMLSelectElement>('num-format'),
  numSlot: input<HTMLSelectElement>('num-slot'),
  numStart: input('num-start'),
  headerText: input('header-text'),
  headerAlign: input<HTMLSelectElement>('header-align'),
  footerText: input('footer-text'),
  footerAlign: input<HTMLSelectElement>('footer-align'),
  dateSlot: input<HTMLSelectElement>('date-slot'),
  dateStyle: input<HTMLSelectElement>('date-style'),
  logoSlot: input<HTMLSelectElement>('logo-slot'),
  logoHeight: input<HTMLSelectElement>('logo-height'),
  font: input<HTMLSelectElement>('font'),
  textSize: input('text-size'),
  textColour: input('text-colour'),
  margin: input('margin'),
  bold: input('bold'),
}

for (const select of [controls.numSlot, controls.dateSlot]) {
  for (const slot of SLOTS) select.add(new Option(SLOT_LABELS[slot], slot))
}
const today = new Date()
for (const option of controls.dateStyle.options) option.textContent = formatDate(today, option.value as DateStyle)

let files: OpenedPdf[] = []
let settings: StampSettings = loadSettings()
let logo: Logo | null = loadSavedLogo()
let previewIndex = 0
let previewFileIndex = 0

function loadSettings(): StampSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? sanitiseSettings(JSON.parse(raw)) : structuredClone(DEFAULT_SETTINGS)
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Settings are still used for this visit.
  }
}

// ---- Settings <-> form -------------------------------------------------------------------

function showSettings(s: StampSettings): void {
  const scope = form.querySelector<HTMLInputElement>(`input[name="scope"][value="${s.scope}"]`)
  if (scope) scope.checked = true
  rangeInput.value = s.range
  const c = controls
  c.wmOn.checked = s.watermark.on
  c.wmPreset.value = s.watermark.preset
  c.wmCustom.value = s.watermark.custom
  c.wmDirection.value = s.watermark.diagonal ? 'diagonal' : 'horizontal'
  c.wmSize.value = s.watermark.size
  c.wmColour.value = s.watermark.colour
  c.wmOpacity.value = String(Math.round(s.watermark.opacity * 100))
  c.numOn.checked = s.numbers.on
  c.numFormat.value = s.numbers.format
  c.numSlot.value = s.numbers.slot
  c.numStart.value = String(s.numbers.start)
  c.headerText.value = s.header.text
  c.headerAlign.value = s.header.align
  c.footerText.value = s.footer.text
  c.footerAlign.value = s.footer.align
  c.dateSlot.value = s.date.slot
  c.dateStyle.value = s.date.style
  c.logoSlot.value = s.logo.slot
  c.logoHeight.value = String(s.logo.height)
  if (c.logoHeight.selectedIndex < 0) c.logoHeight.value = '32'
  c.font.value = s.text.font
  c.textSize.value = String(s.text.size)
  c.textColour.value = s.text.colour
  c.margin.value = String(s.text.margin)
  c.bold.checked = s.text.bold
}

function readSettings(): StampSettings {
  const c = controls
  const number = (el: { value: string }, fallback: number) => {
    const n = Number(el.value)
    return el.value.trim() === '' || !Number.isFinite(n) ? fallback : n
  }
  return sanitiseSettings({
    scope: (form.elements.namedItem('scope') as RadioNodeList).value as PageScope,
    range: rangeInput.value,
    watermark: {
      on: c.wmOn.checked,
      preset: c.wmPreset.value,
      custom: c.wmCustom.value,
      diagonal: c.wmDirection.value === 'diagonal',
      size: c.wmSize.value as WatermarkSize,
      colour: c.wmColour.value,
      opacity: number(c.wmOpacity, 20) / 100,
    },
    numbers: {
      on: c.numOn.checked,
      slot: c.numSlot.value as Slot,
      format: c.numFormat.value as NumberFormat,
      start: number(c.numStart, 1),
    },
    header: { text: c.headerText.value, align: c.headerAlign.value as Align },
    footer: { text: c.footerText.value, align: c.footerAlign.value as Align },
    date: { slot: c.dateSlot.value as Slot | 'none', style: c.dateStyle.value as DateStyle },
    logo: { slot: c.logoSlot.value as 'top-left' | 'top-right', height: number(c.logoHeight, 32) },
    text: {
      font: c.font.value as FontName,
      size: number(c.textSize, 10),
      colour: c.textColour.value,
      bold: c.bold.checked,
      margin: number(c.margin, 10),
    },
  })
}

function syncControls(): void {
  const c = controls
  c.wmCustomField.hidden = c.wmPreset.value !== 'custom'
  c.wmOpacityValue.textContent = `${c.wmOpacity.value}%`
  for (const el of [c.wmPreset, c.wmCustom, c.wmDirection, c.wmSize, c.wmColour, c.wmOpacity])
    el.disabled = !c.wmOn.checked
  for (const el of [c.numFormat, c.numSlot, c.numStart]) el.disabled = !c.numOn.checked
  c.dateStyle.disabled = c.dateSlot.value === 'none'
  rangeInput.disabled = settings.scope !== 'range'
  logoPreview.hidden = !logo
  logoRemove.hidden = !logo
  byId('logo-slot-field').hidden = !logo
  byId('logo-size-field').hidden = !logo
  logoChoose.textContent = logo ? 'Change logo' : 'Add a logo'
  if (logo) logoPreview.src = logoDataUrl(logo)
}

// ---- Files -------------------------------------------------------------------------------

function showError(message: string): void {
  const target = files.length ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function renderFiles(): void {
  fileList.replaceChildren(
    ...files.map((f, i) => {
      const li = document.createElement('li')
      const name = document.createElement('span')
      name.className = 'file-name'
      name.textContent = f.name
      const count = document.createElement('span')
      count.className = 'file-pages'
      count.textContent = pages(f.pageCount)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'icon'
      remove.textContent = '×'
      remove.setAttribute('aria-label', `Remove ${f.name}`)
      remove.addEventListener('click', () => removeFile(i))
      li.append(name, count, remove)
      return li
    }),
  )
  previewFile.replaceChildren(...files.map((f, i) => new Option(f.name, String(i))))
  previewFile.hidden = files.length < 2
  previewFile.value = String(previewFileIndex)
  const total = files.reduce((n, f) => n + f.pageCount, 0)
  summary.textContent =
    files.length === 1 ? `${files[0].name}, ${pages(total)}` : `${files.length} PDFs, ${pages(total)} in all`
  downloadButton.textContent = files.length > 1 ? 'Download .zip' : 'Download stamped PDF'
}

function removeFile(index: number): void {
  files = files.filter((_, i) => i !== index)
  if (files.length === 0) {
    workScreen.hidden = true
    openScreen.hidden = false
    return
  }
  previewFileIndex = Math.min(previewFileIndex, files.length - 1)
  previewIndex = Math.min(previewIndex, files[previewFileIndex].pageCount - 1)
  renderFiles()
  update()
}

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
    if (files.length === 0) {
      previewFileIndex = 0
      previewIndex = 0
    }
    files = [...files, ...added]
    openScreen.hidden = true
    workScreen.hidden = false
    renderFiles()
    update()
  }
  if (errors.length) showError(errors.join('\n'))
}

// ---- Preview -----------------------------------------------------------------------------

let previewTimer = 0
let previewGeneration = 0

function update(): void {
  settings = readSettings()
  saveSettings()
  syncControls()
  const selection = selectPages(settings.scope, settings.range, files[0]?.pageCount ?? 1)
  rangeError.hidden = selection.ok
  if (!selection.ok) rangeError.textContent = selection.error
  downloadButton.disabled = !selection.ok || files.length === 0
  clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => void renderPreview(), 120)
}

async function renderPreview(): Promise<void> {
  const file = files[previewFileIndex]
  if (!file) return
  const generation = ++previewGeneration
  const index = Math.min(previewIndex, file.pageCount - 1)
  previewPageLabel.textContent = `Page ${index + 1} of ${file.pageCount}`
  prevPage.disabled = index === 0
  nextPage.disabled = index >= file.pageCount - 1
  try {
    const { bytes, stamped } = await previewPage(file.doc, index, settings, logo, today)
    const pdf = await loadPdf(bytes)
    try {
      const page = await pdf.getPage(1)
      if (generation !== previewGeneration) return
      const frame = previewCanvas.parentElement!
      const base = page.getViewport({ scale: 1 })
      const fit = Math.min((frame.clientWidth || 300) / base.width, (frame.clientHeight || 600) / base.height)
      const ratio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: fit * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      if (generation !== previewGeneration) return
      previewCanvas.width = canvas.width
      previewCanvas.height = canvas.height
      previewCanvas.style.width = `${Math.round(viewport.width / ratio)}px`
      previewCanvas.style.height = `${Math.round(viewport.height / ratio)}px`
      previewCanvas.getContext('2d')!.drawImage(canvas, 0, 0)
      previewCanvas.dataset.rendered = String(generation)
      previewNote.textContent = stamped ? '' : 'This page is not stamped.'
    } finally {
      void pdf.loadingTask.destroy()
    }
  } catch {
    if (generation === previewGeneration) previewNote.textContent = 'This page could not be shown.'
  }
}

// ---- Download ----------------------------------------------------------------------------

async function download(): Promise<void> {
  clearErrors()
  if (files.length === 0) return
  downloadButton.disabled = true
  const label = downloadButton.textContent
  downloadButton.textContent = 'Stamping…'
  try {
    const names = uniqueNames(files.map((f) => withSuffix(f.name, 'stamped')))
    const outputs: Uint8Array[] = []
    for (const f of files) outputs.push(await stampPdf(f.bytes, settings, logo, today))
    if (files.length === 1) {
      downloadFile(outputs[0], names[0], 'application/pdf')
    } else {
      const zip = zipSync(Object.fromEntries(names.map((n, i) => [n, outputs[i]])), { level: 0 })
      downloadFile(zip, 'stamped-pdfs.zip', 'application/zip')
    }
  } catch (e) {
    showError(
      e instanceof Error && e.message
        ? `The stamped files could not be made. ${e.message}`
        : 'The stamped files could not be made.',
    )
  } finally {
    downloadButton.textContent = label
    downloadButton.disabled = false
  }
}

// ---- Wiring ------------------------------------------------------------------------------

showSettings(settings)
syncControls()

form.addEventListener('input', update)
form.addEventListener('change', update)
form.addEventListener('submit', (e) => e.preventDefault())
rangeInput.addEventListener('focus', () => {
  const radio = form.querySelector<HTMLInputElement>('input[name="scope"][value="range"]')
  if (radio && !radio.checked) {
    radio.checked = true
    update()
  }
})
// A disabled input takes no focus, so a tap on it chooses "These pages" first.
rangeInput.parentElement!.addEventListener('pointerdown', (e) => {
  if (e.target !== rangeInput || !rangeInput.disabled) return
  const radio = form.querySelector<HTMLInputElement>('input[name="scope"][value="range"]')!
  radio.checked = true
  update()
  rangeInput.focus()
})
prevPage.addEventListener('click', () => {
  previewIndex = Math.max(0, previewIndex - 1)
  void renderPreview()
})
nextPage.addEventListener('click', () => {
  previewIndex = Math.min(files[previewFileIndex].pageCount - 1, previewIndex + 1)
  void renderPreview()
})
previewFile.addEventListener('change', () => {
  previewFileIndex = Number(previewFile.value)
  previewIndex = Math.min(previewIndex, files[previewFileIndex].pageCount - 1)
  void renderPreview()
})
downloadButton.addEventListener('click', () => void download())
logoRemove.addEventListener('click', () => {
  logo = null
  saveLogo(null)
  update()
})
new ResizeObserver(() => {
  if (files.length) {
    clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => void renderPreview(), 150)
  }
}).observe(previewCanvas.parentElement!)

const logoInput = byId<HTMLInputElement>('logo-input')
logoInput.addEventListener('change', async () => {
  const file = logoInput.files?.[0]
  logoInput.value = ''
  if (!file) return
  clearErrors()
  try {
    logo = await readLogo(file)
    saveLogo(logo)
    update()
  } catch (e) {
    showError(e instanceof LogoError ? e.message : 'That picture could not be read. Try a PNG or JPEG.')
  }
})

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: (chosen) => void addFiles(chosen),
})
