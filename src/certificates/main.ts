import './styles.css'
import { zipSync } from 'fflate'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import {
  ClassStorageError,
  SPREADSHEET_ACCEPT,
  SpreadsheetError,
  guessColumns,
  importSpreadsheet,
  listClasses,
  type ClassList,
  type ImportedSheet,
} from '../shared/classes'
import { downloadFile } from '../shared/pdf/download'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { byId } from '../shared/pdf/tool-page'
import type { OutlineFonts } from './draw'
import { LABEL_PRESETS, labelCells, layoutProblems, presetLayout, sheetCount, type LabelLayout } from './layouts'
import { fieldKey, templateFields, unknownFields, type Recipient } from './merge'
import {
  DESIGNS,
  LETTERINGS,
  PRODUCTS,
  THEMES,
  longDate,
  productTemplates,
  readSettings,
  todayIso,
  type Design,
  type Lettering,
  type Product,
  type Settings,
} from './model'
import { loadPicture, PictureError } from './pictures'
import { fromClassList, fromPasted, fromRows, withShared, type RecipientList } from './recipients'
import {
  canSplitPerLearner,
  combinedFileName,
  perLearnerFileNames,
  renderPdf,
  type Picture,
  type Pictures,
} from './render'

registerOffline(mountSiteHeader({ toolName: 'Certificates and labels' }))

// Per-browser conveniences only: the wording and look, which source and class were used last,
// and the school logo. Learners' names are never stored by this page.
const SETTINGS_KEY = 'red-pen.certificates.settings'
const SOURCE_KEY = 'red-pen.certificates.source'
const CLASS_KEY = 'red-pen.certificates.class'
const LOGO_KEY = 'red-pen.certificates.logo'

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage refused or full: the choice is simply not remembered.
  }
}

const input = <T extends HTMLElement = HTMLInputElement>(id: string) => byId<T>(id)

const storageError = byId('storage-error')
const classSelect = input<HTMLSelectElement>('class-select')
const classField = byId('class-field')
const noClasses = byId('no-classes')
const pasteText = input<HTMLTextAreaElement>('paste-text')
const fileInput = input('file-input')
const fileName = byId('file-name')
const sheetField = byId('sheet-field')
const sheetSelect = input<HTMLSelectElement>('sheet-select')
const headerRow = input('header-row')
const sourceError = byId('source-error')
const sourceSummary = byId('source-summary')
const fieldChips = byId('field-chips')
const productsBox = byId('products')
const designsBox = byId('designs')
const themesBox = byId('themes')
const lettering = input<HTMLSelectElement>('lettering')
const dateInput = input('date')
const sheetPreset = input<HTMLSelectElement>('sheet-preset')
const pictureError = byId('picture-error')
const previewCaption = byId('preview-caption')
const canvas = input<HTMLCanvasElement>('preview-canvas')
const warnings = byId('warnings')
const layoutError = byId('layout-error')
const downloadError = byId('download-error')
const downloadButton = input<HTMLButtonElement>('download')
const zipButton = input<HTMLButtonElement>('download-zip')
const downloadHelp = byId('download-help')

let settings: Settings = readSettings(remembered(SETTINGS_KEY))
let classes: ClassList[] = []
let imported: { name: string; sheets: ImportedSheet[] } | null = null
const pictures: Pictures = {}
let fontsPromise: Promise<OutlineFonts> | null = null

function fonts(): Promise<OutlineFonts> {
  fontsPromise ??= import('./font/bundled-fonts').then((m) => m.bundledFonts())
  return fontsPromise
}

