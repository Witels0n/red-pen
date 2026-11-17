// Review: a queue of what the reader was unsure about, each shown beside the straightened scan,
// with one-key decisions. Uncertain answers, unknown or spare sheets, duplicates and Versions.
import { layoutSheet, MM, questionRect, type SheetVersion } from '../../shared/omr'
import { pageLearner, pageVersion, reviewKey, type ReviewItem } from '../core/marking'
import { letter, type Decision, type ScannedPage } from '../core/model'
import { readTemplates } from '../core/sheets'
import { versionLetters } from '../core/versions'
import { clear, h, plural } from './dom'
import { learnerLabel } from './mark-view'
import { cropScan } from './session'
import { update, workspace, type ChangeInfo } from './state'

const ORIGIN = 'review'

let currentKey: string | null = null
let root: HTMLElement | null = null

function items(): ReviewItem[] {
  return workspace().collation.review
}

function page(id: string): ScannedPage | undefined {
  return workspace().assessment.scans.find((p) => p.id === id)
}

function changePage(id: string, fn: (p: ScannedPage) => ScannedPage): void {
  const before = items()
  const at = Math.max(
    0,
    before.findIndex((i) => reviewKey(i) === currentKey),
  )
  update((a) => ({ ...a, scans: a.scans.map((p) => (p.id === id ? fn(p) : p)) }), { origin: ORIGIN })
  advance(at)
}

function changePages(fn: (p: ScannedPage) => ScannedPage): void {
  const before = items()
  const at = Math.max(
    0,
    before.findIndex((i) => reviewKey(i) === currentKey),
  )
  update((a) => ({ ...a, scans: a.scans.map(fn) }), { origin: ORIGIN })
  advance(at)
}

/** After a decision: stay at the same place in the queue, which now holds the next item. */
function advance(at: number): void {
  const after = items()
  const stillThere = after.find((i) => reviewKey(i) === currentKey)
  currentKey = stillThere
    ? reviewKey(after[Math.min(at + 1, after.length - 1)])
    : after.length
      ? reviewKey(after[Math.min(at, after.length - 1)])
      : null
  render()
  root?.querySelector<HTMLElement>('#review-card')?.focus({ preventScroll: true })
}

function decide(item: Extract<ReviewItem, { kind: 'answer' }>, decision: Decision): void {
  changePage(item.pageId, (p) => ({ ...p, decisions: { ...p.decisions, [String(item.index)]: decision } }))
}

function move(by: number): void {
  const list = items()
  if (!list.length) return
  const i = list.findIndex((x) => reviewKey(x) === currentKey)
  currentKey = reviewKey(list[(Math.max(0, i) + by + list.length) % list.length])
  render()
  root?.querySelector<HTMLElement>('#review-card')?.focus({ preventScroll: true })
}

function readText(read: ScannedPage['read']['answers'][number]): string {
  if (read === null) return 'blank'
  if (read === 'multiple') return 'more than one circle'
  return letter(read)
}

/** A layout rectangle of the page to show, filled in once the crop is drawn. */
function crop(
  pageId: string,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  width = 560,
): HTMLElement {
  const box = h('div', { class: 'crop', role: 'img', 'aria-label': label })
  void cropScan(pageId, rect, width).then((canvas) => {
    if (canvas) {
      canvas.className = 'crop-canvas'
      clear(box, canvas)
    } else {
      clear(
        box,
        h('p', {
          class: 'crop-missing',
          text: 'The scan of this page is not in this session (scans are not saved). Upload it again on the Mark step to see it, or decide from the read.',
        }),
      )
    }
  })
  return box
}

function templateFor(p: ScannedPage) {
  const w = workspace()
  const version = pageVersion(p)
  const templates = readTemplates(w.assessment, w.classList)
  return templates.find((t) => t.version === version) ?? templates[0]
}

const HEADER_RECT = { x: 14 * MM, y: 14 * MM, w: 182 * MM, h: 44 * MM }
const BUBBLED_RECT = { x: 14 * MM, y: 20 * MM, w: 120 * MM, h: 124 * MM }

function headerRect(p: ScannedPage) {
  return workspace().assessment.print.mode === 'bubbled-id' && p.read.idSource === 'bubbles'
    ? BUBBLED_RECT
    : HEADER_RECT
}

function key(k: string): HTMLElement {
  return h('kbd', { text: k })
}

