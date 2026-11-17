import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { planSplit, zipFileName, type PlanResult, type SplitMode } from './plan'
import { describeRange } from './ranges'
import { splitToZip } from './split'
import './styles.css'

startPdfTool('Split a PDF')

const openScreen = byId('open-screen')
const workScreen = byId('work-screen')
const openError = byId('open-error')
const workError = byId('work-error')
const planError = byId('plan-error')
const summary = byId('summary')
const form = byId<HTMLFormElement>('split-form')
const everySize = byId<HTMLInputElement>('every-size')
const rangesText = byId<HTMLInputElement>('ranges-text')
const preview = byId<HTMLOListElement>('preview')
const previewCount = byId('preview-count')
const downloadButton = byId<HTMLButtonElement>('download')

let opened: OpenedPdf | null = null
let plan: PlanResult = { ok: false, error: '' }

function showError(message: string): void {
  const target = opened ? workError : openError
  target.textContent = message
  target.hidden = false
}

function clearErrors(): void {
  openError.hidden = true
  workError.hidden = true
}

function currentMode(): SplitMode {
  const kind = (form.elements.namedItem('mode') as RadioNodeList).value
  if (kind === 'each') return { kind: 'each' }
  if (kind === 'ranges') return { kind: 'ranges', text: rangesText.value }
  return { kind: 'every', size: everySize.value.trim() === '' ? NaN : Number(everySize.value) }
}

function selectMode(kind: SplitMode['kind']): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${kind}"]`)
  if (radio) radio.checked = true
}

function updatePlan(): void {
  if (!opened) return
  plan = planSplit(currentMode(), opened.pageCount, opened.name)
  downloadButton.disabled = !plan.ok
  if (!plan.ok) {
    planError.textContent = plan.error
    planError.hidden = false
    previewCount.textContent = ''
    preview.replaceChildren()
    return
  }
  planError.hidden = true
  const n = plan.parts.length
  previewCount.textContent = `${n} ${n === 1 ? 'PDF' : 'PDFs'} in ${zipFileName(opened.name)}`
  preview.replaceChildren(
    ...plan.parts.map((part) => {
      const li = document.createElement('li')
      const name = document.createElement('span')
      name.className = 'part-name'
      name.textContent = part.fileName
      const range = document.createElement('span')
      range.className = 'part-range'
      range.textContent = describeRange(part)
      li.append(name, range)
      return li
    }),
  )
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
  updatePlan()
}

async function download(): Promise<void> {
  clearErrors()
  if (!opened || !plan.ok) return
  downloadButton.disabled = true
  try {
    const zip = await splitToZip(opened.doc, plan.parts)
    downloadFile(zip, zipFileName(opened.name), 'application/zip')
  } catch {
    showError('The split files could not be created.')
  } finally {
    downloadButton.disabled = !plan.ok
  }
}

form.addEventListener('change', updatePlan)
form.addEventListener('submit', (e) => e.preventDefault())
everySize.addEventListener('input', () => {
  selectMode('every')
  updatePlan()
})
rangesText.addEventListener('input', () => {
  selectMode('ranges')
  updatePlan()
})
everySize.addEventListener('focus', () => {
  selectMode('every')
  updatePlan()
})
rangesText.addEventListener('focus', () => {
  selectMode('ranges')
  updatePlan()
})
downloadButton.addEventListener('click', () => void download())

attachFileIntake({
  input: byId<HTMLInputElement>('file-input'),
  highlight: document.body,
  onFiles: ([file]) => void openFile(file),
})
