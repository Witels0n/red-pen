import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { ClassStorageError, getClass, listClasses } from '../shared/classes'
import {
  chooseWinner,
  emptyDraw,
  onWheel,
  recordPick,
  removesOnPick,
  resetDraw,
  tidyDraw,
  undoPick,
  type AfterPick,
  type DrawState,
  type Entry,
} from './draw'
import { groupCount, groupName, groupsAsText, makeGroups, type GroupRule } from './groups'
import { cryptoRng, randomBetween } from './random'
import {
  classLearners,
  numberedLearners,
  parseOptions,
  parsePastedNames,
  presentLearners,
  tagsInUse,
  type PickerLearner,
} from './roster'
import { chime, tick, unlockSound } from './sound'
import { WHEEL_LIMIT } from './spin'
import {
  loadSession,
  loadSettings,
  loadWheels,
  saveSession,
  saveSettings,
  saveWheels,
  type CustomWheel,
  type LearnerSource,
} from './storage'
import { WheelView, type DrawStyle } from './wheel-view'

registerOffline(mountSiteHeader({ toolName: 'Class picker' }))

// ---------- Small DOM helpers ----------

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

type Attrs = Record<string, string | number | boolean | undefined>

/** A small element builder. Text children are always set as text, never as HTML. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child) node.append(child)
  return node
}

function showMessage(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

// ---------- State ----------

const settings = loadSettings()
const session = loadSession()
let wheels: CustomWheel[] = loadWheels()

const PRESETS: readonly CustomWheel[] = [
  { id: 'preset-yes-no', name: 'Yes or No', options: ['Yes', 'No'] },
  { id: 'preset-dice', name: 'Dice (1 to 6)', options: ['1', '2', '3', '4', '5', '6'] },
]

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function persist(): void {
  saveSession(session)
  saveSettings(settings)
}

function absentSet(): Set<string> {
  return new Set(session.absent)
}

function present(): PickerLearner[] {
  return presentLearners(session.learners, absentSet())
}

// ---------- Learners ----------

const sourceRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="source"]')]
const classSelect = el<HTMLSelectElement>('class-select')
const pasteText = el<HTMLTextAreaElement>('paste-text')
const numbersCount = el<HTMLInputElement>('numbers-count')
const learnerList = el<HTMLUListElement>('learner-list')

function showSource(source: LearnerSource): void {
  settings.source = source
  for (const r of sourceRadios) r.checked = r.value === source
  for (const section of document.querySelectorAll<HTMLElement>('.source')) {
    section.hidden = section.dataset.source !== source
  }
}

/** Replaces the learners, keeping attendance, choices and rules for anyone still on the list. */
function setLearners(learners: PickerLearner[], label: string, tagTitle?: string): void {
  const keys = new Set(learners.map((l) => l.key))
  const sameKeys = learners.length === session.learners.length && session.learners.every((l) => keys.has(l.key))
  session.learners = learners
  session.label = label
  session.tagTitle = tagTitle
  session.absent = session.absent.filter((k) => keys.has(k))
  session.after = Object.fromEntries(Object.entries(session.after).filter(([k]) => keys.has(k)))
  session.rules = session.rules
    .map((r) => ({ ...r, keys: r.keys.filter((k) => keys.has(k)) }))
    .filter((r) => r.keys.length >= 2)
  if (!sameKeys) {
    session.groups = null
    delete session.draws.learners
  }
  ruleSelection.clear()
  session.wheel = 'learners'
  persist()
  renderAll()
  // On a phone the wheel is below the list: bring it into view once the learners are in.
  if (window.matchMedia('(max-width: 860px)').matches) {
    el('roster').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' })
  }
}

