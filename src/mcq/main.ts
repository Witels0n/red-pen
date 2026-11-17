import './styles.css'
import { registerOffline } from '../shared/pwa'
import { mountSiteHeader } from '../shared/site-header'
import { assessmentCode } from './core/sheets'
import {
  listAssessments,
  memoryAssessments,
  setAssessmentStorage,
  AssessmentStorageError,
  getAssessment,
} from './storage'
import { el, plural, showMessage } from './ui/dom'
import { exportAssessmentFile, showHome } from './ui/home'
import { resetLearnerDrafts } from './ui/learners-panel'
import { STEPS, type StepId, stepView } from './ui/steps'
import { closeWorkspace, flushSave, hasWorkspace, onChange, onSaveState, openWorkspace, workspace } from './ui/state'

registerOffline(mountSiteHeader({ toolName: 'MCQ assessments' }))

const homeView = el('home-view')
const workView = el('work-view')
let activeStep: StepId = 'build'

function stepFromHash(): { id: string; step: StepId } | null {
  const m = /^#a\/([^/]+)(?:\/([a-z]+))?$/.exec(location.hash)
  if (!m) return null
  const step = (STEPS as readonly string[]).includes(m[2] ?? '') ? (m[2] as StepId) : 'build'
  return { id: decodeURIComponent(m[1]), step }
}

function renderHead(): void {
  const { assessment: a, collation } = workspace()
  el('work-title').textContent = a.title
  el('work-meta').textContent = [
    plural(a.questions.length, 'question'),
    a.versions.count > 1 ? plural(a.versions.count, 'Version') : 'One Version',
    `Code ${assessmentCode(a)}`,
  ].join(' · ')
  const left = collation.review.length
  const badge = el('review-badge')
  badge.textContent = String(left)
  badge.hidden = left === 0
  badge.setAttribute('aria-label', `${left} to review`)
}

function selectTab(step: StepId): void {
  activeStep = step
  for (const id of STEPS) {
    const tab = el(`tab-${id}`)
    const selected = id === step
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    el(`step-${id}`).hidden = !selected
  }
  el(`tab-${step}`).scrollIntoView({ block: 'nearest', inline: 'nearest' })
  stepView(step).show(el(`step-${step}`))
}

let routing = Promise.resolve()

/** The page's own title, from mcq/index.html, restored on the list of assessments. */
const HOME_TITLE = document.title

function route(): Promise<void> {
  routing = routing.then(async () => {
    const target = stepFromHash()
    if (!target) {
      await flushSave()
      closeWorkspace()
      workView.hidden = true
      homeView.hidden = false
      document.title = HOME_TITLE
      await showHome()
      return
    }
    if (!hasWorkspace() || workspace().assessment.id !== target.id) {
      const a = await getAssessment(target.id).catch(() => undefined)
      if (!a) {
        history.replaceState(null, '', location.pathname)
        return route()
      }
      await openWorkspace(a)
      resetLearnerDrafts()
      window.scrollTo(0, 0)
    }
    homeView.hidden = true
    workView.hidden = false
    document.title = `${workspace().assessment.title} · MCQ assessments · Red Pen`
    renderHead()
    selectTab(target.step)
  })
  return routing
}

// Tabs: click, or arrow keys between tabs (the ARIA tabs pattern).
const tabs = el('step-tabs')
tabs.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]')
  if (tab) location.hash = `#a/${encodeURIComponent(workspace().assessment.id)}/${tab.dataset.step}`
})
tabs.addEventListener('keydown', (e) => {
  const i = STEPS.indexOf(activeStep)
  const next =
    e.key === 'ArrowRight'
      ? i + 1
      : e.key === 'ArrowLeft'
        ? i - 1
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? STEPS.length - 1
            : null
  if (next === null) return
  e.preventDefault()
  const step = STEPS[(next + STEPS.length) % STEPS.length]
  location.hash = `#a/${encodeURIComponent(workspace().assessment.id)}/${step}`
  el(`tab-${step}`).focus()
})

onChange((_, info) => {
  renderHead()
  if (info.origin !== activeStep) stepView(activeStep).refresh?.(el(`step-${activeStep}`), info)
})

el('export-assessment').addEventListener('click', () => {
  void flushSave().then(() => exportAssessmentFile(workspace().assessment))
})

const saveState = el('save-state')
onSaveState((state, message) => {
  saveState.className = `save-state ${state}`
  saveState.textContent =
    state === 'saving' ? 'Saving...' : state === 'saved' ? 'Saved on this device' : `Not saved: ${message}`
})

/** When this browser refuses IndexedDB, keep working in memory and say so plainly. */
async function checkStorage(): Promise<void> {
  try {
    await listAssessments()
  } catch (error) {
    if (!(error instanceof AssessmentStorageError)) throw error
    setAssessmentStorage(memoryAssessments())
    showMessage(
      el('storage-error'),
      `${error.message} You can still work now, but assessments will be gone when you close this page. Download the Assessment file to keep one.`,
    )
  }
}

window.addEventListener('hashchange', () => void route())
void checkStorage().then(route)
