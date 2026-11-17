import { byId, pages, startPdfTool } from '../shared/pdf/tool-page'
import { downloadFile } from '../shared/pdf/download'
import { attachFileIntake } from '../shared/pdf/file-intake'
import { openErrorMessage, openPdfFile, type OpenedPdf } from '../shared/pdf/open-pdf'
import { createCoverMode } from './cover-mode'
import type { CoverPart } from './cover-plan'
import { planSplit, zipFileName, type PlanResult, type PlannedPart, type SplitMode } from './plan'
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
const planWarnings = byId<HTMLUListElement>('plan-warnings')
const coverMode = createCoverMode(() => updatePlan())

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

function selectedKind(): SplitMode['kind'] | 'covers' {
  return (form.elements.namedItem('mode') as RadioNodeList).value as SplitMode['kind'] | 'covers'
}

function currentMode(): SplitMode {
  const kind = selectedKind()
  if (kind === 'each') return { kind: 'each' }
  if (kind === 'ranges') return { kind: 'ranges', text: rangesText.value }
  return { kind: 'every', size: everySize.value.trim() === '' ? NaN : Number(everySize.value) }
}

function selectMode(kind: SplitMode['kind']): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${kind}"]`)
  if (radio) radio.checked = true
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

function previewItem(part: PlannedPart | CoverPart): HTMLLIElement {
  const li = document.createElement('li')
  const label = span('part-label', '')
  label.append(span('part-name', part.fileName))
  if ('unassigned' in part && part.unassigned) {
    li.className = 'unassigned'
    label.append(' ', span('part-flag', 'Unassigned'))
  } else if ('learnerId' in part && part.learnerId) {
    label.append(' ', span('part-id', `Learner ID ${part.learnerId}`))
  }
  li.append(label, span('part-range', describeRange(part)))
  return li
}

function showWarnings(warnings: readonly string[]): void {
  planWarnings.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li')
      li.textContent = w
      return li
    }),
  )
  planWarnings.hidden = warnings.length === 0
}

function updatePlan(): void {
  if (!opened) return
  const covers = selectedKind() === 'covers'
  coverMode.setActive(covers)
  let warnings: readonly string[] = []
  if (covers) {
    const view = coverMode.view(opened.bytes)
    if (view.kind === 'waiting') {
      plan = { ok: false, error: '' }
      downloadButton.disabled = true
      planError.hidden = true
      showWarnings([])
      previewCount.textContent = ''
      preview.replaceChildren()
      return
    }
    plan = view.result
    if (view.result.ok) warnings = view.result.warnings
  } else {
    plan = planSplit(currentMode(), opened.pageCount, opened.name)
  }
  downloadButton.disabled = !plan.ok
  showWarnings(warnings)
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
  preview.replaceChildren(...plan.parts.map(previewItem))
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
  coverMode.reset()
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
