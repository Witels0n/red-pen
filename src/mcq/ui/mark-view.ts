// Mark: upload copier PDFs and photos, read them in the worker with progress (and Cancel), and list
// every page read with whose it is and what needs a look.
import { attachFileIntake } from '../../shared/pdf/file-intake'
import { pageLearner, pageVersion } from '../core/marking'
import type { ScannedPage } from '../core/model'
import { readTemplates } from '../core/sheets'
import { clear, confirmInPage, el, h, plural } from './dom'
import { forgetAllScans, forgetScan, readFiles, scanImage, type ReadJob, type ReadProgress } from './session'
import { hasWorkspace, update, workspace, type ChangeInfo } from './state'

const ORIGIN = 'mark'

let job: ReadJob | null = null
let progress: ReadProgress | null = null
let lastResult = ''
let root: HTMLElement | null = null

export function learnerLabel(id: string | undefined, names: ReadonlyMap<string, string>): string {
  if (!id) return 'Unknown learner'
  const name = names.get(id)
  return name ? `${name} (${id})` : `Learner ID ${id}`
}

function statusOf(page: ScannedPage, reviewPages: ReadonlySet<string>): { text: string; cls: string } {
  if (page.ignored) return { text: 'Set aside', cls: 'muted' }
  if (!page.read.ok || page.read.kind === 'cover')
    return { text: page.read.problems[0] ?? 'Could not be read.', cls: 'bad' }
  if (reviewPages.has(page.id)) return { text: 'Needs review', cls: 'warn' }
  return { text: 'Read', cls: 'good' }
}

function progressBox(): HTMLElement {
  const box = h('div', { class: 'progress-box', id: 'read-progress', role: 'status', 'aria-live': 'polite' })
  if (job && progress) {
    const bar = h('progress', {
      max: Math.max(1, progress.total),
      value: progress.done,
      'aria-label': 'Reading sheets',
    })
    box.append(
      h('p', {
        class: 'progress-text',
        text: `Reading page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${progress.file ? ` (${progress.file})` : ''}...`,
      }),
      bar,
      h('button', { type: 'button', class: 'small', text: 'Cancel', id: 'cancel-read', onclick: () => job?.cancel() }),
    )
  } else if (lastResult) {
    box.append(h('p', { class: 'progress-text', text: lastResult }))
  }
  return box
}

function updateProgress(): void {
  root?.querySelector('#read-progress')?.replaceWith(progressBox())
}

export function startReading(files: File[]): void {
  if (job || files.length === 0 || !hasWorkspace()) return
  const w = workspace()
  const templates = readTemplates(w.assessment, w.classList)
  let added = 0
  lastResult = ''
  progress = { file: '', done: 0, total: files.length }
  job = readFiles(
    files,
    templates,
    (page) => {
      added++
      update((a) => ({ ...a, scans: [...a.scans, page] }), { origin: ORIGIN })
      renderPages()
    },
    (p) => {
      progress = p
      updateProgress()
    },
  )
  updateProgress()
  void job.finished.then(({ cancelled }) => {
    job = null
    progress = null
    const left = hasWorkspace() ? workspace().collation.review.length : 0
    lastResult = `${cancelled ? 'Stopped. ' : ''}${plural(added, 'page')} read.${left ? ` ${plural(left, 'item')} to review.` : ''}`
    updateProgress()
    renderPages()
  })
}

function pagesTable(): HTMLElement {
  const { assessment: a, collation, names } = workspace()
  const reviewPages = new Set(collation.review.flatMap((r) => (r.kind === 'duplicate' ? r.pageIds : [r.pageId])))
  if (a.scans.length === 0) return h('p', { class: 'empty', text: 'No sheets yet.' })
  const rows = a.scans.map((p, i) => {
    const s = statusOf(p, reviewPages)
    const remove = h('button', {
      type: 'button',
      class: 'small icon',
      'aria-label': `Remove ${p.fileName} page ${p.filePage}`,
      title: 'Remove',
      text: '✕',
      onclick: () => {
        forgetScan(p.id)
        update((x) => ({ ...x, scans: x.scans.filter((s) => s.id !== p.id) }), { origin: ORIGIN })
        renderPages()
      },
    })
    const ok = p.read.ok && p.read.kind !== 'cover'
    return h(
      'tr',
      {},
      h('td', { class: 'num', text: String(i + 1) }),
      h(
        'td',
        { class: 'file' },
        h('span', { text: p.fileName }),
        /\.pdf$/i.test(p.fileName) ? h('span', { class: 'meta', text: ` p. ${p.filePage}` }) : null,
      ),
      h('td', { text: ok ? learnerLabel(pageLearner(p), names) : '' }),
      h('td', { text: ok ? (pageVersion(p) ?? '?') : '' }),
      h('td', { text: ok ? `${p.read.page} of ${p.read.pages}` : '' }),
      h(
        'td',
        {},
        h('span', { class: `chip ${s.cls}`, text: s.text }),
        ok && !scanImage(p.id) ? h('span', { class: 'meta', text: ' (scan not in this session)' }) : null,
      ),
      h('td', { class: 'num' }, remove),
    )
  })
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data-table pages-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...['#', 'File', 'Learner', 'Version', 'Page', 'Status', ''].map((t) => h('th', { scope: 'col', text: t })),
        ),
      ),
      h('tbody', {}, rows),
    ),
  )
}

