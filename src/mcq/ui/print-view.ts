// Print: Sheet identity, who is writing (a Class list, pasted names, numbers or a file), spares,
// Versions; downloads for the Answer sheets, the question booklets and the Memo; and a preview of
// the first sheet.
import { listClasses, MAX_ID_DIGITS, MIN_ID_DIGITS, type ClassList } from '../../shared/classes'
import { renderAnswerSheetsPdf, type IdentityMode } from '../../shared/omr'
import { loadPdf } from '../../shared/pdf/pdf-worker'
import { hasPrintedContent, missingMemo, type PrintSettings } from '../core/model'
import { safeFileName } from '../core/questions-csv'
import { printRun } from '../core/sheets'
import { versionLetters } from '../core/versions'
import { renderBookletPdf, renderMemoPdf } from '../pdf/booklet'
import { busy, clear, download, errorMessage, focusKey, h, MIME, plural, restoreFocus } from './dom'
import { learnersPanel } from './learners-panel'
import { update, workspace, type ChangeInfo } from './state'

const MODES: { mode: IdentityMode; title: string; text: string }[] = [
  {
    mode: 'named-qr',
    title: 'Named QR',
    text: 'A sheet per learner with their name and a QR code. Hand them out by name.',
  },
  {
    mode: 'id-qr',
    title: 'ID-only QR',
    text: 'A sheet per learner with only the Learner ID and a QR code. No names on paper.',
  },
  {
    mode: 'bubbled-id',
    title: 'Bubbled ID',
    text: 'One sheet for everyone: print or photocopy it. Learners fill in their Learner ID.',
  },
]

function setPrint(change: Partial<PrintSettings>): void {
  update((a) => ({ ...a, print: { ...a.print, ...change } }))
}

let classes: ClassList[] = []
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewRun = 0

async function renderPreview(canvasHost: HTMLElement): Promise<void> {
  const run = ++previewRun
  const { assessment: a, classList } = workspace()
  let spec
  try {
    spec = printRun(a, classList).specs[0]
  } catch (error) {
    clear(canvasHost, h('p', { class: 'empty', text: errorMessage(error) }))
    return
  }
  if (!spec) return
  const bytes = await renderAnswerSheetsPdf([{ ...spec, page: 1 }])
  const pdf = await loadPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    if (run !== previewRun) return
    const width = Math.min(460, canvasHost.clientWidth || 460)
    const base = page.getViewport({ scale: 1 })
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const viewport = page.getViewport({ scale: (width / base.width) * ratio })
    const canvas = h('canvas', {
      class: 'sheet-preview',
      'aria-label': 'Preview of the first answer sheet',
      role: 'img',
    })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    canvas.style.width = `${width}px`
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    if (run === previewRun) clear(canvasHost, canvas)
  } finally {
    await pdf.loadingTask.destroy()
  }
}

function schedulePreview(host: HTMLElement): void {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderPreview(host).catch(() => undefined), 250)
}

function modePanel(): HTMLElement {
  const { assessment: a } = workspace()
  const group = h('div', { class: 'mode-choices', role: 'radiogroup', 'aria-labelledby': 'mode-title' })
  for (const m of MODES) {
    const input = h('input', { type: 'radio', name: 'identity-mode', value: m.mode, checked: a.print.mode === m.mode })
    input.addEventListener('change', () => {
      const change: Partial<PrintSettings> = { mode: m.mode }
      if (m.mode === 'bubbled-id' && workspace().classList) change.idDigits = workspace().classList!.idDigits
      // A sheet per learner needs learners: "No list" only suits Bubbled ID.
      if (m.mode !== 'bubbled-id' && workspace().assessment.print.learnerSource === 'none')
        change.learnerSource = 'pasted'
      setPrint(change)
    })
    group.append(
      h(
        'label',
        { class: 'mode-choice' },
        input,
        h('span', { class: 'mode-text' }, h('strong', { text: m.title }), h('span', { text: m.text })),
      ),
    )
  }
  return h(
    'section',
    { class: 'panel' },
    h('h2', { id: 'mode-title', text: 'Sheet identity' }),
    h('p', {
      class: 'help',
      text: 'How each scanned sheet is matched to a learner. Mark with the same setting you printed with.',
    }),
    group,
  )
}

