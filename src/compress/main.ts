import { zipSync } from 'fflate'
import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { withSuffix } from '../shared/pdf/file-names'
import { openErrorMessage, openPdfFile } from '../shared/pdf/open-pdf'
import { loadPdf } from '../shared/pdf/pdf-worker'
import { CompressCancelled, compressPdf } from './compress'
import {
  describeChange,
  firstAttempt,
  formatBytes,
  loadSettings,
  preferredChoice,
  sanitiseSettings,
  saveSettings,
  searchSettings,
  targetBytes,
  uniqueFileNames,
  type Attempt,
  type CompressSettings,
} from './settings'
import './styles.css'

startPdfTool('Compress a PDF')

const ZIP_FILE_NAME = 'compressed-pdfs.zip'

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const summary = byId('summary')
const form = byId<HTMLFormElement>('settings-form')
const quality = byId<HTMLInputElement>('quality')
const qualityValue = byId<HTMLOutputElement>('quality-value')
const greyscale = byId<HTMLInputElement>('greyscale')
const useTarget = byId<HTMLInputElement>('use-target')
const targetValue = byId<HTMLInputElement>('target-value')
const targetUnit = byId<HTMLSelectElement>('target-unit')
const compressButton = byId<HTMLButtonElement>('compress')
const cancelButton = byId<HTMLButtonElement>('cancel')
const downloadAll = byId<HTMLButtonElement>('download-all')
const progressRow = byId('progress-row')
const progress = byId<HTMLProgressElement>('progress')
const progressText = byId('progress-text')
const list = byId<HTMLOListElement>('file-list')
const status = byId('status')

interface Result {
  bytes: Uint8Array
  attempt: Attempt
  attempts: number
  /** False when a target was set and even the lowest settings tried did not reach it. */
  fits: boolean
}

interface Entry {
  id: number
  name: string
  bytes: Uint8Array
  pageCount: number
  state: 'waiting' | 'working' | 'done' | 'failed'
  detail: string
  result: Result | null
  choice: 'compressed' | 'original'
}

let entries: Entry[] = []
let nextId = 1
let settings = loadSettings()
let running: AbortController | null = null

