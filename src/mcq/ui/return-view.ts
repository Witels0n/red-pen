// Return: feedback slips for every learner, and each learner's marked answer sheet in a zip.
import { zipSync } from 'fflate'
import { safeFileName } from '../core/questions-csv'
import { readTemplates } from '../core/sheets'
import { renderFeedbackPdf, type SlipsPerPage } from '../pdf/feedback'
import { markedSheetFileName, renderMarkedSheetPdf, type MarkedSheetPage } from '../pdf/marked-sheets'
import { busy, clear, download, h, MIME, plural } from './dom'
import { heldScanCount, scanImage } from './session'
import { workspace, type ChangeInfo } from './state'

let perPage: SlipsPerPage = 2

/** Learners in name order (then Learner ID), as a teacher hands slips out. */
function inClassOrder() {
  const { marks, names, classList } = workspace()
  const order = new Map(classList?.learners.map((l, i) => [l.id, i]) ?? [])
  return marks
    .slice()
    .sort(
      (x, y) =>
        (order.get(x.learnerId) ?? 1e9) - (order.get(y.learnerId) ?? 1e9) || x.learnerId.localeCompare(y.learnerId),
    )
    .map((mark) => ({ mark, name: names.get(mark.learnerId) }))
}

function feedbackPanel(): HTMLElement {
  const status = h('p', { class: 'status', role: 'status', hidden: true })
  const choice = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Slips per page' })
  for (const n of [1, 2] as const) {
    const input = h('input', { type: 'radio', name: 'slips-per-page', value: n, checked: perPage === n })
    input.addEventListener('change', () => (perPage = n))
    choice.append(
      h('label', {}, input, h('span', { text: n === 1 ? 'One per page' : 'Two per A4 page (cut in half)' })),
    )
  }
  const button = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Download feedback slips',
    id: 'download-feedback',
  })
  button.addEventListener('click', () =>
    busy(button, 'Making the PDF...', status, async () => {
      const { assessment: a } = workspace()
      download(await renderFeedbackPdf(a, inClassOrder(), perPage), `${safeFileName(a.title)} feedback.pdf`, MIME.pdf)
    }),
  )
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'feedback-title' },
    h('h2', { id: 'feedback-title', text: 'Feedback slips' }),
    h('p', {
      class: 'help',
      text: 'A slip per learner with their score, their marks per Topic, the Topics to revise (under 50%) and the questions to look at again, numbered as on their own Version.',
    }),
    choice,
    h('div', { class: 'actions' }, button),
    status,
  )
}

function markedPanel(): HTMLElement {
  const { collation } = workspace()
  const status = h('p', { class: 'status', role: 'status', hidden: true })
  const withScans = collation.learners.filter(
    (l) => l.pageIds.length > 0 && heldScanCount(l.pageIds) === l.pageIds.length,
  )
  const button = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Download marked answer sheets (zip)',
    id: 'download-marked',
    disabled: withScans.length === 0,
  })
  button.addEventListener('click', () =>
    busy(button, 'Marking the sheets...', status, async () => {
      const { assessment: a, marks, names, classList, collation } = workspace()
      const templates = readTemplates(a, classList)
      const files: Record<string, Uint8Array> = {}
      const learners = collation.learners.filter(
        (l) => heldScanCount(l.pageIds) === l.pageIds.length && l.pageIds.length,
      )
      for (const [n, l] of learners.entries()) {
        button.textContent = `Marking sheet ${n + 1} of ${learners.length}...`
        const mark = marks.find((m) => m.learnerId === l.learnerId)!
        const pages: MarkedSheetPage[] = []
        for (const id of l.pageIds) {
          const scan = a.scans.find((p) => p.id === id)!
          pages.push({ scan, jpeg: new Uint8Array(await scanImage(id)!.arrayBuffer()) })
        }
        let name = markedSheetFileName(l.learnerId, names.get(l.learnerId))
        if (files[name]) name = name.replace(/ marked\.pdf$/, ` ${l.learnerId} marked.pdf`)
        files[name] = await renderMarkedSheetPdf(a, mark, pages, templates)
      }
      // PDFs are already compressed, so store them as they are.
      download(zipSync(files, { level: 0 }), `${safeFileName(a.title)} marked sheets.zip`, MIME.zip)
    }),
  )
  const missing = collation.learners.length - withScans.length
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'marked-title' },
    h('h2', { id: 'marked-title', text: 'Marked answer sheets' }),
    h('p', {
      class: 'help',
      text: "Each learner's own scanned sheet with a tick or a cross on every answer, the right answer circled where they got it wrong, and the score. One PDF per learner, named after them, in a zip.",
    }),
    h('div', { class: 'actions' }, button),
    missing
      ? h('p', {
          class: 'warning',
          text: `${plural(missing, 'learner')} ${missing === 1 ? 'has' : 'have'} no scan in this session (scans are not saved after the page closes), so their sheets are left out. Upload the scans again on the Mark step to include them.`,
        })
      : null,
    status,
  )
}

function render(target: HTMLElement): void {
  const { marks, assessment: a } = workspace()
  if (marks.length === 0) {
    clear(
      target,
      h(
        'section',
        { class: 'panel' },
        h('h2', { text: 'Return' }),
        h(
          'p',
          { class: 'empty' },
          'Nothing to return yet. ',
          h('a', { href: `#a/${encodeURIComponent(a.id)}/mark`, text: 'Scan the answer sheets' }),
          ' first.',
        ),
      ),
    )
    return
  }
  clear(target, feedbackPanel(), markedPanel())
}

export const returnStep = {
  show: render,
  refresh(target: HTMLElement, _info: ChangeInfo) {
    render(target)
  },
}