function renderRoster(): void {
  const roster = el('roster')
  roster.hidden = session.learners.length === 0
  const absent = absentSet()
  const here = session.learners.length - session.absent.length
  el('roster-summary').textContent =
    `${here} of ${session.learners.length} here` + (session.label ? ` · ${session.label}` : '')
  learnerList.replaceChildren(
    ...session.learners.map((l) => {
      const choice = session.after[l.key] ?? ''
      const after = h(
        'select',
        { class: 'after', 'data-key': l.key, 'aria-label': `After ${l.name} is picked` },
        h('option', { value: '', text: 'Default' }),
        h('option', { value: 'remove', text: 'Remove' }),
        h('option', { value: 'keep', text: 'Keep in' }),
      )
      after.value = choice
      return h(
        'li',
        { class: absent.has(l.key) ? 'learner-row absent' : 'learner-row' },
        h(
          'label',
          { class: 'check here' },
          h('input', { type: 'checkbox', 'data-key': l.key, checked: !absent.has(l.key) }),
          h('span', { class: 'learner-name', text: l.name }),
        ),
        l.tag ? h('span', { class: 'tag', text: l.tag, title: session.tagTitle ?? 'Tag' }) : null,
        after,
      )
    }),
  )
}

learnerList.addEventListener('change', (e) => {
  const target = e.target as HTMLElement
  const key = target.dataset.key
  if (!key) return
  if (target instanceof HTMLInputElement) {
    const absent = absentSet()
    if (target.checked) absent.delete(key)
    else absent.add(key)
    session.absent = session.learners.filter((l) => absent.has(l.key)).map((l) => l.key)
    target.closest('li')?.classList.toggle('absent', !target.checked)
  } else if (target instanceof HTMLSelectElement) {
    if (target.value === 'remove' || target.value === 'keep') session.after[key] = target.value
    else delete session.after[key]
  }
  persist()
  el('roster-summary').textContent =
    `${session.learners.length - session.absent.length} of ${session.learners.length} here` +
    (session.label ? ` · ${session.label}` : '')
  if (session.wheel === 'learners') renderWheel()
  renderGroupForm()
  renderRules()
})

el('all-here').addEventListener('click', () => {
  session.absent = []
  persist()
  renderAll()
})

for (const r of sourceRadios) {
  r.addEventListener('change', () => {
    showSource(r.value as LearnerSource)
    saveSettings(settings)
  })
}

el('use-paste').addEventListener('click', () => {
  const { learners, tagTitle, dropped } = parsePastedNames(pasteText.value)
  if (learners.length === 0) {
    showMessage(el('paste-error'), 'Type or paste at least one name, one per line.')
    return
  }
  showMessage(el('paste-error'), dropped > 0 ? `Only the first ${learners.length} names were used.` : '')
  session.pasteText = pasteText.value
  setLearners(learners, 'Pasted names', tagTitle)
})

el('use-numbers').addEventListener('click', () => {
  const n = Math.max(1, Math.min(99, Math.trunc(Number(numbersCount.value)) || 1))
  numbersCount.value = String(n)
  settings.numbers = n
  setLearners(numberedLearners(n), `Numbers 1 to ${n}`)
})

el('use-class').addEventListener('click', async () => {
  const id = classSelect.value
  if (!id) return
  try {
    const list = await getClass(id)
    if (!list) throw new ClassStorageError('That Class list is no longer on this device.')
    settings.classId = id
    showMessage(el('class-error'), '')
    setLearners(classLearners(list), list.name)
  } catch (error) {
    showMessage(el('class-error'), error instanceof Error ? error.message : String(error))
  }
})

async function loadClassOptions(): Promise<void> {
  try {
    const classes = await listClasses()
    el('no-classes').hidden = classes.length > 0
    el('class-row').hidden = classes.length === 0
    classSelect.replaceChildren(
      ...classes.map((c) => new Option(`${c.name} (${plural(c.learners.length, 'learner')})`, c.id)),
    )
    if (classes.some((c) => c.id === settings.classId)) classSelect.value = settings.classId
  } catch (error) {
    el('class-row').hidden = true
    const reason = error instanceof ClassStorageError ? `${error.message} ` : ''
    showMessage(el('class-error'), `${reason}Paste names or use numbers instead.`)
  }
}

// ---------- Tabs ----------

const tabs = { wheel: el('tab-wheel'), groups: el('tab-groups') }
const panels = { wheel: el('wheel-panel'), groups: el('groups-panel') }