function answerCard(item: Extract<ReviewItem, { kind: 'answer' }>): HTMLElement[] {
  const p = page(item.pageId)!
  const { names } = workspace()
  const template = templateFor(p)
  const geometry = layoutSheet({ ...template, page: p.read.page })[0]
  const q = geometry.questions.find((g) => g.index === p.read.questionStart + item.index)
  const options = q?.bubbles.length ?? 4
  const version = pageVersion(p)
  const rect = q ? questionRect(q, 3 * MM) : HEADER_RECT
  const choices = Array.from({ length: options }, (_, k) =>
    h(
      'button',
      {
        type: 'button',
        class: `choice${item.read === k ? ' is-read' : ''}`,
        'data-choice': letter(k),
        onclick: () => decide(item, k),
      },
      letter(k),
    ),
  )
  return [
    h(
      'div',
      { class: 'card-head' },
      h('h3', {
        text: `Question ${item.printedNumber}${version && workspace().assessment.versions.count > 1 ? `, Version ${version}` : ''}`,
      }),
      h('p', { class: 'meta', text: learnerLabel(pageLearner(p), names) }),
    ),
    crop(p.id, rect, `Question ${item.printedNumber} as scanned`),
    h('p', { class: 'read-line' }, 'Read as ', h('strong', { text: readText(item.read) }), `. ${item.reason}`),
    h(
      'div',
      { class: 'choices', role: 'group', 'aria-label': 'Decide this answer' },
      choices,
      h(
        'button',
        {
          type: 'button',
          class: `choice${item.read === null ? ' is-read' : ''}`,
          'data-choice': 'blank',
          onclick: () => decide(item, 'blank'),
        },
        key('N'),
        ' Blank',
      ),
      h(
        'button',
        {
          type: 'button',
          class: `choice wide${item.read === 'multiple' ? ' is-read' : ''}`,
          'data-choice': 'multiple',
          onclick: () => decide(item, 'multiple'),
        },
        key('M'),
        ' More than one: wrong',
      ),
    ),
    typeof item.read === 'number'
      ? h(
          'p',
          { class: 'help' },
          'Press ',
          key('Enter'),
          ` to keep ${letter(item.read)}. The letters are as printed on this learner's sheet.`,
        )
      : h('p', { class: 'help', text: "The letters are as printed on this learner's sheet." }),
  ]
}

function learnerPicker(current: string | undefined, onPick: (id: string) => void, label: string): HTMLElement {
  const { classList, marks } = workspace()
  const marked = new Set(marks.map((m) => m.learnerId))
  if (classList && classList.learners.length) {
    const select = h('select', { 'aria-label': label }, h('option', { value: '', text: 'Choose a learner' }))
    for (const l of classList.learners) {
      select.append(
        h('option', {
          value: l.id,
          text: `${l.name ? `${l.name} (${l.id})` : `Learner ID ${l.id}`}${marked.has(l.id) && l.id !== current ? ', has a sheet' : ''}`,
        }),
      )
    }
    const button = h('button', {
      type: 'button',
      class: 'primary',
      text: 'Assign',
      onclick: () => select.value && onPick(select.value),
    })
    return h('div', { class: 'inline picker' }, select, button)
  }
  const digits = workspace().assessment.print.idDigits
  const input = h('input', {
    type: 'text',
    inputmode: 'numeric',
    maxlength: 4,
    'aria-label': label,
    placeholder: 'Learner ID',
    value: current ?? '',
  })
  const button = h('button', {
    type: 'button',
    class: 'primary',
    text: 'Assign',
    onclick: () => {
      const v = input.value.trim()
      if (/^\d{1,4}$/.test(v)) onPick(v.padStart(Math.max(v.length, digits), '0'))
      else input.setCustomValidity('A Learner ID is 1 to 4 digits.')
      input.reportValidity()
    },
  })
  input.addEventListener('input', () => input.setCustomValidity(''))
  return h('div', { class: 'inline picker' }, input, button)
}

