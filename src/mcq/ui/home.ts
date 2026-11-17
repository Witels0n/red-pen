// The list of saved Assessments: open, duplicate, download as a file, delete; new and import.
import { getClass, listClasses } from '../../shared/classes'
import { assessmentFileName, assessmentFromFile, assessmentToFile } from '../core/assessment-file'
import { usablePages } from '../core/marking'
import { duplicateAssessment, newAssessment, type Assessment } from '../core/model'
import { assessmentCode } from '../core/sheets'
import { deleteAssessment, getAssessment, listAssessments, saveAssessment } from '../storage'
import { changedWhen, clear, confirmInPage, download, el, errorMessage, h, MIME, plural, showMessage } from './dom'

const list = el<HTMLUListElement>('assessment-list')
const empty = el('no-assessments')
const homeError = el('home-error')

function go(a: Assessment, step = 'build'): void {
  location.hash = `#a/${encodeURIComponent(a.id)}/${step}`
}

export async function exportAssessmentFile(a: Assessment): Promise<void> {
  const linked = a.print.learnerSource === 'class' && a.print.classId
  const className = linked ? (await getClass(a.print.classId!).catch(() => undefined))?.name : undefined
  download(assessmentToFile(a, className), assessmentFileName(a), MIME.json)
}

function card(a: Assessment): HTMLLIElement {
  const learners = new Set(
    usablePages(a)
      .map((p) => p.learnerId ?? p.read.learnerId)
      .filter(Boolean),
  ).size
  const meta = [
    plural(a.questions.length, 'question'),
    ...(a.versions.count > 1 ? [plural(a.versions.count, 'Version')] : []),
    learners ? `${plural(learners, 'learner')} marked` : 'not marked yet',
    `changed ${changedWhen(a.updatedAt)}`,
  ].join(' · ')
  const item = h('li', { class: 'card' })
  const actions = h(
    'div',
    { class: 'card-actions' },
    h('button', { type: 'button', class: 'small', text: 'Duplicate', onclick: () => void duplicate(a) }),
    h('button', {
      type: 'button',
      class: 'small',
      text: 'Download file',
      onclick: () => void exportAssessmentFile(a),
    }),
    h('button', {
      type: 'button',
      class: 'small danger',
      text: 'Delete',
      'aria-label': `Delete ${a.title}`,
      onclick: async () => {
        const ok = await confirmInPage(
          item,
          `Delete "${a.title}" and its results from this device? This cannot be undone. Download the Assessment file first if you may need it.`,
          'Delete',
        )
        if (!ok) return
        await deleteAssessment(a.id)
        await showHome()
      },
    }),
  )
  item.append(
    h(
      'div',
      { class: 'card-main' },
      h('h3', { class: 'card-title' }, h('a', { href: `#a/${encodeURIComponent(a.id)}/build`, text: a.title })),
      h('p', { class: 'meta', text: meta }),
      h('p', { class: 'meta code', text: `Code ${assessmentCode(a)}` }),
    ),
    actions,
  )
  return item
}

async function duplicate(a: Assessment): Promise<void> {
  const copy = await saveAssessment(duplicateAssessment(a))
  await showHome()
  showMessage(homeError, '')
  list
    .querySelector(`a[href="#a/${encodeURIComponent(copy.id)}/build"]`)
    ?.closest('li')
    ?.classList.add('fresh')
}

export async function showHome(): Promise<void> {
  showMessage(homeError, '')
  try {
    const all = await listAssessments()
    clear(list, ...all.map(card))
    empty.hidden = all.length > 0
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
}

async function importFile(file: File): Promise<void> {
  showMessage(homeError, '')
  const result = assessmentFromFile(await file.text())
  if (!result.ok) {
    showMessage(homeError, result.problems.join('\n'))
    return
  }
  const a = result.assessment
  const existing = await getAssessment(a.id)
  if (existing) {
    const ok = await confirmInPage(
      el('home-view').querySelector('.intro-actions')!.parentElement!,
      `"${existing.title}" is already on this device. Replace it with the one in the file?`,
      'Replace',
    )
    if (!ok) return
  }
  await saveAssessment(a, Math.max(Date.now(), a.updatedAt))
  go(a)
}

el('new-assessment').addEventListener('click', async () => {
  try {
    const fresh = newAssessment('Untitled assessment', 20)
    // With Class lists on this device, start from one; otherwise from pasted names.
    const hasClasses = (await listClasses().catch(() => [])).length > 0
    fresh.print.learnerSource = hasClasses ? 'class' : 'pasted'
    const a = await saveAssessment(fresh)
    go(a)
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
})

const fileInput = el<HTMLInputElement>('assessment-file-input')
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) void importFile(file).catch((error) => showMessage(homeError, errorMessage(error)))
})