function showTab(tab: 'wheel' | 'groups', focus = false): void {
  settings.tab = tab
  for (const name of ['wheel', 'groups'] as const) {
    const on = name === tab
    tabs[name].setAttribute('aria-selected', String(on))
    tabs[name].tabIndex = on ? 0 : -1
    panels[name].hidden = !on
  }
  if (focus) tabs[tab].focus()
  saveSettings(settings)
  if (tab === 'wheel') renderWheel()
}

tabs.wheel.addEventListener('click', () => showTab('wheel'))
tabs.groups.addEventListener('click', () => showTab('groups'))
for (const tab of Object.values(tabs)) {
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      showTab(settings.tab === 'wheel' ? 'groups' : 'wheel', true)
    }
  })
}

// ---------- Full screen (projecting) ----------

function toggleProjecting(target: HTMLElement, button: HTMLButtonElement, label: string): void {
  const on = !target.classList.contains('projecting')
  target.classList.toggle('projecting', on)
  document.body.classList.toggle('is-projecting', on)
  button.textContent = on ? 'Exit full screen' : label
  if (on) {
    target.requestFullscreen?.().catch(() => undefined)
  } else if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined)
  }
}

function stopProjecting(): void {
  for (const [target, button, label] of [
    [el('stage'), el<HTMLButtonElement>('wheel-full'), 'Full screen'],
    [el('group-output'), el<HTMLButtonElement>('groups-full'), 'Show large'],
  ] as const) {
    if (target.classList.contains('projecting')) {
      target.classList.remove('projecting')
      button.textContent = label
    }
  }
  document.body.classList.remove('is-projecting')
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) stopProjecting()
})

// ---------- Wheel ----------

const view = new WheelView(el<HTMLCanvasElement>('wheel'))
const wheelSelect = el<HTMLSelectElement>('wheel-select')
const spinButton = el<HTMLButtonElement>('spin')
const reveal = el('reveal')

function allWheels(): CustomWheel[] {
  return [...PRESETS, ...wheels]
}

function currentWheel(): CustomWheel | undefined {
  return allWheels().find((w) => w.id === session.wheel)
}

function entries(): Entry[] {
  const wheel = currentWheel()
  if (wheel) return wheel.options.map((o) => ({ id: `o:${o}`, label: o }))
  return present().map((l) => ({ id: l.key, label: l.name, after: session.after[l.key] }))
}

function draw(): DrawState {
  return session.draws[session.wheel] ?? emptyDraw()
}

function setDraw(state: DrawState): void {
  session.draws[session.wheel] = state
  persist()
}

function styleFor(count: number): DrawStyle {
  if (settings.style !== 'auto') return settings.style
  const small = el('wheel').clientWidth < 420
  return count > (small ? 20 : WHEEL_LIMIT) ? 'ticker' : 'wheel'
}

function renderWheelSelect(): void {
  if (session.wheel !== 'learners' && !currentWheel()) session.wheel = 'learners'
  wheelSelect.replaceChildren(new Option('Learners', 'learners'), ...allWheels().map((w) => new Option(w.name, w.id)))
  wheelSelect.value = session.wheel
}

function renderWheel(): void {
  const all = entries()
  const state = tidyDraw(draw(), all)
  const remaining = onWheel(all, state)
  const style = styleFor(remaining.length)
  view.setEntries(
    remaining.map((e) => e.label),
    style,
  )
  el('pointer').hidden = style !== 'wheel' || remaining.length === 0
  const off = all.length - remaining.length
  el('wheel-count').textContent =
    all.length === 0 ? '' : `${remaining.length} on the wheel` + (off > 0 ? ` (${off} picked off)` : '')
  const empty = el('wheel-empty')
  if (all.length === 0) {
    showMessage(empty, 'Add learners to fill the wheel, or choose a custom wheel.')
  } else if (remaining.length === 0) {
    showMessage(empty, 'Everyone has been picked. Reset the wheel to start again.')
  } else {
    showMessage(empty, '')
  }
  el('wheel').hidden = remaining.length === 0
  spinButton.disabled = remaining.length === 0 || view.spinning
  renderHistory()
}

