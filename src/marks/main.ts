import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import {
  importSpreadsheet,
  SPREADSHEET_ACCEPT,
  SpreadsheetError,
  type ImportedSheet,
} from '../shared/classes/spreadsheet'
import { hasNames, learnersCsv, shown, summaryCsv } from './core/analysis'
import { HANDOFF_KEY, handoffRows, parseHandoff } from './core/handoff'
import { toPasteText } from './core/parse'
import { PASS_MARK_PICKS } from './core/settings'
import { parseCutoffs, type BandSchemeId } from './core/stats'
import { sampleRows } from './sample'
import { renderCards } from './ui/cards'
import { download, el, MIME, safeFileName, showMessage } from './ui/dom'
import { renderResults } from './ui/results'
import { current, layout, rows, setSettings, setSource, state } from './ui/state'

registerOffline(mountSiteHeader({ toolName: 'Marks analysis' }))

const text = el<HTMLTextAreaElement>('marks-text')
const fileInput = el<HTMLInputElement>('file-input')
const sheetField = el('sheet-field')
const sheetSelect = el<HTMLSelectElement>('sheet-select')
const importError = el('import-error')
const headerRow = el<HTMLInputElement>('header-row')
const namesColumn = el<HTMLInputElement>('names-column')
const exportStatus = el('export-status')
fileInput.accept = SPREADSHEET_ACCEPT

let sheets: ImportedSheet[] = []

function render(): void {
  // Corrections made on a card show in the paste box too.
  if (text.value !== state.text && document.activeElement !== text) text.value = state.text
  const r = rows()
  const has = r.length > 0
  el('layout-checks').hidden = !has
  el('cards-section').hidden = !has
  el('settings-panel').hidden = !has
  el('results-section').hidden = !has
  el('export-panel').hidden = !has
  if (!has) return
  const l = layout(r)
  headerRow.checked = l.headerRow
  namesColumn.checked = l.namesColumn
  const analysis = current()
  const focused = document.activeElement?.id
  // A card change fires as focus leaves the field, so redraw once focus has landed, then put it back.
  renderCards(el('cards'), analysis, () => setTimeout(render))
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus()
  renderSettings()
  renderResults(el('results'), analysis, render)
  const names = hasNames(analysis)
  const namesBox = el<HTMLInputElement>('report-names')
  namesBox.disabled = !names
  if (!names) namesBox.checked = false
  el('names-help').textContent = names
    ? 'The report has no names unless you tick this.'
    : 'There are no names to list: the report never shows names without a names column.'
  const nothing = shown(analysis).length === 0
  for (const id of ['download-report', 'download-summary', 'download-learners'])
    el<HTMLButtonElement>(id).disabled = nothing
}

function renderSettings(): void {
  const s = state.settings
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scheme"]'))
    radio.checked = radio.value === s.scheme
  el('cutoffs-field').hidden = s.scheme !== 'custom'
  const cutoffs = el<HTMLInputElement>('cutoffs')
  if (document.activeElement !== cutoffs) cutoffs.value = s.customCutoffs.join(', ')
  const pick = PASS_MARK_PICKS.includes(s.passMark) ? String(s.passMark) : 'custom'
  const passRadios = document.querySelectorAll<HTMLInputElement>('input[name="pass"]')
  const customChosen = [...passRadios].some((r) => r.value === 'custom' && r.checked)
  for (const radio of passRadios) radio.checked = radio.value === (customChosen ? 'custom' : pick)
  el('pass-field').hidden = !(customChosen || pick === 'custom')
  const passInput = el<HTMLInputElement>('pass-mark')
  if (document.activeElement !== passInput) passInput.value = String(s.passMark)
}

/** New marks: earlier choices are dropped, and the paste box shows what was read. */
function load(newText: string): void {
  setSource(newText)
  text.value = newText
  render()
}

// ---------- Input ----------

let typing: ReturnType<typeof setTimeout> | undefined
text.addEventListener('paste', () => {
  // A paste is new marks: forget the old headings, names and card choices.
  setTimeout(() => load(text.value))
})
text.addEventListener('input', () => {
  clearTimeout(typing)
  typing = setTimeout(() => {
    if (state.text === text.value) return
    const before = rows()[0]?.length ?? 0
    state.text = text.value
    // Only a change in the number of columns makes the card choices stale.
    if ((rows()[0]?.length ?? 0) !== before) state.choices = []
    render()
  }, 250)
})

headerRow.addEventListener('change', () => {
  state.layout.headerRow = headerRow.checked
  state.choices = []
  render()
})
namesColumn.addEventListener('change', () => {
  state.layout.namesColumn = namesColumn.checked
  state.choices = []
  render()
})