function showError(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

function learners(n: number): string {
  return `${n} ${n === 1 ? 'learner' : 'learners'}`
}

// ---------- Recipients ----------

type Source = 'class' | 'paste' | 'file'

function source(): Source {
  return (document.querySelector<HTMLInputElement>('input[name="source"]:checked')?.value as Source) ?? 'class'
}

function baseList(): { list: RecipientList; name: string } {
  switch (source()) {
    case 'class': {
      const c = classes.find((x) => x.id === classSelect.value)
      return c
        ? { list: fromClassList(c), name: c.name }
        : { list: { fields: ['Name'], recipients: [] }, name: 'class' }
    }
    case 'paste':
      return { list: fromPasted(pasteText.value), name: 'learners' }
    case 'file': {
      const sheet = imported?.sheets[Number(sheetSelect.value) || 0]
      if (!imported || !sheet) return { list: { fields: ['Name'], recipients: [] }, name: 'learners' }
      return { list: fromRows(sheet.rows, headerRow.checked), name: imported.name.replace(/\.[^.]+$/, '') }
    }
  }
}

/** The Recipient list with the shared fields every recipient gets. */
function recipientList(): { list: RecipientList; name: string } {
  const { list, name } = baseList()
  return { list: withShared(list, { Date: longDate(dateInput.value), Class: '' }), name }
}

/** A stand-in learner for the preview before any names are in. */
function exampleRecipient(fields: string[]): Recipient {
  const r: Recipient = {}
  for (const f of fields) r[f] = f
  r.Name = 'Learner name'
  r.Date = longDate(dateInput.value)
  return r
}

let lastTemplate: HTMLInputElement | HTMLTextAreaElement | null = null

function renderChips(fields: string[]): void {
  fieldChips.replaceChildren(
    ...fields.map((f) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.textContent = `{${f}}`
      // Keep the focus (and caret) in the box being typed in.
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => insertField(f))
      return b
    }),
  )
}

function insertField(field: string): void {
  const target = lastTemplate ?? byId<HTMLInputElement>(settings.product === 'certificate' ? 'c-body' : 'd-line1')
  if (target.closest<HTMLElement>('.product-fields')?.hidden) return
  const token = `{${field}}`
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.setRangeText(token, start, end, 'end')
  target.focus()
  target.dispatchEvent(new Event('input', { bubbles: true }))
}

// ---------- Settings <-> form ----------

function radios(
  box: HTMLElement,
  name: string,
  options: readonly { id: string; name: string }[],
  className = '',
): void {
  box.replaceChildren(
    ...options.map((o) => {
      const label = document.createElement('label')
      if (className) label.className = className
      const r = document.createElement('input')
      r.type = 'radio'
      r.name = name
      r.value = o.id
      const span = document.createElement('span')
      span.textContent = o.name
      label.append(r, span)
      return label
    }),
  )
}

function buildChoices(): void {
  productsBox.replaceChildren(
    ...PRODUCTS.map((p) => {
      const label = document.createElement('label')
      label.className = 'product'
      const r = document.createElement('input')
      r.type = 'radio'
      r.name = 'product'
      r.value = p.id
      const name = document.createElement('strong')
      name.textContent = p.name
      const hint = document.createElement('small')
      hint.textContent = p.hint
      label.append(r, name, hint)
      return label
    }),
  )
  radios(designsBox, 'design', DESIGNS)
  themesBox.replaceChildren(
    ...THEMES.map((t) => {
      const label = document.createElement('label')
      label.className = 'swatch'
      label.title = t.name
      const r = document.createElement('input')
      r.type = 'radio'
      r.name = 'theme'
      r.value = t.id
      r.setAttribute('aria-label', t.name)
      const span = document.createElement('span')
      span.style.setProperty('--main', t.main)
      span.style.setProperty('--accent', t.accent)
      label.append(r, span)
      return label
    }),
  )
  lettering.replaceChildren(...LETTERINGS.map((l) => new Option(l.name, l.id)))
  sheetPreset.replaceChildren(
    ...LABEL_PRESETS.map((p) => new Option(p.name, p.id)),
    new Option('Custom sheet', 'custom'),
  )
}

function check(name: string, value: string): void {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
  if (r) r.checked = true
}

function checked(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? ''
}

const val = (id: string) => byId<HTMLInputElement | HTMLTextAreaElement>(id).value
const setVal = (id: string, v: string) => (byId<HTMLInputElement | HTMLTextAreaElement>(id).value = v)
const isOn = (id: string) => byId<HTMLInputElement>(id).checked
const setOn = (id: string, v: boolean) => (byId<HTMLInputElement>(id).checked = v)