function identityCard(item: Extract<ReviewItem, { kind: 'identity' }>): HTMLElement[] {
  const p = page(item.pageId)!
  const { classList, assessment } = workspace()
  const listName =
    assessment.print.learnerSource === 'class' && classList
      ? `the Class list ${classList.name}`
      : 'the list of learners'
  const reason =
    item.reason === 'unknown'
      ? 'Whose sheet is this? The code does not name a learner: a spare sheet, a Bubbled ID that could not be read, or a code that could not be read.'
      : item.reason === 'not-on-list'
        ? `Learner ID ${item.readId} is not on ${listName}.`
        : `The Learner ID circles read as ${item.readId}, but not clearly.`
  const assign = (id: string) => changePage(p.id, (x) => ({ ...x, learnerId: id, learnerConfirmed: true }))
  return [
    h(
      'div',
      { class: 'card-head' },
      h('h3', { text: 'Whose sheet?' }),
      h('p', { class: 'meta', text: `${p.fileName}, page ${p.filePage}` }),
    ),
    crop(p.id, headerRect(p), 'The top of the sheet as scanned'),
    h('p', { class: 'read-line', text: reason }),
    learnerPicker(item.readId, assign, 'Learner'),
    h(
      'div',
      { class: 'actions' },
      item.readId
        ? h('button', {
            type: 'button',
            text: `Keep ${item.readId}`,
            onclick: () => changePage(p.id, (x) => ({ ...x, learnerId: item.readId, learnerConfirmed: true })),
          })
        : null,
      h('button', {
        type: 'button',
        text: 'Set aside (not marked)',
        onclick: () => changePage(p.id, (x) => ({ ...x, ignored: true })),
      }),
    ),
  ]
}

function duplicateCard(item: Extract<ReviewItem, { kind: 'duplicate' }>): HTMLElement[] {
  const { names } = workspace()
  const pages = item.pageIds.map(page).filter((p): p is ScannedPage => Boolean(p))
  return [
    h(
      'div',
      { class: 'card-head' },
      h('h3', { text: 'Scanned twice?' }),
      h('p', { class: 'meta', text: learnerLabel(item.learnerId, names) }),
    ),
    h('p', {
      class: 'read-line',
      text: `${plural(pages.length, 'sheet')} say page ${item.page} belongs to ${learnerLabel(item.learnerId, names)}. Keep one, or give the other to the right learner.`,
    }),
    h(
      'div',
      { class: 'duplicates' },
      pages.map((p, n) =>
        h(
          'div',
          { class: 'duplicate' },
          h('p', { class: 'meta', text: `Sheet ${n + 1}: ${p.fileName}, page ${p.filePage}` }),
          crop(p.id, headerRect(p), `Sheet ${n + 1}, the top as scanned`, 420),
          h('button', {
            type: 'button',
            class: 'primary',
            text: 'Keep this one',
            onclick: () =>
              changePages((x) =>
                item.pageIds.includes(x.id)
                  ? x.id === p.id
                    ? { ...x, ignored: false, learnerConfirmed: true }
                    : { ...x, ignored: true }
                  : x,
              ),
          }),
          learnerPicker(
            undefined,
            (id) => changePage(p.id, (x) => ({ ...x, learnerId: id, learnerConfirmed: true })),
            `Give sheet ${n + 1} to`,
          ),
        ),
      ),
    ),
  ]
}

function versionCard(item: Extract<ReviewItem, { kind: 'version' }>): HTMLElement[] {
  const p = page(item.pageId)!
  const { names, assessment } = workspace()
  return [
    h(
      'div',
      { class: 'card-head' },
      h('h3', { text: 'Which Version?' }),
      h('p', { class: 'meta', text: learnerLabel(pageLearner(p), names) }),
    ),
    crop(p.id, HEADER_RECT, 'The top of the sheet as scanned'),
    h('p', {
      class: 'read-line',
      text: 'The code could not be read, so the Version is unknown. It is printed under the title.',
    }),
    h(
      'div',
      { class: 'choices' },
      versionLetters(assessment).map((v: SheetVersion) =>
        h(
          'button',
          { type: 'button', class: 'choice', onclick: () => changePage(p.id, (x) => ({ ...x, version: v })) },
          `Version ${v}`,
        ),
      ),
    ),
  ]
}

function card(item: ReviewItem): HTMLElement[] {
  switch (item.kind) {
    case 'answer':
      return answerCard(item)
    case 'identity':
      return identityCard(item)
    case 'duplicate':
      return duplicateCard(item)
    case 'version':
      return versionCard(item)
  }
}

function queueLabel(item: ReviewItem): string {
  const { names } = workspace()
  switch (item.kind) {
    case 'answer': {
      const p = page(item.pageId)
      return `Q${item.printedNumber}: ${learnerLabel(p && pageLearner(p), names)}`
    }
    case 'identity':
      return 'Whose sheet?'
    case 'duplicate':
      return `Twice: ${learnerLabel(item.learnerId, names)}`
    case 'version':
      return 'Which Version?'
  }
}