function renderHistory(): void {
  const { history } = draw()
  el('history').replaceChildren(
    ...[...history]
      .reverse()
      .map((p) =>
        h('li', {}, h('span', { text: p.label }), p.removed ? null : h('span', { class: 'kept', text: 'kept in' })),
      ),
  )
  el('no-history').hidden = history.length > 0
  el<HTMLButtonElement>('undo').disabled = history.length === 0 || view.spinning
  el<HTMLButtonElement>('reset').disabled = (history.length === 0 && draw().removed.length === 0) || view.spinning
}

function hideReveal(): void {
  reveal.hidden = true
}

async function spin(): Promise<void> {
  if (view.spinning) return
  if (!reveal.hidden) closeReveal()
  unlockSound()
  const all = entries()
  const state = tidyDraw(draw(), all)
  // The winner is chosen first, fairly; the wheel then animates to land on it.
  const index = chooseWinner(all, state, cryptoRng)
  if (index === null) return
  const entry = onWheel(all, state)[index]
  spinButton.disabled = true
  el<HTMLButtonElement>('undo').disabled = true
  el<HTMLButtonElement>('reset').disabled = true
  wheelSelect.disabled = true
  await view.spinTo(index, {
    reducedMotion: reducedMotion.matches,
    turns: 5 + cryptoRng(3),
    offset: randomBetween(0.2, 0.8, cryptoRng),
    onTick: () => {
      if (!settings.muted) tick()
    },
  })
  wheelSelect.disabled = false
  const removed = removesOnPick(entry, settings.defaultAfter)
  setDraw(recordPick(state, entry, settings.defaultAfter))
  if (!settings.muted) chime()
  view.highlight(index)
  el('reveal-name').textContent = entry.label
  el('reveal-note').textContent = removed ? 'Comes off the wheel.' : 'Stays on the wheel.'
  reveal.hidden = false
  spinButton.disabled = false
  renderHistory()
  el('reveal-close').focus({ preventScroll: true })
}

function closeReveal(): void {
  hideReveal()
  renderWheel()
}

spinButton.addEventListener('click', () => void spin())
el('wheel').addEventListener('click', () => void spin())
el('reveal-close').addEventListener('click', () => {
  closeReveal()
  spinButton.focus({ preventScroll: true })
})

function undo(): void {
  if (view.spinning) return
  setDraw(undoPick(draw()))
  hideReveal()
  renderWheel()
}

el('reveal-undo').addEventListener('click', undo)
el('undo').addEventListener('click', undo)
el('reset').addEventListener('click', () => {
  setDraw(resetDraw())
  hideReveal()
  renderWheel()
})

wheelSelect.addEventListener('change', () => {
  session.wheel = wheelSelect.value
  hideReveal()
  persist()
  renderWheel()
})

const defaultAfter = el<HTMLSelectElement>('default-after')
defaultAfter.addEventListener('change', () => {
  settings.defaultAfter = defaultAfter.value as AfterPick
  saveSettings(settings)
})

const wheelStyle = el<HTMLSelectElement>('wheel-style')
wheelStyle.addEventListener('change', () => {
  settings.style = wheelStyle.value as typeof settings.style
  saveSettings(settings)
  hideReveal()
  renderWheel()
})

const mute = el<HTMLButtonElement>('mute')
function renderMute(): void {
  mute.textContent = settings.muted ? 'Sound off' : 'Sound on'
  mute.setAttribute('aria-pressed', String(settings.muted))
  mute.setAttribute('aria-label', settings.muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off')
}
mute.addEventListener('click', () => {
  settings.muted = !settings.muted
  saveSettings(settings)
  renderMute()
})

el('wheel-full').addEventListener('click', () => {
  toggleProjecting(el('stage'), el<HTMLButtonElement>('wheel-full'), 'Full screen')
  // The canvas changes size; draw again once the layout settles.
  requestAnimationFrame(() => renderWheel())
})

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement
  const typing = target.closest('input, textarea, select, button, summary, a, [contenteditable]')
  if (e.key === 'Escape') {
    if (!reveal.hidden) closeReveal()
    if (document.body.classList.contains('is-projecting') && !document.fullscreenElement) stopProjecting()
    return
  }
  if ((e.code === 'Space' || e.key === ' ') && settings.tab === 'wheel' && (!typing || target === el('stage'))) {
    e.preventDefault()
    void spin()
  }
})