function showError(message: string): void {
  const target = entries.length > 0 ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function announce(message: string): void {
  status.textContent = message
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  return e
}

function writeForm(s: CompressSettings): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="preset"][value="${s.preset}"]`)
  if (radio) radio.checked = true
  quality.value = String(Math.round(s.quality * 100))
  qualityValue.value = `${quality.value}%`
  greyscale.checked = s.greyscale
  useTarget.checked = s.useTarget
  targetValue.value = String(s.targetValue)
  targetUnit.value = s.targetUnit
}

function readForm(): CompressSettings {
  return sanitiseSettings({
    preset: (form.elements.namedItem('preset') as RadioNodeList).value,
    quality: Number(quality.value) / 100,
    greyscale: greyscale.checked,
    useTarget: useTarget.checked,
    targetValue: Number(targetValue.value),
    targetUnit: targetUnit.value,
  })
}

function outputName(entry: Entry): string {
  return entry.choice === 'compressed' && entry.result ? withSuffix(entry.name, 'compressed') : entry.name
}

function outputBytes(entry: Entry): Uint8Array {
  return entry.choice === 'compressed' && entry.result ? entry.result.bytes : entry.bytes
}

function describeAttempt(a: Attempt): string {
  return `${a.dpi} dpi, quality ${Math.round(a.quality * 100)}%`
}

function resultLine(entry: Entry): HTMLElement {
  const line = el('span', 'file-result')
  const r = entry.result
  if (!r) {
    line.textContent = entry.detail
    return line
  }
  const before = entry.bytes.length
  const after = r.bytes.length
  line.append(
    el('span', 'size', formatBytes(before)),
    ' → ',
    el('span', 'size new-size', formatBytes(after)),
    ' ',
    el('span', after < before ? 'change smaller' : 'change larger', describeChange(before, after)),
    el('span', 'settings-used', ` (${describeAttempt(r.attempt)})`),
  )
  return line
}

function render(): void {
  openScreen.hidden = entries.length > 0
  workScreen.hidden = entries.length === 0
  const total = entries.reduce((sum, e) => sum + e.bytes.length, 0)
  summary.textContent = `${entries.length} ${entries.length === 1 ? 'file' : 'files'}, ${formatBytes(total)}`
  const busy = running !== null
  compressButton.disabled = busy || entries.length === 0
  compressButton.textContent =
    entries.some((e) => e.result) && !entries.some((e) => !e.result) ? 'Compress again' : 'Compress'
  cancelButton.hidden = !busy
  downloadAll.disabled = busy || !entries.some((e) => e.result)
  downloadAll.textContent = entries.length > 1 ? 'Download all (.zip)' : 'Download'

  list.replaceChildren(
    ...entries.map((entry) => {
      const li = el('li', `file-item ${entry.state}`)
      li.dataset.id = String(entry.id)
      const info = el('span', 'file-info')
      info.append(
        el('span', 'file-name', entry.name),
        el('span', 'file-pages', `${pages(entry.pageCount)}, ${formatBytes(entry.bytes.length)}`),
        resultLine(entry),
      )
      const r = entry.result
      if (r) {
        const notes: string[] = []
        if (!r.fits) notes.push('Even the lowest settings did not reach the target size.')
        if (r.bytes.length >= entry.bytes.length)
          notes.push('The compressed file is not smaller, so the original is kept unless you choose otherwise.')
        for (const note of notes) info.append(el('span', 'file-note', note))

        const choose = el('label', 'choice')
        choose.append('Download ')
        const select = el('select', 'choice-select')
        select.setAttribute('aria-label', `Which copy of ${entry.name} to download`)
        for (const [value, label] of [
          ['compressed', 'the compressed copy'],
          ['original', 'the original'],
        ] as const) {
          const option = el('option', '', label)
          option.value = value
          select.append(option)
        }
        select.value = entry.choice
        choose.append(select)
        info.append(choose)
      }

      const actions = el('span', 'file-actions')
      if (r) {
        const dl = el('button', 'download-one', 'Download')
        dl.type = 'button'
        dl.setAttribute('aria-label', `Download ${entry.name}`)
        dl.disabled = busy
        actions.append(dl)
      }
      const remove = el('button', 'icon remove', '✕')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${entry.name}`)
      remove.title = `Remove ${entry.name}`
      remove.disabled = busy
      actions.append(remove)
      li.append(info, actions)
      return li
    }),
  )
}

/** Settings changed: earlier results no longer match them. */
function resetResults(): void {
  for (const e of entries) {
    e.result = null
    e.state = 'waiting'
    e.detail = 'Ready to compress'
  }
}

async function addFiles(files: File[]): Promise<void> {
  clearErrors()
  const problems: string[] = []
  for (const file of files) {
    try {
      const opened = await openPdfFile(file)
      entries.push({
        id: nextId++,
        name: opened.name,
        bytes: opened.bytes,
        pageCount: opened.pageCount,
        state: 'waiting',
        detail: 'Ready to compress',
        result: null,
        choice: 'compressed',
      })
    } catch (e) {
      problems.push(openErrorMessage(e, file.name))
    }
  }
  render()
  if (problems.length > 0) showError(problems.join('\n'))
  else announce(`${files.length === 1 ? 'File' : 'Files'} added. ${summary.textContent}.`)
}

