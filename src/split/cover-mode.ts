// The "At cover sheets" mode of Split a PDF: runs the page scan, offers the saved Class lists for
// names, and turns both into a plan. main.ts shows the plan with the other modes' preview.
import { listClasses, type ClassList } from '../shared/classes'
import { byId } from '../shared/pdf/tool-page'
import { planCoverSplit, type CoverPlanResult, type ScannedPage } from './cover-plan'
import { scanForCovers, type CoverScan } from './cover-scan'

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning'; scan: CoverScan; done: number; total: number }
  | { status: 'done'; pages: ScannedPage[] }
  | { status: 'cancelled' }
  | { status: 'failed' }

/** What the preview shows in this mode: a plan, or why there is none yet. */
export type CoverView = { kind: 'plan'; result: CoverPlanResult } | { kind: 'waiting' }

export interface CoverMode {
  /** Shows or hides this mode's options. */
  setActive(active: boolean): void
  /** Forgets the scan, for example when another PDF is opened. */
  reset(): void
  /** The current plan for `bytes`, starting the scan the first time it is needed. */
  view(bytes: Uint8Array): CoverView
}

const NO_CLASS = ''

function learners(n: number): string {
  return `${n} ${n === 1 ? 'learner' : 'learners'}`
}

/** How many of the scanned Cover sheets belong to learners on `list`. */
function matches(list: ClassList, pages: readonly ScannedPage[]): number {
  const ids = new Set(list.learners.map((l) => Number(l.id)))
  return pages.filter((p) => p.kind === 'cover' && ids.has(Number(p.learnerId))).length
}

/** `onChange` is called whenever the plan may have changed (scan progress, a choice, classes loaded). */
export function createCoverMode(onChange: () => void): CoverMode {
  const options = byId('cover-options')
  const status = byId('cover-status')
  const progress = byId<HTMLProgressElement>('cover-progress')
  const cancelButton = byId<HTMLButtonElement>('cover-cancel')
  const rescanButton = byId<HTMLButtonElement>('cover-rescan')
  const classField = byId('cover-class-field')
  const classSelect = byId<HTMLSelectElement>('cover-class')
  const noClasses = byId('cover-no-classes')
  const exclude = byId<HTMLInputElement>('cover-exclude')

  let state: ScanState = { status: 'idle' }
  let classes: ClassList[] | null = null
  /** True once the teacher picks a class themselves, so the best match no longer replaces it. */
  let chosenByTeacher = false

  async function loadClasses(): Promise<void> {
    try {
      classes = await listClasses()
    } catch {
      // Storage refused (for example a private window): carry on with Learner IDs.
      classes = []
    }
    const none = new Option('None: name the files by Learner ID', NO_CLASS)
    classSelect.replaceChildren(
      none,
      ...classes.map((c) => new Option(`${c.name} (${learners(c.learners.length)})`, c.id)),
    )
    classField.hidden = classes.length === 0
    noClasses.hidden = classes.length > 0
    pickBestClass()
    onChange()
  }

  function pickBestClass(): void {
    if (chosenByTeacher || !classes || state.status !== 'done') return
    const pages = state.pages
    let best: ClassList | undefined
    let bestCount = 0
    for (const c of classes) {
      const n = matches(c, pages)
      if (n > bestCount) [best, bestCount] = [c, n]
    }
    classSelect.value = best?.id ?? NO_CLASS
  }

  function start(bytes: Uint8Array): void {
    const scan = scanForCovers(bytes, (done, total) => {
      if (state.status !== 'scanning' || state.scan !== scan) return
      state = { status: 'scanning', scan, done, total }
      onChange()
    })
    state = { status: 'scanning', scan, done: 0, total: 0 }
    scan.result.then(
      (pages) => {
        if (state.status !== 'scanning' || state.scan !== scan) return
        state = pages ? { status: 'done', pages } : { status: 'cancelled' }
        pickBestClass()
        onChange()
      },
      () => {
        if (state.status !== 'scanning' || state.scan !== scan) return
        state = { status: 'failed' }
        onChange()
      },
    )
  }

  function render(): void {
    const scanning = state.status === 'scanning'
    cancelButton.hidden = !scanning
    progress.hidden = !scanning
    rescanButton.hidden = state.status !== 'cancelled' && state.status !== 'failed'
    if (state.status === 'scanning') {
      progress.max = Math.max(1, state.total)
      progress.value = state.done
      status.textContent =
        state.total === 0
          ? 'Looking for Cover sheets...'
          : `Looking for Cover sheets: page ${Math.min(state.done + 1, state.total)} of ${state.total}`
    } else if (state.status === 'done') {
      const n = state.pages.filter((p) => p.kind === 'cover').length
      status.textContent = `Found ${n} Cover ${n === 1 ? 'sheet' : 'sheets'} in ${state.pages.length} ${state.pages.length === 1 ? 'page' : 'pages'}.`
    } else if (state.status === 'cancelled') {
      status.textContent = 'Stopped before every page was checked.'
    } else if (state.status === 'failed') {
      status.textContent = 'The pages could not be checked for Cover sheets.'
    } else {
      status.textContent = ''
    }
  }

  let lastBytes: Uint8Array | null = null

  cancelButton.addEventListener('click', () => {
    if (state.status !== 'scanning') return
    state.scan.cancel()
    state = { status: 'cancelled' }
    onChange()
  })
  rescanButton.addEventListener('click', () => {
    if (!lastBytes) return
    start(lastBytes)
    onChange()
  })
  classSelect.addEventListener('change', () => {
    chosenByTeacher = true
    onChange()
  })
  exclude.addEventListener('change', onChange)

  return {
    setActive(active) {
      options.hidden = !active
    },
    reset() {
      if (state.status === 'scanning') state.scan.cancel()
      state = { status: 'idle' }
      chosenByTeacher = false
      lastBytes = null
    },
    view(bytes) {
      if (classes === null) {
        classes = []
        void loadClasses()
      }
      lastBytes = bytes
      if (state.status === 'idle') start(bytes)
      render()
      if (state.status !== 'done') return { kind: 'waiting' }
      const list = classes.find((c) => c.id === classSelect.value)
      return {
        kind: 'plan',
        result: planCoverSplit({ pages: state.pages, includeCovers: !exclude.checked, classList: list }),
      }
    },
  }
}