/** Spare sheets (QR modes), or the Learner ID digits and the number of sheets (Bubbled ID). */
function sheetControls(): HTMLElement[] {
  const { assessment: a, classList } = workspace()
  const p = a.print
  if (p.mode !== 'bubbled-id') {
    const spares = h('input', {
      type: 'number',
      min: 0,
      max: 99,
      step: 1,
      value: p.spares,
      inputmode: 'numeric',
      id: 'spares',
    })
    spares.addEventListener('change', () => {
      const n = Math.max(0, Math.min(99, Math.round(Number(spares.value) || 0)))
      spares.value = String(n)
      setPrint({ spares: n })
    })
    return [
      h('label', { class: 'field narrow' }, h('span', { text: 'Spare sheets' }), spares),
      h('p', {
        class: 'help grow',
        text: 'Spare sheets have a blank name line, for learners who join late. In Review you choose whose they are.',
      }),
    ]
  }
  const digits = h('select', { id: 'id-digits', disabled: Boolean(classList) })
  for (let d = MIN_ID_DIGITS; d <= MAX_ID_DIGITS; d++)
    digits.append(h('option', { value: d, text: String(d), selected: d === p.idDigits }))
  digits.addEventListener('change', () => setPrint({ idDigits: Number(digits.value) }))
  const copies = h('input', {
    type: 'number',
    min: 1,
    max: 999,
    step: 1,
    value: p.copies,
    inputmode: 'numeric',
    id: 'copies',
  })
  copies.addEventListener('change', () => {
    const n = Math.max(1, Math.min(999, Math.round(Number(copies.value) || 1)))
    copies.value = String(n)
    setPrint({ copies: n })
  })
  return [
    h('label', { class: 'field narrow' }, h('span', { text: 'Learner ID digits' }), digits),
    h('label', { class: 'field narrow' }, h('span', { text: 'Sheets' }), copies),
  ]
}

function versionsPanel(): HTMLElement | null {
  const { assessment: a } = workspace()
  if (a.versions.count < 2) return null
  const letters = versionLetters(a)
  const roundRobin = h('input', {
    type: 'radio',
    name: 'assign',
    value: 'round-robin',
    checked: a.print.assign === 'round-robin',
  })
  roundRobin.addEventListener('change', () => setPrint({ assign: 'round-robin' }))
  const single = h('input', { type: 'radio', name: 'assign', value: 'single', checked: a.print.assign === 'single' })
  single.addEventListener('change', () => setPrint({ assign: 'single' }))
  const which = h('select', { 'aria-label': 'Version for everyone' })
  for (const v of letters)
    which.append(h('option', { value: v, text: `Version ${v}`, selected: v === a.print.singleVersion }))
  which.addEventListener('change', () =>
    setPrint({ assign: 'single', singleVersion: which.value as PrintSettings['singleVersion'] }),
  )
  return h(
    'section',
    { class: 'panel' },
    h('h2', { text: 'Versions' }),
    h(
      'div',
      { class: 'stack-tight' },
      h(
        'label',
        { class: 'check' },
        roundRobin,
        ` Take turns down the class list (${letters.join(', ')}, ${letters.join(', ')}...)`,
      ),
      h('label', { class: 'check' }, single, ' Everyone gets ', which),
    ),
  )
}