const GRID: [string, keyof LabelLayout][] = [
  ['g-columns', 'columns'],
  ['g-rows', 'rows'],
  ['g-width', 'width'],
  ['g-height', 'height'],
  ['g-top', 'top'],
  ['g-left', 'left'],
  ['g-pitch-x', 'pitchX'],
  ['g-pitch-y', 'pitchY'],
]

/** The label or book label settings, whichever is showing. */
function sheetSettings() {
  return settings.product === 'book' ? settings.book : settings.labels
}

function writeSheetFields(): void {
  const s = sheetSettings()
  sheetPreset.value = s.preset
  for (const [id, key] of GRID) setVal(id, String(s.layout[key]))
  setVal('g-skip', String(s.skip))
  setVal('g-copies', String(s.copies))
  setOn('g-outlines', s.outlines)
}

function writeForm(): void {
  const s = settings
  check('product', s.product)
  check('theme', s.theme)
  lettering.value = s.lettering
  const c = s.certificate
  check('design', c.design)
  check('orientation', c.orientation)
  setVal('c-school', c.school)
  setVal('c-title', c.title)
  setVal('c-intro', c.intro)
  setVal('c-name', c.name)
  setVal('c-body', c.body)
  setVal('c-date', c.date)
  setOn('c-script', c.scriptName)
  setVal('c-sig1-name', c.signatories[0].name)
  setVal('c-sig1-role', c.signatories[0].role)
  setVal('c-sig2-name', c.signatories[1].name)
  setVal('c-sig2-role', c.signatories[1].role)
  setVal('d-line1', s.desk.line1)
  setVal('d-line2', s.desk.line2)
  setOn('d-both', s.desk.bothSides)
  setVal('l-line1', s.labels.line1)
  setVal('l-line2', s.labels.line2)
  setVal('b-heading', s.book.heading)
  s.book.rows.forEach((r, i) => {
    setVal(`b-row${i + 1}-label`, r.label)
    setVal(`b-row${i + 1}-value`, r.value)
  })
  setVal('s-title', s.slips.title)
  setVal('s-body', s.slips.body)
  setVal('s-signed', s.slips.signedBy)
  setVal('s-footer', s.slips.footer)
  writeSheetFields()
  showProduct()
}

function num(id: string, fallback: number): number {
  const n = Number(val(id))
  return val(id).trim() === '' || !Number.isFinite(n) ? fallback : n
}

function readForm(): void {
  const s = settings
  s.product = (checked('product') as Product) || s.product
  s.theme = checked('theme') || s.theme
  s.lettering = lettering.value as Lettering
  const c = s.certificate
  c.design = (checked('design') as Design) || c.design
  c.orientation = checked('orientation') === 'portrait' ? 'portrait' : 'landscape'
  c.school = val('c-school')
  c.title = val('c-title')
  c.intro = val('c-intro')
  c.name = val('c-name')
  c.body = val('c-body')
  c.date = val('c-date')
  c.scriptName = isOn('c-script')
  c.signatories = [
    { name: val('c-sig1-name'), role: val('c-sig1-role') },
    { name: val('c-sig2-name'), role: val('c-sig2-role') },
  ]
  s.desk = { line1: val('d-line1'), line2: val('d-line2'), bothSides: isOn('d-both') }
  s.labels.line1 = val('l-line1')
  s.labels.line2 = val('l-line2')
  s.book.heading = val('b-heading')
  s.book.rows = [1, 2, 3].map((i) => ({
    label: val(`b-row${i}-label`),
    value: val(`b-row${i}-value`),
  })) as Settings['book']['rows']
  s.slips = { title: val('s-title'), body: val('s-body'), signedBy: val('s-signed'), footer: val('s-footer') }
  if (s.product === 'labels' || s.product === 'book') {
    const sheet = sheetSettings()
    const layout = { ...sheet.layout }
    for (const [id, key] of GRID) layout[key] = num(id, sheet.layout[key])
    sheet.layout = layout
    sheet.skip = Math.max(0, Math.floor(num('g-skip', 0)))
    sheet.copies = Math.max(1, Math.min(100, Math.floor(num('g-copies', 1))))
    sheet.outlines = isOn('g-outlines')
  }
  remember(SETTINGS_KEY, JSON.stringify(settings))
}