// ---------- Custom wheels ----------

let editing: string | null = null

function renderWheelList(): void {
  el('wheel-list').replaceChildren(
    ...wheels.map((w) =>
      h(
        'li',
        { class: 'wheel-item' },
        h('span', { class: 'grow', text: w.name }),
        h('span', { class: 'summary', text: plural(w.options.length, 'option') }),
        h('button', { type: 'button', class: 'small', 'data-edit': w.id, text: 'Edit' }),
        h('button', { type: 'button', class: 'small', 'data-delete': w.id, text: 'Delete' }),
      ),
    ),
  )
}

function editWheel(wheel: CustomWheel | null): void {
  editing = wheel?.id ?? null
  el('wheel-form-title').textContent = wheel ? `Edit ${wheel.name}` : 'New wheel'
  el<HTMLInputElement>('wheel-name').value = wheel?.name ?? ''
  el<HTMLTextAreaElement>('wheel-options').value = wheel?.options.join('\n') ?? ''
  el('cancel-wheel').hidden = !wheel
  showMessage(el('wheel-error'), '')
}

el('wheel-list').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('button')
  if (!button) return
  const edit = button.dataset.edit
  const del = button.dataset.delete
  if (edit) {
    editWheel(wheels.find((w) => w.id === edit) ?? null)
    el('wheel-name').focus()
  } else if (del) {
    wheels = wheels.filter((w) => w.id !== del)
    delete session.draws[del]
    if (editing === del) editWheel(null)
    saveWheels(wheels)
    renderAll()
  }
})

el('cancel-wheel').addEventListener('click', () => editWheel(null))

el('wheel-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = el<HTMLInputElement>('wheel-name').value.trim()
  const options = parseOptions(el<HTMLTextAreaElement>('wheel-options').value)
  if (!name) return showMessage(el('wheel-error'), 'Give the wheel a name.')
  if (options.length < 2) return showMessage(el('wheel-error'), 'Add at least two options, one per line.')
  const id = editing ?? `w${Date.now().toString(36)}${cryptoRng(1_000_000).toString(36)}`
  const wheel: CustomWheel = { id, name, options }
  wheels = editing ? wheels.map((w) => (w.id === id ? wheel : w)) : [...wheels, wheel]
  saveWheels(wheels)
  editWheel(null)
  session.wheel = id
  persist()
  hideReveal()
  renderAll()
  el('stage').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' })
})

// ---------- Groups ----------

const groupByRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="group-by"]')]
const groupValue = el<HTMLInputElement>('group-value')
const nameStyle = el<HTMLSelectElement>('name-style')
const balance = el<HTMLInputElement>('balance')
const ruleSelection = new Set<string>()

function groupValueNumber(): number {
  return Math.max(1, Math.min(99, Math.trunc(Number(groupValue.value)) || 1))
}

function renderGroupForm(): void {
  for (const r of groupByRadios) r.checked = r.value === settings.groupBy
  el('group-value-label').textContent = settings.groupBy === 'size' ? 'Learners per group' : 'Number of groups'
  const n = present().length
  const tags = tagsInUse(session.learners)
  el('balance-row').hidden = tags.length === 0
  el('balance-label').textContent =
    `Balance by ${session.tagTitle?.toLowerCase() || 'the second column'} (${tags.join(', ')})`
  balance.checked = settings.balance
  nameStyle.value = settings.nameStyle
  const k = groupCount(n, settings.groupBy, groupValueNumber())
  const small = k > 0 ? Math.floor(n / k) : 0
  const big = k > 0 ? Math.ceil(n / k) : 0
  el('group-preview').textContent =
    n === 0
      ? 'Add learners to make groups.'
      : `${plural(n, 'learner')} here: ${plural(k, 'group')} of ${small === big ? big : `${small} or ${big}`}.`
  el<HTMLButtonElement>('make-groups').disabled = n === 0
}