async function compressAll(): Promise<void> {
  clearErrors()
  const todo = entries.filter((e) => !e.result)
  const work = todo.length > 0 ? todo : entries
  if (work.length === 0 || running) return
  const controller = new AbortController()
  running = controller
  const s = settings
  const target = s.useTarget ? targetBytes(s.targetValue, s.targetUnit) : null
  if (s.useTarget && target === null) {
    running = null
    showError('Enter a target size above 0, or untick "Keep each file under".')
    return
  }
  const totalPages = work.reduce((sum, e) => sum + e.pageCount, 0)
  let pagesBefore = 0
  progressRow.hidden = false
  progress.value = 0
  render()

  try {
    for (const entry of work) {
      entry.state = 'working'
      entry.result = null
      entry.detail = 'Compressing…'
      render()
      const pdf = await loadPdf(entry.bytes)
      try {
        let last: Uint8Array = entry.bytes
        const tried = await searchSettings(firstAttempt(s), target, async (attempt, index) => {
          const tag = index === 0 ? '' : `Try ${index + 1} (${describeAttempt(attempt)}): `
          last = await compressPdf(pdf, attempt, {
            greyscale: s.greyscale,
            signal: controller.signal,
            onPage: (done, total) => {
              progress.value = (pagesBefore + done) / totalPages
              progressText.textContent = `${entry.name}: ${tag}page ${done} of ${total}`
            },
          })
          return last.length
        })
        const final = tried[tried.length - 1]
        entry.result = {
          bytes: last,
          attempt: { dpi: final.dpi, quality: final.quality },
          attempts: tried.length,
          fits: target === null || final.size <= target,
        }
        entry.choice = preferredChoice(entry.bytes.length, last.length)
        entry.state = 'done'
      } catch (e) {
        if (e instanceof CompressCancelled) throw e
        entry.state = 'failed'
        entry.detail = 'This PDF could not be compressed.'
      } finally {
        void pdf.loadingTask.destroy()
      }
      pagesBefore += entry.pageCount
      progress.value = pagesBefore / totalPages
      render()
    }
    progressText.textContent = 'Done.'
    announce('Compression finished.')
  } catch (e) {
    if (!(e instanceof CompressCancelled)) throw e
    for (const entry of work) {
      if (entry.state === 'working') {
        entry.state = 'waiting'
        entry.detail = 'Cancelled'
      }
    }
    progressText.textContent = 'Cancelled.'
    announce('Compression cancelled.')
  } finally {
    running = null
    render()
  }
}

function downloadEntries(chosen: Entry[]): void {
  if (chosen.length === 1) {
    downloadFile(outputBytes(chosen[0]), outputName(chosen[0]), 'application/pdf')
    return
  }
  const names = uniqueFileNames(chosen.map(outputName))
  // PDFs are already compressed, so store them as they are.
  const zip = zipSync(Object.fromEntries(chosen.map((e, i) => [names[i], outputBytes(e)])), { level: 0 })
  downloadFile(zip, ZIP_FILE_NAME, 'application/zip')
}

function onSettingsChange(): void {
  const next = readForm()
  qualityValue.value = `${Math.round(next.quality * 100)}%`
  const changed = JSON.stringify(next) !== JSON.stringify(settings)
  settings = next
  saveSettings(settings)
  if (changed && !running && entries.some((e) => e.result)) {
    resetResults()
    progressRow.hidden = true
    render()
  }
}

list.addEventListener('click', (e) => {
  const button = (e.target as Element).closest('button')
  const item = button?.closest<HTMLElement>('.file-item')
  if (!button || !item) return
  const index = entries.findIndex((entry) => String(entry.id) === item.dataset.id)
  if (index < 0) return
  if (button.classList.contains('remove')) {
    const [removed] = entries.splice(index, 1)
    announce(`${removed.name} removed.`)
    render()
  } else if (button.classList.contains('download-one')) {
    downloadEntries([entries[index]])
  }
})

list.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement
  const item = select.closest<HTMLElement>('.file-item')
  const entry = entries.find((x) => String(x.id) === item?.dataset.id)
  if (!entry || !select.classList.contains('choice-select')) return
  entry.choice = select.value === 'original' ? 'original' : 'compressed'
})

writeForm(settings)
form.addEventListener('input', onSettingsChange)
form.addEventListener('change', onSettingsChange)
form.addEventListener('submit', (e) => e.preventDefault())
targetValue.addEventListener('input', () => {
  if (targetValue.value.trim() !== '' && !useTarget.checked) {
    useTarget.checked = true
    onSettingsChange()
  }
})
compressButton.addEventListener('click', () => void compressAll())
cancelButton.addEventListener('click', () => running?.abort())
downloadAll.addEventListener('click', () => {
  const ready = entries.filter((e) => e.result)
  if (ready.length > 0) downloadEntries(entries.length > 1 ? entries : ready)
})

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: (files) => void addFiles(files),
})
render()