function showProduct(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.product-fields')) {
    el.hidden = !(el.dataset.product ?? '').split(' ').includes(settings.product)
  }
  const split = canSplitPerLearner(settings.product)
  zipButton.hidden = !split
  downloadHelp.textContent = split
    ? 'Print on A4 at actual size (100%). The .zip has one PDF per learner.'
    : 'Print on A4 at actual size (100%), with no scaling, so the labels line up.'
  if (settings.product === 'certificate') downloadHelp.textContent += ' Choose landscape or portrait to match.'
}

// ---------- Summary, warnings and preview ----------

function perSheet(): number {
  switch (settings.product) {
    case 'certificate':
      return 1
    case 'desk':
      return 2
    case 'slips':
      return 4
    case 'labels':
    case 'book':
      return Math.max(1, labelCells(sheetSettings().layout).length)
  }
}

function pageCount(n: number): number {
  if (settings.product === 'labels' || settings.product === 'book') {
    const s = sheetSettings()
    return sheetCount(n * s.copies, perSheet(), s.skip)
  }
  return Math.ceil(n / perSheet())
}

function updateSummary(list: RecipientList): void {
  const n = list.recipients.length
  if (n === 0) {
    sourceSummary.textContent =
      source() === 'paste' ? 'Paste names above to begin.' : source() === 'file' ? 'Choose a file to begin.' : ''
  } else {
    const pages = pageCount(n)
    sourceSummary.textContent = `${learners(n)}, ${pages} ${pages === 1 ? 'page' : 'pages'}.`
  }
  renderChips(list.fields)
}

function updateWarnings(list: RecipientList): void {
  const templates = productTemplates(settings)
  const items: string[] = []
  for (const f of unknownFields(templates, list.fields))
    items.push(`No column is called {${f}}, so it prints as typed. Check the spelling or pick a field above.`)
  const used = new Set(templates.flatMap(templateFields).map(fieldKey))
  for (const f of list.fields) {
    if (!used.has(fieldKey(f)) || list.recipients.length === 0) continue
    const blank = list.recipients.filter((r) => (r[f] ?? '').trim() === '').length
    if (blank > 0 && fieldKey(f) !== 'class')
      items.push(`${learners(blank)} ${blank === 1 ? 'has' : 'have'} no ${f}; it is left out on theirs.`)
  }
  warnings.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement('li')
      li.textContent = t
      return li
    }),
  )
  warnings.hidden = items.length === 0
}

function layoutIssues(): string[] {
  return settings.product === 'labels' || settings.product === 'book' ? layoutProblems(sheetSettings().layout) : []
}

let previewGeneration = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined

async function renderPreview(): Promise<void> {
  const generation = ++previewGeneration
  const { list } = recipientList()
  const problems = layoutIssues()
  if (problems.length > 0) {
    canvas.hidden = true
    previewCaption.textContent = 'Fix the label sizes to see a preview.'
    return
  }
  const example = list.recipients.length === 0
  const recipients = example ? [exampleRecipient(list.fields)] : list.recipients.slice(0, perSheet())
  try {
    const bytes = await renderPdf({ settings, recipients, fonts: await fonts(), pictures })
    if (generation !== previewGeneration) return
    const pdf = await loadPdf(bytes)
    try {
      const page = await pdf.getPage(1)
      if (generation !== previewGeneration) return
      const base = page.getViewport({ scale: 1 })
      const landscape = base.width > base.height
      canvas.parentElement!.classList.toggle('landscape', landscape)
      const cssWidth = Math.max(200, canvas.parentElement!.clientWidth || 360)
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
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
      const first = recipients[0].Name
      previewCaption.textContent = example
        ? 'An example. Add learners to see their names.'
        : settings.product === 'certificate'
          ? `First page: ${first}.`
          : `First sheet, starting with ${first}.`
    } finally {
      await pdf.loadingTask.destroy()
    }
  } catch {
    if (generation !== previewGeneration) return
    canvas.hidden = true
    previewCaption.textContent = 'The preview could not be drawn.'
  }
}