function renderPages(): void {
  if (!root || !hasWorkspace()) return
  const host = root.querySelector('#pages-host')
  if (!host) return
  const { assessment: a, collation, marks } = workspace()
  const read = a.scans.filter((p) => p.read.ok && p.read.kind !== 'cover').length
  const unreadable = collation.unreadable.length
  const toReview = collation.review.length
  const summary = h(
    'p',
    { class: 'summary', id: 'pages-summary' },
    `${plural(read, 'page')} read, ${plural(marks.length, 'learner')} marked`,
    toReview ? `, ${toReview} to review` : '',
    unreadable ? `, ${unreadable} could not be read` : '',
    '.',
  )
  const actions = h(
    'div',
    { class: 'toolbar' },
    summary,
    h('span', { class: 'spacer' }),
    toReview
      ? h('a', { class: 'button primary', href: `#a/${encodeURIComponent(a.id)}/review`, text: `Review ${toReview}` })
      : marks.length
        ? h('a', { class: 'button primary', href: `#a/${encodeURIComponent(a.id)}/results`, text: 'See the results' })
        : null,
    a.scans.length
      ? h('button', {
          type: 'button',
          class: 'danger',
          text: 'Remove all',
          onclick: async () => {
            const ok = await confirmInPage(
              host as HTMLElement,
              `Remove all ${plural(a.scans.length, 'page')} and the Review decisions? The results go too.`,
              'Remove all',
            )
            if (!ok) return
            forgetAllScans()
            update((x) => ({ ...x, scans: [] }), { origin: ORIGIN })
            renderPages()
          },
        })
      : null,
  )
  clear(host as HTMLElement, actions, pagesTable())
}

function render(target: HTMLElement): void {
  root = target
  const { assessment: a } = workspace()
  const zone = h(
    'div',
    { class: 'drop-zone', id: 'drop-zone' },
    h(
      'p',
      { class: 'drop-title' },
      h('label', { class: 'button primary', for: 'scan-input', text: 'Choose PDFs or photos' }),
      h('span', { text: ' or drop them anywhere on this page' }),
    ),
    h('p', {
      class: 'help',
      text: 'Copier scans (PDF, any number of pages) and phone photos (JPG or PNG) can be mixed, in any order. Page 2 of a long test is matched to page 1 by its code.',
    }),
  )
  clear(
    target,
    h(
      'section',
      { class: 'panel', 'aria-labelledby': 'scan-title' },
      h('h2', { id: 'scan-title', text: 'Scan the answer sheets' }),
      zone,
      progressBox(),
      h('p', {
        class: 'privacy-note small',
        text: 'Scans are read in this browser and kept only while this page is open. The reads and your Review decisions are saved with the assessment; the scan images are not.',
      }),
      a.questions.some((q) => q.answer === null)
        ? h('p', {
            class: 'help',
            text: 'Some questions have no Memo answer yet: they are left out of the marks until you set them in Build.',
          })
        : null,
    ),
    h(
      'section',
      { class: 'panel', 'aria-labelledby': 'pages-title' },
      h('h2', { id: 'pages-title', text: 'Sheets' }),
      h('div', { id: 'pages-host' }),
    ),
  )
  renderPages()
}

/** Connects the file picker and drag and drop once; files dropped on any step start reading. */
export function setUpScanIntake(): void {
  const input = el<HTMLInputElement>('scan-input')
  attachFileIntake({
    input,
    highlight: document.body,
    onFiles: (files) => {
      if (!hasWorkspace()) return
      const a = workspace().assessment
      if (!location.hash.endsWith('/mark')) location.hash = `#a/${encodeURIComponent(a.id)}/mark`
      startReading(files)
    },
  })
}

export const markStep = {
  show: render,
  refresh(target: HTMLElement, _info: ChangeInfo) {
    root = target
    renderPages()
  },
}