for (const r of groupByRadios) {
  r.addEventListener('change', () => {
    settings.groupBy = r.value as 'size' | 'count'
    saveSettings(settings)
    renderGroupForm()
  })
}
groupValue.addEventListener('input', () => {
  settings.groupValue = groupValueNumber()
  saveSettings(settings)
  renderGroupForm()
})
balance.addEventListener('change', () => {
  settings.balance = balance.checked
  saveSettings(settings)
})
nameStyle.addEventListener('change', () => {
  settings.nameStyle = nameStyle.value as typeof settings.nameStyle
  saveSettings(settings)
  renderGroups()
})

function renderRules(): void {
  const here = present()
  const byKey = new Map(session.learners.map((l) => [l.key, l.name]))
  for (const k of [...ruleSelection]) if (!here.some((l) => l.key === k)) ruleSelection.delete(k)
  el('rule-picker').replaceChildren(
    ...here.map((l) =>
      h('button', {
        type: 'button',
        class: 'chip',
        'data-key': l.key,
        'aria-pressed': String(ruleSelection.has(l.key)),
        text: l.name,
      }),
    ),
  )
  el('rule-count').textContent = session.rules.length > 0 ? `(${session.rules.length})` : ''
  el<HTMLButtonElement>('add-apart').disabled = ruleSelection.size < 2
  el<HTMLButtonElement>('add-together').disabled = ruleSelection.size < 2
  el('rule-list').replaceChildren(
    ...session.rules.map((r, i) =>
      h(
        'li',
        { class: 'rule' },
        h('strong', { text: r.kind === 'apart' ? 'Keep apart: ' : 'Keep together: ' }),
        h('span', { class: 'grow', text: r.keys.map((k) => byKey.get(k) ?? k).join(', ') }),
        h('button', {
          type: 'button',
          class: 'small',
          'data-rule': i,
          text: 'Remove',
          'aria-label': `Remove rule ${i + 1}`,
        }),
      ),
    ),
  )
}

el('rule-picker').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip')
  const key = chip?.dataset.key
  if (!chip || !key) return
  if (ruleSelection.has(key)) ruleSelection.delete(key)
  else ruleSelection.add(key)
  chip.setAttribute('aria-pressed', String(ruleSelection.has(key)))
  el<HTMLButtonElement>('add-apart').disabled = ruleSelection.size < 2
  el<HTMLButtonElement>('add-together').disabled = ruleSelection.size < 2
})

function addRule(kind: GroupRule['kind']): void {
  if (ruleSelection.size < 2) return
  const order = new Map(session.learners.map((l, i) => [l.key, i]))
  session.rules.push({ kind, keys: [...ruleSelection].sort((a, b) => order.get(a)! - order.get(b)!) })
  ruleSelection.clear()
  persist()
  renderRules()
}
el('add-apart').addEventListener('click', () => addRule('apart'))
el('add-together').addEventListener('click', () => addRule('together'))
el('rule-list').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rule]')
  if (!button) return
  session.rules.splice(Number(button.dataset.rule), 1)
  persist()
  renderRules()
})

function groupNames(count: number): ReturnType<typeof groupName>[] {
  return Array.from({ length: count }, (_, i) => groupName(settings.nameStyle, i))
}

function make(): void {
  const members = present()
  const current = session.groups
  const locked = current ? current.locked.map((index) => ({ index, keys: current.keys[index] ?? [] })) : []
  const result = makeGroups(
    members,
    {
      by: settings.groupBy,
      value: groupValueNumber(),
      rules: session.rules,
      balanceTag: settings.balance && tagsInUse(members).length > 0,
      locked,
    },
    cryptoRng,
  )
  el('copy-status').textContent = ''
  if (!result.ok) {
    showMessage(el('group-error'), result.message)
    return
  }
  showMessage(el('group-error'), '')
  el('group-notes').replaceChildren(...result.notes.map((n) => h('p', { class: 'warning', text: n })))
  session.groups = {
    keys: result.groups,
    locked: locked.filter((g) => g.index < result.groups.length).map((g) => g.index),
  }
  persist()
  renderGroups()
}