function schedulePreview(delay = 250): void {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderPreview(), delay)
}

function refresh(delay = 250): void {
  const { list } = recipientList()
  updateSummary(list)
  updateWarnings(list)
  const problems = layoutIssues()
  showError(layoutError, problems.join(' '))
  const n = list.recipients.length
  downloadButton.disabled = n === 0 || problems.length > 0
  zipButton.disabled = n === 0
  downloadButton.textContent = n === 0 ? 'Download PDF' : `Download PDF (${learners(n)})`
  showError(downloadError, '')
  schedulePreview(delay)
}

function changed(): void {
  readForm()
  refresh()
}

// ---------- Downloads ----------

async function download(zip: boolean): Promise<void> {
  const { list, name } = recipientList()
  if (list.recipients.length === 0) return
  showError(downloadError, '')
  downloadButton.disabled = true
  zipButton.disabled = true
  const label = zip ? zipButton.textContent : downloadButton.textContent
  ;(zip ? zipButton : downloadButton).textContent = 'Making the PDF...'
  try {
    const f = await fonts()
    if (zip) {
      const names = perLearnerFileNames(list.recipients)
      const files: Record<string, Uint8Array> = {}
      for (const [i, r] of list.recipients.entries())
        files[names[i]] = await renderPdf({ settings, recipients: [r], fonts: f, pictures })
      // PDFs are already compressed, so storing them is as small as deflating and much faster.
      downloadFile(
        zipSync(files, { level: 0 }),
        combinedFileName(settings.product, name).replace(/\.pdf$/, '.zip'),
        'application/zip',
      )
    } else {
      const pdf = await renderPdf({ settings, recipients: list.recipients, fonts: f, pictures })
      downloadFile(pdf, combinedFileName(settings.product, name), 'application/pdf')
    }
  } catch (error) {
    showError(
      downloadError,
      `The PDF could not be made.${error instanceof Error && error.message ? ` ${error.message}` : ''}`,
    )
  } finally {
    ;(zip ? zipButton : downloadButton).textContent = label
    refresh(0)
  }
}

// ---------- Sources ----------

function showSource(): void {
  const s = source()
  byId('source-class').hidden = s !== 'class'
  byId('source-paste').hidden = s !== 'paste'
  byId('source-file').hidden = s !== 'file'
  showError(sourceError, '')
  remember(SOURCE_KEY, s)
}

async function readFile(file: File): Promise<void> {
  showError(sourceError, '')
  try {
    const sheet = await importSpreadsheet(file)
    imported = { name: file.name, sheets: sheet.sheets }
    fileName.textContent = file.name
    sheetSelect.replaceChildren(...sheet.sheets.map((s, i) => new Option(s.name, String(i))))
    sheetField.hidden = sheet.sheets.length < 2
    const rows = sheet.sheets[0].rows
    headerRow.checked = guessColumns(rows).headerRow
  } catch (error) {
    imported = null
    fileName.textContent = 'No file chosen'
    showError(sourceError, error instanceof SpreadsheetError ? error.message : 'This file could not be read.')
  }
  refresh(0)
}

// ---------- Pictures ----------

function showPicture(kind: 'logo' | 'signature', dataUrl: string | null): void {
  const thumb = byId<HTMLImageElement>(`${kind}-thumb`)
  thumb.hidden = dataUrl === null
  if (dataUrl) thumb.src = dataUrl
  else thumb.removeAttribute('src')
  byId(`${kind}-remove`).hidden = dataUrl === null
}

function wirePicture(kind: 'logo' | 'signature'): void {
  const fileField = byId<HTMLInputElement>(`${kind}-input`)
  fileField.addEventListener('change', async () => {
    const file = fileField.files?.[0]
    fileField.value = ''
    if (!file) return
    showError(pictureError, '')
    try {
      const loaded = await loadPicture(file, kind === 'signature')
      pictures[kind] = loaded.picture
      showPicture(kind, loaded.dataUrl)
      if (kind === 'logo') remember(LOGO_KEY, loaded.dataUrl)
    } catch (error) {
      showError(pictureError, error instanceof PictureError ? error.message : 'This picture could not be opened.')
    }
    refresh(0)
  })
  byId(`${kind}-remove`).addEventListener('click', () => {
    delete pictures[kind]
    showPicture(kind, null)
    if (kind === 'logo') remember(LOGO_KEY, null)
    refresh(0)
  })
}