function downloadsPanel(previewHost: HTMLElement): HTMLElement {
  const { assessment: a, classList } = workspace()
  const status = h('p', { class: 'status', role: 'status', hidden: true })
  let summary: string
  let canPrint = true
  try {
    const run = printRun(a, classList)
    const versions = Object.entries(run.perVersion).map(([v, n]) => `${n} Version ${v}`)
    summary = `${plural(run.specs.length, 'answer sheet')}${a.versions.count > 1 ? ` (${versions.join(', ')})` : ''}${run.spares ? `, including ${plural(run.spares, 'spare')}` : ''}. Each sheet is ${plural(Math.ceil(a.questions.length / 50), 'page')}.`
  } catch (error) {
    summary = errorMessage(error)
    canPrint = false
  }
  const missing = missingMemo(a.questions)
  const sheets = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Download answer sheets',
    disabled: !canPrint,
    id: 'download-sheets',
  })
  sheets.addEventListener('click', () =>
    busy(sheets, 'Making the PDF...', status, async () => {
      const { assessment, classList } = workspace()
      const bytes = await renderAnswerSheetsPdf(printRun(assessment, classList).specs)
      download(bytes, `${safeFileName(assessment.title)} answer sheets.pdf`, MIME.pdf)
    }),
  )
  const booklets = hasPrintedContent(a.questions)
    ? versionLetters(a).map((v) => {
        const b = h('button', {
          type: 'button',
          text: a.versions.count > 1 ? `Question booklet, Version ${v}` : 'Question booklet',
          'data-version': v,
        })
        b.addEventListener('click', () =>
          busy(b, 'Making the PDF...', status, async () => {
            const x = workspace().assessment
            download(
              await renderBookletPdf(x, v),
              `${safeFileName(x.title)} questions${x.versions.count > 1 ? ` Version ${v}` : ''}.pdf`,
              MIME.pdf,
            )
          }),
        )
        return b
      })
    : []
  const memo = h('button', { type: 'button', text: 'Memo', id: 'download-memo' })
  memo.addEventListener('click', () =>
    busy(memo, 'Making the PDF...', status, async () => {
      const x = workspace().assessment
      download(await renderMemoPdf(x), `${safeFileName(x.title)} memo.pdf`, MIME.pdf)
    }),
  )
  schedulePreview(previewHost)
  return h(
    'section',
    { class: 'panel' },
    h('h2', { text: 'Download' }),
    h('p', { class: canPrint ? 'summary' : 'warning', id: 'print-summary', text: summary }),
    missing.length
      ? h('p', {
          class: 'help',
          text: `The Memo is not complete (${plural(missing.length, 'question')} without an answer). You can print the sheets now and finish the Memo before marking.`,
        })
      : null,
    h('div', { class: 'actions' }, sheets, ...booklets, memo),
    hasPrintedContent(a.questions)
      ? null
      : h('p', {
          class: 'help',
          text: 'No question text or pictures: use your own question paper, with the options in the order you entered them. Add question text or pictures in Build to print a question booklet.',
        }),
    h('p', { class: 'help', text: 'Print at actual size (100%), not "fit to page". Black and white is fine.' }),
    status,
  )
}

async function render(root: HTMLElement): Promise<void> {
  try {
    classes = await listClasses()
  } catch {
    classes = []
  }
  const previewHost = h('div', { class: 'preview-host' })
  const focused = focusKey()
  clear(
    root,
    h(
      'div',
      { class: 'print-layout' },
      h(
        'div',
        { class: 'print-settings' },
        modePanel(),
        learnersPanel(classes, sheetControls(), () => void render(root)),
        versionsPanel(),
        downloadsPanel(previewHost),
      ),
      h(
        'aside',
        { class: 'panel print-preview', 'aria-label': 'Preview' },
        h('h2', { text: 'First sheet' }),
        previewHost,
      ),
    ),
  )
  restoreFocus(root, focused)
}

export const printStep = {
  show(root: HTMLElement) {
    void render(root)
  },
  refresh(root: HTMLElement, _info: ChangeInfo) {
    void render(root)
  },
}