/** A colour dot. Set through the CSSOM, because the CSP does not allow inline style attributes. */
function swatch(colour: string): HTMLElement {
  const dot = h('span', { class: 'swatch' })
  dot.style.background = colour
  return dot
}

function renderGroups(): void {
  const output = el('group-output')
  const groups = session.groups
  output.hidden = !groups || groups.keys.length === 0
  if (!groups) return
  const byKey = new Map(session.learners.map((l) => [l.key, l]))
  const names = groupNames(groups.keys.length)
  const lockedCount = groups.locked.length
  el('group-summary').textContent =
    plural(groups.keys.length, 'group') + (lockedCount > 0 ? ` (${lockedCount} locked)` : '')
  el('group-grid').replaceChildren(
    ...groups.keys.map((keys, i) => {
      const isLocked = groups.locked.includes(i)
      const name = names[i]
      return h(
        'li',
        { class: isLocked ? 'group-card locked' : 'group-card' },
        h(
          'div',
          { class: 'group-head' },
          name.colour ? swatch(name.colour) : null,
          h('h3', { text: name.name }),
          h('span', { class: 'summary', text: String(keys.length) }),
          h('span', { class: 'spacer' }),
          h('button', {
            type: 'button',
            class: 'small lock',
            'data-lock': i,
            'aria-pressed': String(isLocked),
            'aria-label': `${isLocked ? 'Unlock' : 'Lock'} ${name.name}`,
            text: isLocked ? 'Locked' : 'Lock',
          }),
        ),
        h(
          'ul',
          { class: 'members' },
          ...keys.map((k) => {
            const l = byKey.get(k)
            return h(
              'li',
              {},
              h('span', { text: l?.name ?? k }),
              l?.tag ? h('span', { class: 'tag', text: l.tag }) : null,
            )
          }),
        ),
      )
    }),
  )
}

el('group-grid').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-lock]')
  if (!button || !session.groups) return
  const i = Number(button.dataset.lock)
  const locked = new Set(session.groups.locked)
  if (locked.has(i)) locked.delete(i)
  else locked.add(i)
  session.groups.locked = [...locked].sort((a, b) => a - b)
  persist()
  renderGroups()
})

el('group-form').addEventListener('submit', (e) => {
  e.preventDefault()
  make()
})
el('reshuffle').addEventListener('click', make)

function groupsText(): string {
  const groups = session.groups
  if (!groups) return ''
  const byKey = new Map(session.learners.map((l) => [l.key, l.name]))
  return groupsAsText(
    groups.keys.map((g) => g.map((k) => byKey.get(k) ?? k)),
    groupNames(groups.keys.length).map((n) => n.name),
  )
}

el('copy-groups').addEventListener('click', async () => {
  const text = groupsText()
  const status = el('copy-status')
  try {
    await navigator.clipboard.writeText(text)
    status.textContent = 'Copied. Paste the groups into a message or document.'
  } catch {
    // Older browsers: copy through a hidden text box.
    const box = h('textarea', { class: 'visually-hidden', readonly: true })
    box.value = text
    document.body.append(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    status.textContent = ok ? 'Copied.' : 'Copying is blocked in this browser.'
  }
})

el('print-groups').addEventListener('click', () => window.print())
el('groups-full').addEventListener('click', () =>
  toggleProjecting(el('group-output'), el<HTMLButtonElement>('groups-full'), 'Show large'),
)

// ---------- Start ----------

function renderAll(): void {
  renderRoster()
  renderWheelSelect()
  renderWheel()
  renderWheelList()
  renderGroupForm()
  renderRules()
  renderGroups()
}

let lastWidth = window.innerWidth
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth || view.spinning) return
  lastWidth = window.innerWidth
  if (reveal.hidden) renderWheel()
})

showSource(settings.source)
pasteText.value = session.pasteText
numbersCount.value = String(settings.numbers)
groupValue.value = String(settings.groupValue)
defaultAfter.value = settings.defaultAfter
wheelStyle.value = settings.style
renderMute()
showTab(settings.tab)
renderAll()
void loadClassOptions()