function showSheet(i: number): void {
  const sheet = sheets[i]
  if (sheet) load(toPasteText(sheet.rows))
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return
  showMessage(importError, '')
  try {
    const book = await importSpreadsheet(file)
    sheets = book.sheets.filter((s) => s.rows.length > 0)
    sheetSelect.replaceChildren(
      ...sheets.map((s, i) => {
        const o = document.createElement('option')
        o.value = String(i)
        o.textContent = s.name
        return o
      }),
    )
    sheetField.hidden = sheets.length < 2
    showSheet(0)
  } catch (error) {
    showMessage(importError, error instanceof SpreadsheetError ? error.message : 'This file could not be read.')
  }
})
sheetSelect.addEventListener('change', () => showSheet(Number(sheetSelect.value)))

el('sample').addEventListener('click', () => {
  sheetField.hidden = true
  load(toPasteText(sampleRows()))
})
el('clear-marks').addEventListener('click', () => {
  sheetField.hidden = true
  showMessage(el('handoff-note'), '')
  load('')
  text.focus()
})

// ---------- Settings ----------

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scheme"]'))
  radio.addEventListener('change', () => {
    setSettings({ scheme: radio.value as BandSchemeId })
    render()
  })
el<HTMLInputElement>('cutoffs').addEventListener('change', (e) => {
  const parsed = parseCutoffs((e.target as HTMLInputElement).value)
  showMessage(el('cutoffs-error'), typeof parsed === 'string' ? parsed : '')
  if (typeof parsed !== 'string') {
    setSettings({ customCutoffs: parsed })
    render()
  }
})
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="pass"]'))
  radio.addEventListener('change', () => {
    if (radio.value !== 'custom') setSettings({ passMark: Number(radio.value) })
    render()
    if (radio.value === 'custom') el('pass-mark').focus()
  })
el<HTMLInputElement>('pass-mark').addEventListener('change', (e) => {
  const v = Number((e.target as HTMLInputElement).value)
  if (v > 0 && v <= 100) setSettings({ passMark: v })
  render()
})

// ---------- Exports ----------

const comments = el<HTMLTextAreaElement>('report-comments')
const countComments = () => (el('comments-count').textContent = `(${comments.value.length} / 600)`)
comments.addEventListener('input', countComments)
countComments()

function baseName(): string {
  const parts = [el<HTMLInputElement>('report-class').value, el<HTMLInputElement>('report-subject').value]
  const extra = safeFileName(parts.filter((p) => p.trim()).join(' '))
  return extra ? `Marks analysis ${extra}` : 'Marks analysis'
}

el<HTMLButtonElement>('download-report').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement
  button.disabled = true
  showMessage(exportStatus, 'Making the report...')
  try {
    // pdf-lib loads only when a report is made.
    const { buildReport } = await import('./report/pdf')
    const bytes = await buildReport(current(), {
      className: el<HTMLInputElement>('report-class').value,
      subject: el<HTMLInputElement>('report-subject').value,
      comments: comments.value,
      includeNames: el<HTMLInputElement>('report-names').checked,
    })
    download(bytes, `${baseName()}.pdf`, MIME.pdf)
    showMessage(exportStatus, '')
  } catch {
    showMessage(exportStatus, 'The report could not be made. Try again, or download the CSV files instead.')
  } finally {
    button.disabled = false
  }
})
el('download-summary').addEventListener('click', () =>
  download(summaryCsv(current()), `${baseName()} summary.csv`, MIME.csv),
)
el('download-learners').addEventListener('click', () =>
  download(learnersCsv(current()), `${baseName()} learners.csv`, MIME.csv),
)

// ---------- Leaving and arriving ----------

window.addEventListener('beforeunload', (e) => {
  if (state.text.trim() === '') return
  // Marks are never saved, so warn before they are lost.
  e.preventDefault()
  e.returnValue = ''
})

function takeHandoff(): void {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY)
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    return
  }
  const handoff = parseHandoff(raw)
  if (!handoff || handoff.learners.length === 0) return
  load(toPasteText(handoffRows(handoff)))
  showMessage(
    el('handoff-note'),
    `Marks from MCQ assessments${handoff.title ? `: ${handoff.title}` : ''}. You can paste more columns alongside them.`,
  )
}

// Charts are drawn for the width they show at, so redraw them when that changes (a phone turned).
let lastWidth = window.innerWidth
let resizing: ReturnType<typeof setTimeout> | undefined
window.addEventListener('resize', () => {
  clearTimeout(resizing)
  resizing = setTimeout(() => {
    if (window.innerWidth === lastWidth) return
    lastWidth = window.innerWidth
    if (state.text.trim() !== '') renderResults(el('results'), current(), render)
  }, 200)
})

takeHandoff()
render()