function render(): void {
  if (!root) return
  const list = items()
  const { assessment: a } = workspace()
  if (!list.length) {
    currentKey = null
    clear(
      root,
      h(
        'section',
        { class: 'panel done-panel' },
        h('h2', { text: 'Review' }),
        h('p', {
          class: 'summary',
          id: 'review-left',
          role: 'status',
          text: a.scans.length
            ? 'Nothing left to review.'
            : 'Nothing to review yet: scan the sheets on the Mark step first.',
        }),
        a.scans.length
          ? h('a', { class: 'button primary', href: `#a/${encodeURIComponent(a.id)}/results`, text: 'See the results' })
          : null,
      ),
    )
    return
  }
  if (!list.some((i) => reviewKey(i) === currentKey)) currentKey = reviewKey(list[0])
  const index = list.findIndex((i) => reviewKey(i) === currentKey)
  const item = list[index]
  const queue = h(
    'ol',
    { class: 'review-queue', 'aria-label': 'To review' },
    list.slice(0, 200).map((i) =>
      h(
        'li',
        {},
        h('button', {
          type: 'button',
          class: 'queue-item',
          'aria-current': reviewKey(i) === currentKey ? 'true' : undefined,
          text: queueLabel(i),
          onclick: () => {
            currentKey = reviewKey(i)
            render()
          },
        }),
      ),
    ),
  )
  clear(
    root,
    h(
      'div',
      { class: 'review-head' },
      h('h2', { text: 'Review' }),
      h('p', { class: 'summary', id: 'review-left', role: 'status', text: `${list.length} left to review` }),
      h(
        'details',
        { class: 'help-details keys' },
        h('summary', { text: 'Keyboard' }),
        h(
          'p',
          { class: 'help' },
          key('A'),
          ' to ',
          key('E'),
          ' choose that letter, ',
          key('N'),
          ' blank, ',
          key('M'),
          ' more than one (wrong), ',
          key('Enter'),
          ' keep the read, ',
          key('J'),
          ' / ',
          key('K'),
          ' next and previous.',
        ),
      ),
    ),
    h(
      'div',
      { class: 'review-layout' },
      queue,
      h(
        'div',
        {
          class: 'panel review-card',
          id: 'review-card',
          tabindex: -1,
          'aria-label': `Item ${index + 1} of ${list.length}`,
        },
        card(item),
        h(
          'div',
          { class: 'card-nav' },
          h('button', { type: 'button', class: 'small', text: 'Previous', onclick: () => move(-1) }),
          h('span', { class: 'meta', text: `${index + 1} of ${list.length}` }),
          h('button', { type: 'button', class: 'small', text: 'Next', onclick: () => move(1) }),
        ),
      ),
    ),
  )
}

function onKey(e: KeyboardEvent): void {
  if (!root || root.hidden || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target as HTMLElement
  if (target.closest('input, select, textarea, [contenteditable]')) return
  const item = items().find((i) => reviewKey(i) === currentKey)
  if (!item) return
  const k = e.key.toLowerCase()
  if (k === 'j' || (k === 'arrowdown' && !target.closest('.review-queue'))) {
    e.preventDefault()
    move(1)
    return
  }
  if (k === 'k' || (k === 'arrowup' && !target.closest('.review-queue'))) {
    e.preventDefault()
    move(-1)
    return
  }
  if (item.kind !== 'answer') return
  const choice = 'abcde'.indexOf(k)
  if (choice >= 0 && k.length === 1) {
    const button = root.querySelector<HTMLButtonElement>(`[data-choice="${letter(choice)}"]`)
    if (button) {
      e.preventDefault()
      button.click()
    }
  } else if (k === 'n' || k === '0') {
    e.preventDefault()
    decide(item, 'blank')
  } else if (k === 'm') {
    e.preventDefault()
    decide(item, 'multiple')
  } else if (k === 'enter' && typeof item.read === 'number' && !target.closest('button, a')) {
    e.preventDefault()
    decide(item, item.read)
  }
}

let listening = false

export const reviewStep = {
  show(target: HTMLElement) {
    root = target
    if (!listening) {
      document.addEventListener('keydown', onKey)
      listening = true
    }
    render()
  },
  refresh(target: HTMLElement, _info: ChangeInfo) {
    root = target
    render()
  },
}