async function restoreLogo(): Promise<void> {
  const saved = remembered(LOGO_KEY)
  if (!saved?.startsWith('data:image/png;base64,')) return
  try {
    const loaded = await loadPicture(saved)
    pictures.logo = loaded.picture as Picture
    showPicture('logo', loaded.dataUrl)
  } catch {
    remember(LOGO_KEY, null)
  }
}

// ---------- Start ----------

async function start(): Promise<void> {
  buildChoices()
  writeForm()
  dateInput.value = todayIso()
  const savedSource = remembered(SOURCE_KEY)
  if (savedSource === 'paste' || savedSource === 'file' || savedSource === 'class') check('source', savedSource)
  try {
    classes = await listClasses()
  } catch (error) {
    const reason = error instanceof ClassStorageError ? `${error.message} ` : ''
    showError(storageError, `${reason}Saved Class lists cannot be read in this browser. Paste names instead.`)
  }
  if (classes.length === 0) {
    classField.hidden = true
    noClasses.hidden = false
    if (source() === 'class' && savedSource !== 'class') check('source', 'paste')
  } else {
    classSelect.replaceChildren(...classes.map((c) => new Option(`${c.name} (${learners(c.learners.length)})`, c.id)))
    const last = remembered(CLASS_KEY)
    if (last && classes.some((c) => c.id === last)) classSelect.value = last
  }
  showSource()
  await restoreLogo()
  refresh(0)
}

// File pickers are <label for> a hidden input; make them reachable and usable from the keyboard.
for (const label of document.querySelectorAll<HTMLLabelElement>('label.button[for]')) {
  label.tabIndex = 0
  label.setAttribute('role', 'button')
  label.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    document.getElementById(label.htmlFor)?.click()
  })
}
document.addEventListener('focusin', (e) => {
  const t = e.target
  if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.classList.contains('template'))
    lastTemplate = t
})
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="source"]'))
  r.addEventListener('change', () => {
    showSource()
    refresh(0)
  })
classSelect.addEventListener('change', () => {
  remember(CLASS_KEY, classSelect.value)
  refresh()
})
pasteText.addEventListener('input', () => refresh(400))
fileInput.setAttribute('accept', SPREADSHEET_ACCEPT)
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) void readFile(file)
})
sheetSelect.addEventListener('change', () => refresh(0))
headerRow.addEventListener('change', () => refresh(0))
dateInput.addEventListener('input', () => refresh())

productsBox.addEventListener('change', () => {
  settings.product = checked('product') as Product
  writeSheetFields()
  showProduct()
  lastTemplate = null
  changed()
})
sheetPreset.addEventListener('change', () => {
  const sheet = sheetSettings()
  sheet.preset = sheetPreset.value
  const layout = presetLayout(sheetPreset.value)
  if (layout) sheet.layout = layout
  else byId<HTMLDetailsElement>('grid-details').open = true
  writeSheetFields()
  changed()
})
for (const [id] of GRID)
  byId(id).addEventListener('input', () => {
    sheetSettings().preset = 'custom'
    sheetPreset.value = 'custom'
    changed()
  })
const form = byId<HTMLFormElement>('settings')
form.addEventListener('input', (e) => {
  if (GRID.some(([id]) => (e.target as HTMLElement).id === id)) return
  changed()
})
form.addEventListener('change', (e) => {
  if (e.target instanceof HTMLInputElement && (e.target.type === 'radio' || e.target.type === 'checkbox')) changed()
})
form.addEventListener('submit', (e) => e.preventDefault())
downloadButton.addEventListener('click', () => void download(false))
zipButton.addEventListener('click', () => void download(true))
wirePicture('logo')
wirePicture('signature')
let width = window.innerWidth
window.addEventListener('resize', () => {
  if (window.innerWidth === width) return
  width = window.innerWidth
  schedulePreview()
})

void start()
