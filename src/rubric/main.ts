import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { ClassStorageError, listClasses, rowsFromNames, type ClassList } from '../shared/classes'
import { downloadFile } from '../shared/pdf/download'
import { COGNITIVE, cognitiveById, isCognitiveId } from './core/cognitive'
import {
  MAX_CRITERIA,
  MAX_LEVELS,
  STYLES,
  TARGET,
  bandLabel,
  checkRubric,
  cognitiveShares,
  criterionMarks,
  criterionShares,
  formatNumber,
  givesMarks,
  levelBands,
  levelHint,
  levelsFromScale,
  newId,
  newRubric,
  parseRubric,
  parseSavedRubrics,
  rubricTotal,
  scaleToTotal,
  shareEvenly,
  upsertSaved,
  usesLevels,
  type Criterion,
  type Rubric,
  type RubricStyle,
  type SavedRubric,
} from './core/model'
import { SCALES, isScaleId, scaleById } from './core/scales'
import { MAX_LEARNERS, buildWorkbook, rubricFileName, writeWorkbook, type WorkbookLearner } from './core/workbook'

registerOffline(mountSiteHeader({ toolName: 'Rubric builder' }))

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

// ---------- Storage (rubrics never hold learner names) ----------

const RUBRIC_KEY = 'red-pen.rubric.current'
const SAVED_KEY = 'red-pen.rubric.saved'
const SOURCE_KEY = 'red-pen.rubric.source'
const CLASS_KEY = 'red-pen.rubric.class'
const SHEETS_KEY = 'red-pen.rubric.sheets'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage refused: the page still works, it just forgets.
  }
}

function readJson(key: string): unknown {
  const raw = read(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

let rubric: Rubric = parseRubric(readJson(RUBRIC_KEY)) ?? newRubric('analytic')
let saved: SavedRubric[] = parseSavedRubrics(readJson(SAVED_KEY))

function persist(): void {
  write(RUBRIC_KEY, JSON.stringify(rubric))
}

// ---------- Elements ----------

const styleHelp = byId('style-help')
const savedSelect = byId<HTMLSelectElement>('saved-select')
const loadSaved = byId<HTMLButtonElement>('load-saved')
const deleteSaved = byId<HTMLButtonElement>('delete-saved')
const startStatus = byId('start-status')
const titleInput = byId<HTMLInputElement>('title')
const taskInput = byId<HTMLInputElement>('task')
const levelsBlock = byId('levels-block')
const levelList = byId<HTMLUListElement>('level-list')
const addLevel = byId<HTMLButtonElement>('add-level')
const showRanges = byId<HTMLInputElement>('show-ranges')
const scaleSelect = byId<HTMLSelectElement>('scale-select')
const scaleHelp = byId('scale-help')
const criteriaTitle = byId('criteria-title')
const scoredRow = byId('scored-row')
const scored = byId<HTMLInputElement>('scored')
const weightModeRow = byId('weight-mode-row')
const totalField = byId('total-field')
const totalInput = byId<HTMLInputElement>('total')
const taxonomyField = byId('taxonomy-field')
const taxonomy = byId<HTMLSelectElement>('taxonomy')
const criterionList = byId<HTMLUListElement>('criterion-list')
const addCriterion = byId<HTMLButtonElement>('add-criterion')
const criterionTotal = byId('criterion-total')
const weightTools = byId('weight-tools')
const scaleTotal = byId<HTMLInputElement>('scale-total')
const weightHelp = byId('weight-help')
const cognitiveSummary = byId('cognitive-summary')
const gridPanel = byId('grid-panel')
const gridHelp = byId('grid-help')
const grid = byId<HTMLTableElement>('grid')
const marking = byId<HTMLInputElement>('marking')
const markingBlock = byId('marking-block')
const classSelect = byId<HTMLSelectElement>('class-select')
const noClasses = byId('no-classes')
const namesText = byId<HTMLTextAreaElement>('names-text')
const blankSheets = byId<HTMLInputElement>('blank-sheets')
const learnerSummary = byId('learner-summary')
const markOptions = byId('mark-options')
const showPercent = byId<HTMLInputElement>('show-percent')
const reportOutOf = byId<HTMLInputElement>('report-out-of')
const showLevel = byId<HTMLInputElement>('show-level')
const showSummary = byId<HTMLInputElement>('show-summary')
const problems = byId<HTMLUListElement>('problems')
const fileSummary = byId('file-summary')
const downloadButton = byId<HTMLButtonElement>('download')
const downloadStatus = byId('download-status')
const saveName = byId<HTMLInputElement>('save-name')
const saveRubric = byId<HTMLButtonElement>('save-rubric')

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A number typed in an input, or NaN when it is empty or not a number. */
function numberFrom(input: HTMLInputElement): number {
  return input.value.trim() === '' ? NaN : Number(input.value)
}

function numberText(n: number): string {
  return Number.isFinite(n) ? formatNumber(n) : ''
}

/** "criterion" or "item", as this style of rubric calls its rows. */
function rowWord(): string {
  return rubric.style === 'checklist' ? 'item' : 'criterion'
}

// ---------- Learners ----------

type Source = 'class' | 'paste' | 'blank'
let classes: ClassList[] = []

function source(): Source {
  const checked = document.querySelector<HTMLInputElement>('input[name="source"]:checked')
  return (checked?.value as Source | undefined) ?? 'blank'
}

function showSource(): void {
  for (const block of document.querySelectorAll<HTMLElement>('.source')) {
    block.hidden = block.dataset.source !== source()
  }
}

/** The learners who get a sheet each. Blank sheets have no name: the teacher types it in Excel. */
function learners(): WorkbookLearner[] {
  switch (source()) {
    case 'class': {
      const chosen = classes.find((c) => c.id === classSelect.value)
      return (chosen?.learners ?? []).map((l) => ({ name: l.name ?? '' }))
    }
    case 'paste':
      return rowsFromNames(namesText.value)
        .map((r) => r[0])
        .filter((n) => n !== '')
        .map((name) => ({ name }))
    case 'blank': {
      const n = Math.min(MAX_LEARNERS, Math.max(0, Math.floor(numberFrom(blankSheets)) || 0))
      return Array.from({ length: n }, () => ({ name: '' }))
    }
  }
}

function learnerProblem(count: number): string | null {
  if (count > MAX_LEARNERS) return `A workbook holds at most ${MAX_LEARNERS} learner sheets. Split the class in two.`
  if (count > 0) return null
  switch (source()) {
    case 'class':
      return classes.length === 0 ? 'There is no Class list on this device yet.' : 'This Class list has no learners.'
    case 'paste':
      return 'Paste at least one name.'
    case 'blank':
      return `Choose a number of sheets from 1 to ${MAX_LEARNERS}.`
  }
}

async function loadClasses(): Promise<void> {
  try {
    classes = await listClasses()
  } catch (error) {
    classes = []
    noClasses.textContent =
      error instanceof ClassStorageError ? error.message : 'This browser cannot read your Class lists.'
  }
  classSelect.replaceChildren(
    ...classes.map((c) => new Option(`${c.name} (${plural(c.learners.length, 'learner')})`, c.id)),
  )
  classSelect.disabled = classes.length === 0
  noClasses.hidden = classes.length > 0
  const last = read(CLASS_KEY)
  if (last && classes.some((c) => c.id === last)) classSelect.value = last
}

// ---------- Editors ----------

function numberField(label: string, field: string, value: number, extra: Partial<HTMLInputElement> = {}) {
  const input = el('input', {
    type: 'number',
    inputMode: 'decimal',
    step: 'any',
    min: '0',
    value: numberText(value),
    ...extra,
  })
  input.dataset.field = field
  return el('label', { className: 'field' }, el('span', {}, label), input)
}

function itemButtons(index: number, count: number, what: string, canRemove: boolean): HTMLElement {
  const up = el('button', { type: 'button', textContent: '↑', disabled: index === 0 })
  up.dataset.action = 'up'
  up.setAttribute('aria-label', `Move ${what} up`)
  const down = el('button', { type: 'button', textContent: '↓', disabled: index === count - 1 })
  down.dataset.action = 'down'
  down.setAttribute('aria-label', `Move ${what} down`)
  const remove = el('button', { type: 'button', textContent: '✕', disabled: !canRemove })
  remove.dataset.action = 'remove'
  remove.setAttribute('aria-label', `Remove ${what}`)
  return el('div', { className: 'item-buttons' }, up, down, remove)
}

function renderLevels(): void {
  levelsBlock.hidden = !usesLevels(rubric.style)
  levelList.replaceChildren(
    ...rubric.levels.map((l, i) => {
      const name = el('input', { type: 'text', value: l.name, maxLength: 40 })
      name.dataset.field = 'name'
      const li = el(
        'li',
        { className: 'edit-item level' },
        el('label', { className: 'field name-field' }, el('span', {}, 'Level'), name),
        numberField('Worth (%)', 'percent', l.percent, { max: '100' }),
        itemButtons(i, rubric.levels.length, l.name || 'this level', rubric.levels.length > 2),
      )
      li.dataset.id = l.id
      return li
    }),
  )
  addLevel.disabled = rubric.levels.length >= MAX_LEVELS
  showRanges.checked = rubric.showRanges
}

function renderCriteria(): void {
  const style = rubric.style
  const weighted = givesMarks(rubric)
  const holistic = style === 'holistic'
  const percent = rubric.weightMode === 'percent' && !holistic
  const tagged = rubric.taxonomy !== 'none' && !holistic
  criteriaTitle.textContent = holistic ? 'Marks' : style === 'checklist' ? 'Items and marks' : 'Criteria and weights'
  scoredRow.hidden = style !== 'single-point'
  scored.checked = rubric.scored
  weightModeRow.hidden = holistic || !weighted
  totalField.hidden = !percent
  totalInput.value = numberText(rubric.total)
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="weight-mode"]')) {
    radio.checked = radio.value === rubric.weightMode
  }
  taxonomyField.hidden = holistic
  taxonomy.value = rubric.taxonomy
  addCriterion.hidden = holistic
  addCriterion.textContent = style === 'checklist' ? 'Add an item' : 'Add a criterion'
  addCriterion.disabled = rubric.criteria.length >= MAX_CRITERIA
  weightTools.hidden = holistic || !weighted
  if (!scaleTotal.value) scaleTotal.value = numberText(rubricTotal(rubric))

  const levels = cognitiveById(rubric.taxonomy).levels
  criterionList.replaceChildren(
    ...rubric.criteria.map((c, i) => {
      const li = el('li', {
        className: ['edit-item criterion', tagged ? 'tagged' : '', weighted ? '' : 'unweighted'].join(' ').trim(),
      })
      li.dataset.id = c.id
      if (!holistic) {
        const name = el('input', { type: 'text', value: c.name, maxLength: 120 })
        name.dataset.field = 'name'
        li.append(
          el(
            'label',
            { className: 'field name-field' },
            el('span', {}, style === 'checklist' ? 'The work has' : 'Criterion'),
            name,
          ),
        )
      } else {
        li.classList.add('unweighted')
      }
      if (weighted) {
        li.append(
          numberField(holistic ? 'Total marks' : percent ? 'Weight (%)' : 'Marks', 'weight', c.weight),
          el('span', { className: 'derived' }),
        )
      }
      if (tagged) {
        const select = el('select', {}, new Option('No level', ''), ...levels.map((l) => new Option(l, l)))
        select.value = c.cognitive ?? ''
        select.dataset.field = 'cognitive'
        li.append(el('label', { className: 'field cognitive-field' }, el('span', {}, 'Cognitive level'), select))
      }
      if (!holistic) {
        li.append(itemButtons(i, rubric.criteria.length, c.name || `this ${rowWord()}`, rubric.criteria.length > 1))
      }
      return li
    }),
  )
}

/** The figures beside each weight and under the list. Cheap, so it runs on every keystroke. */
function renderWeights(): void {
  const weighted = givesMarks(rubric)
  const holistic = rubric.style === 'holistic'
  const percent = rubric.weightMode === 'percent' && !holistic
  const marks = criterionMarks(rubric)
  const shares = criterionShares(rubric)
  criterionList.querySelectorAll<HTMLElement>('.derived').forEach((node, i) => {
    node.textContent = holistic
      ? ''
      : percent
        ? `= ${plural(Number(formatNumber(marks[i] ?? 0)), 'mark')}`
        : `${formatNumber(Math.round((shares[i] ?? 0) * 10) / 10)}%`
  })
  if (!weighted) {
    criterionTotal.textContent = plural(rubric.criteria.length, 'criterion', 'criteria')
    criterionTotal.className = 'total'
  } else if (percent) {
    const total = rubric.criteria.reduce((t, c) => t + (Number.isFinite(c.weight) ? c.weight : 0), 0)
    const ok = Math.abs(total - 100) < 1e-6
    criterionTotal.textContent = `Weights ${formatNumber(total)}%${ok ? ' ✓' : ', should be 100%'}`
    criterionTotal.className = `total ${ok ? 'ok' : 'off'}`
  } else {
    criterionTotal.textContent = `Out of ${formatNumber(rubricTotal(rubric))}`
    criterionTotal.className = 'total ok'
  }
  weightHelp.textContent = !weighted
    ? 'Without marks, the learner sheet has a box to tick when the standard is met.'
    : holistic
      ? 'The whole piece of work gets one mark, from the level it reaches.'
      : percent
        ? 'Each weight is a share of the rubric total. Share evenly gives every criterion the same weight.'
        : 'Share evenly and Scale keep whole marks and add up exactly to the total you ask for.'
  const chips = rubric.taxonomy === 'none' || holistic || !weighted ? [] : cognitiveShares(rubric)
  cognitiveSummary.replaceChildren(
    ...chips.map((s) => el('span', {}, `${s.level} `, el('b', {}, `${formatNumber(Math.round(s.percent))}%`))),
  )
}

// ---------- The grid of descriptors ----------

function descriptorBox(criterion: Criterion, key: string, label: string, hint: string): HTMLTextAreaElement {
  const box = el('textarea', {
    value: criterion.descriptors[key] ?? '',
    maxLength: 600,
    rows: 4,
    placeholder: hint,
  })
  box.dataset.criterion = criterion.id
  box.dataset.key = key
  box.setAttribute('aria-label', label)
  return box
}

function renderGrid(): void {
  const style = rubric.style
  gridPanel.hidden = style === 'checklist' || rubric.criteria.length === 0
  grid.classList.toggle('wide-cells', style !== 'analytic')
  if (gridPanel.hidden) {
    grid.replaceChildren()
    return
  }
  gridHelp.textContent =
    style === 'analytic'
      ? 'Say what the work looks like at each level of each criterion. Describe what is there, not what is missing, and keep the wording parallel across a row.'
      : style === 'holistic'
        ? 'Say what the whole piece of work looks like at each level.'
        : 'Describe only the expected standard. On the sheet there is space either side for what fell short and what went beyond.'

  if (style === 'analytic') {
    const head = el(
      'tr',
      {},
      el('th', { scope: 'col' }, 'Criterion'),
      ...rubric.levels.map((l) => {
        const th = el('th', { scope: 'col' }, l.name.trim() || 'Level', el('span', { className: 'worth' }))
        th.dataset.level = l.id
        return th
      }),
    )
    const body = rubric.criteria.map((c, i) => {
      const name = c.name.trim() || `Criterion ${i + 1}`
      const th = el('th', { scope: 'row' }, name, el('span', { className: 'worth' }))
      const tr = el(
        'tr',
        {},
        th,
        ...rubric.levels.map((l) => {
          const band = el('span', { className: 'band' })
          band.dataset.level = l.id
          return el(
            'td',
            {},
            descriptorBox(c, l.id, `${name}, ${l.name.trim() || 'level'}`, levelHint(rubric, l)),
            band,
          )
        }),
      )
      tr.dataset.id = c.id
      return tr
    })
    grid.replaceChildren(el('thead', {}, head), el('tbody', {}, ...body))
  } else if (style === 'holistic') {
    const c = rubric.criteria[0]!
    const body = rubric.levels.map((l) => {
      const band = el('span', { className: 'band' })
      band.dataset.level = l.id
      const tr = el(
        'tr',
        {},
        el('th', { scope: 'row' }, l.name.trim() || 'Level', el('br'), band),
        el('td', {}, descriptorBox(c, l.id, l.name.trim() || 'level', levelHint(rubric, l))),
      )
      tr.dataset.id = c.id
      return tr
    })
    grid.replaceChildren(
      el(
        'thead',
        {},
        el('tr', {}, el('th', { scope: 'col' }, 'Level'), el('th', { scope: 'col' }, 'What the work looks like')),
      ),
      el('tbody', {}, ...body),
    )
  } else {
    const body = rubric.criteria.map((c, i) => {
      const name = c.name.trim() || `Criterion ${i + 1}`
      const tr = el(
        'tr',
        {},
        el('th', { scope: 'row' }, name, el('span', { className: 'worth' })),
        el(
          'td',
          {},
          descriptorBox(c, TARGET, `${name}, the expected standard`, 'What work that meets the standard does.'),
        ),
      )
      tr.dataset.id = c.id
      return tr
    })
    grid.replaceChildren(
      el(
        'thead',
        {},
        el('tr', {}, el('th', { scope: 'col' }, 'Criterion'), el('th', { scope: 'col' }, 'The expected standard')),
      ),
      el('tbody', {}, ...body),
    )
  }
  renderBands()
}

/** The marks shown in the grid: what each level and each box is worth. */
function renderBands(): void {
  if (gridPanel.hidden) return
  const marks = criterionMarks(rubric)
  const weighted = givesMarks(rubric)
  grid.querySelectorAll<HTMLElement>('thead th[data-level] .worth').forEach((node) => {
    const level = rubric.levels.find((l) => l.id === node.parentElement!.dataset.level)
    node.textContent = level && Number.isFinite(level.percent) ? `${formatNumber(level.percent)}% of the marks` : ''
  })
  grid.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
    const index = rubric.criteria.findIndex((c) => c.id === tr.dataset.id)
    const worth = tr.querySelector<HTMLElement>('th .worth')
    if (worth) worth.textContent = weighted && index >= 0 ? plural(Number(formatNumber(marks[index]!)), 'mark') : ''
    if (index < 0 || !usesLevels(rubric.style)) return
    const bands = levelBands(marks[index]!, rubric.levels, rubric.showRanges)
    tr.querySelectorAll<HTMLElement>('.band').forEach((node) => {
      const k = rubric.levels.findIndex((l) => l.id === node.dataset.level)
      node.textContent = k >= 0 ? bandLabel(bands[k]!) : ''
    })
  })
}

// ---------- Options, problems and the download ----------

function renderOptions(): void {
  titleInput.value = rubric.title
  taskInput.value = rubric.task
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="style"]')) {
    radio.checked = radio.value === rubric.style
  }
  showStyleHelp()
  scaleSelect.value = rubric.scaleId
  showScaleHelp()
  marking.checked = rubric.marking
  showPercent.checked = rubric.showPercent
  reportOutOf.value = rubric.reportOutOf === null ? '' : numberText(rubric.reportOutOf)
  showLevel.checked = rubric.showLevel
  showSummary.checked = rubric.showSummary
  if (!saveName.value) saveName.value = rubric.title
}

function chosenStyle(): RubricStyle {
  const checked = document.querySelector<HTMLInputElement>('input[name="style"]:checked')
  return (checked?.value as RubricStyle | undefined) ?? rubric.style
}

function showStyleHelp(): void {
  styleHelp.textContent = STYLES.find((s) => s.id === chosenStyle())?.description ?? ''
}

function showScaleHelp(): void {
  scaleHelp.textContent = isScaleId(scaleSelect.value) ? scaleById(scaleSelect.value).description : ''
}

function sheetList(count: number): string {
  if (!rubric.marking || count === 0) return 'The file has one sheet: the rubric, ready to print.'
  const parts = ['the Rubric to print']
  if (rubric.showSummary) parts.push(usesLevels(rubric.style) ? 'a class Summary and Levels' : 'a class Summary')
  parts.push(`${plural(count, 'learner sheet')} to mark`, 'Notes')
  return `The file has ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`
}

/** Everything that depends on the rubric but needs no editor rebuilt. */
function refresh(): void {
  persist()
  renderWeights()
  renderBands()
  markingBlock.hidden = !rubric.marking
  markOptions.hidden = !givesMarks(rubric)
  const list = rubric.marking ? learners() : []
  const check = checkRubric(rubric)
  const errors = [...check.errors]
  if (rubric.marking) {
    const problem = learnerProblem(list.length)
    if (problem) errors.push(problem)
    learnerSummary.textContent =
      list.length > 0 && list.length <= MAX_LEARNERS ? `${plural(list.length, 'learner sheet')} in the workbook.` : ''
  }
  problems.replaceChildren(
    ...errors.map((text) => el('li', { className: 'error-item', textContent: text })),
    ...check.warnings.map((text) => el('li', { textContent: text })),
  )
  downloadButton.disabled = errors.length > 0
  fileSummary.textContent = errors.length > 0 ? '' : sheetList(list.length)
}

/** Rebuilds every editor from the rubric, after a change to its shape. */
function renderAll(): void {
  renderOptions()
  renderLevels()
  renderCriteria()
  renderGrid()
  refresh()
}

function renderSaved(selected?: string): void {
  savedSelect.replaceChildren(
    ...(saved.length === 0 ? [new Option('No saved rubrics yet', '')] : saved.map((s) => new Option(s.name, s.name))),
  )
  savedSelect.disabled = saved.length === 0
  loadSaved.disabled = saved.length === 0
  deleteSaved.disabled = saved.length === 0
  if (selected) savedSelect.value = selected
}

function replaceRubric(next: Rubric): void {
  rubric = next
  saveName.value = ''
  scaleTotal.value = ''
  renderAll()
}

// ---------- Events: start ----------

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="style"]')) {
  radio.addEventListener('change', showStyleHelp)
}

byId('start-new').addEventListener('click', () => {
  const style = chosenStyle()
  replaceRubric(newRubric(style))
  startStatus.textContent = `Started a new ${STYLES.find((s) => s.id === style)!.name.toLowerCase()} rubric, with an example to write over.`
})

loadSaved.addEventListener('click', () => {
  const found = saved.find((s) => s.name === savedSelect.value)
  if (!found) return
  replaceRubric(parseRubric(JSON.parse(JSON.stringify(found.rubric)))!)
  saveName.value = found.name
  startStatus.textContent = `Loaded "${found.name}".`
})

deleteSaved.addEventListener('click', () => {
  const name = savedSelect.value
  if (!name) return
  saved = saved.filter((s) => s.name !== name)
  write(SAVED_KEY, JSON.stringify(saved))
  renderSaved()
  startStatus.textContent = `Deleted "${name}".`
})

saveRubric.addEventListener('click', () => {
  const name = saveName.value.trim() || rubric.title.trim() || 'Rubric'
  saved = upsertSaved(saved, { name, savedAt: Date.now(), rubric: JSON.parse(JSON.stringify(rubric)) as Rubric })
  write(SAVED_KEY, JSON.stringify(saved))
  renderSaved(name)
  downloadStatus.textContent = `Saved "${name}" in this browser.`
})

// ---------- Events: details and levels ----------

titleInput.addEventListener('input', () => {
  rubric.title = titleInput.value
  refresh()
})

taskInput.addEventListener('input', () => {
  rubric.task = taskInput.value
  refresh()
})

function move<T>(list: T[], index: number, by: number): void {
  const target = index + by
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item!)
}

function itemOf(event: Event): { id: string; field?: string; action?: string; target: HTMLElement } | null {
  const target = event.target as HTMLElement
  const li = target.closest<HTMLElement>('li[data-id]')
  if (!li) return null
  const button = target.closest<HTMLElement>('button[data-action]')
  return { id: li.dataset.id!, field: target.dataset.field, action: button?.dataset.action, target }
}

levelList.addEventListener('input', (e) => {
  const item = itemOf(e)
  const level = rubric.levels.find((l) => l.id === item?.id)
  if (!item || !level) return
  if (item.field === 'name') {
    level.name = (item.target as HTMLInputElement).value
    // The grid shows level names, but rebuilding it now would not disturb this input.
    renderGrid()
  }
  if (item.field === 'percent') level.percent = numberFrom(item.target as HTMLInputElement)
  refresh()
})

levelList.addEventListener('click', (e) => {
  const item = itemOf(e)
  if (!item?.action) return
  const index = rubric.levels.findIndex((l) => l.id === item.id)
  if (index < 0) return
  if (item.action === 'up') move(rubric.levels, index, -1)
  if (item.action === 'down') move(rubric.levels, index, 1)
  if (item.action === 'remove' && rubric.levels.length > 2) {
    const [gone] = rubric.levels.splice(index, 1)
    for (const c of rubric.criteria) delete c.descriptors[gone!.id]
  }
  renderLevels()
  renderGrid()
  refresh()
})

addLevel.addEventListener('click', () => {
  if (rubric.levels.length >= MAX_LEVELS) return
  rubric.levels.push({ id: newId('l'), name: `Level ${rubric.levels.length + 1}`, percent: 0 })
  renderLevels()
  renderGrid()
  refresh()
})

byId('reverse-levels').addEventListener('click', () => {
  rubric.levels.reverse()
  renderLevels()
  renderGrid()
  refresh()
})

showRanges.addEventListener('change', () => {
  rubric.showRanges = showRanges.checked
  refresh()
})

scaleSelect.addEventListener('change', showScaleHelp)

byId('use-scale').addEventListener('click', () => {
  if (!isScaleId(scaleSelect.value)) return
  const scale = scaleById(scaleSelect.value)
  const fresh = levelsFromScale(scale.id).map((l) => ({ ...l, id: newId('l') }))
  // Descriptors stay with their position: the first level's text moves to the new first level.
  for (const c of rubric.criteria) {
    const kept: Record<string, string> = {}
    fresh.forEach((l, i) => {
      const old = rubric.levels[i]
      const body = old ? c.descriptors[old.id] : undefined
      if (body) kept[l.id] = body
    })
    c.descriptors = kept
  }
  rubric.levels = fresh
  rubric.scaleId = scale.id
  rubric.showRanges = scale.ranges
  renderLevels()
  renderGrid()
  refresh()
})

// ---------- Events: criteria and weights ----------

scored.addEventListener('change', () => {
  rubric.scored = scored.checked
  renderCriteria()
  renderGrid()
  refresh()
})

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="weight-mode"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked || radio.value === rubric.weightMode) return
    // Keep what every criterion is worth: marks become their share of the total, and back again.
    if (radio.value === 'percent') {
      const total = rubricTotal(rubric)
      const shares = scaleToTotal(criterionMarks(rubric), 100)
      rubric.criteria.forEach((c, i) => (c.weight = shares[i]!))
      rubric.total = total > 0 ? total : 20
      rubric.weightMode = 'percent'
    } else {
      const marks = criterionMarks(rubric)
      rubric.criteria.forEach((c, i) => (c.weight = marks[i]!))
      rubric.weightMode = 'marks'
    }
    renderCriteria()
    refresh()
  })
}

totalInput.addEventListener('input', () => {
  rubric.total = numberFrom(totalInput)
  refresh()
})

taxonomy.addEventListener('change', () => {
  if (!isCognitiveId(taxonomy.value)) return
  rubric.taxonomy = taxonomy.value
  for (const c of rubric.criteria) c.cognitive = null
  renderCriteria()
  refresh()
})

criterionList.addEventListener('input', (e) => {
  const item = itemOf(e)
  const criterion = rubric.criteria.find((c) => c.id === item?.id)
  if (!item || !criterion) return
  if (item.field === 'name') {
    criterion.name = (item.target as HTMLInputElement).value
    renderGrid()
  }
  if (item.field === 'weight') criterion.weight = numberFrom(item.target as HTMLInputElement)
  refresh()
})

criterionList.addEventListener('change', (e) => {
  const item = itemOf(e)
  const criterion = rubric.criteria.find((c) => c.id === item?.id)
  if (!item || !criterion || item.field !== 'cognitive') return
  criterion.cognitive = (item.target as HTMLSelectElement).value || null
  refresh()
})

criterionList.addEventListener('click', (e) => {
  const item = itemOf(e)
  if (!item?.action) return
  const index = rubric.criteria.findIndex((c) => c.id === item.id)
  if (index < 0) return
  if (item.action === 'up') move(rubric.criteria, index, -1)
  if (item.action === 'down') move(rubric.criteria, index, 1)
  if (item.action === 'remove' && rubric.criteria.length > 1) rubric.criteria.splice(index, 1)
  renderCriteria()
  renderGrid()
  refresh()
})

addCriterion.addEventListener('click', () => {
  if (rubric.criteria.length >= MAX_CRITERIA) return
  const last = rubric.criteria[rubric.criteria.length - 1]
  rubric.criteria.push({
    id: newId('c'),
    name: '',
    weight: rubric.weightMode === 'percent' ? 0 : (last?.weight ?? 4),
    cognitive: null,
    descriptors: {},
  })
  renderCriteria()
  renderGrid()
  refresh()
  criterionList.querySelector<HTMLInputElement>('li:last-child input[data-field="name"]')?.focus()
})

byId('share-evenly').addEventListener('click', () => {
  const total = rubric.weightMode === 'percent' ? 100 : rubricTotal(rubric) || rubric.criteria.length
  const parts = shareEvenly(rubric.criteria.length, total)
  rubric.criteria.forEach((c, i) => (c.weight = parts[i]!))
  renderCriteria()
  refresh()
})

byId('scale-weights').addEventListener('click', () => {
  const target = numberFrom(scaleTotal)
  if (!(target > 0)) {
    scaleTotal.focus()
    return
  }
  if (rubric.weightMode === 'percent') {
    rubric.total = target
  } else {
    const scaled = scaleToTotal(
      rubric.criteria.map((c) => c.weight),
      target,
    )
    rubric.criteria.forEach((c, i) => (c.weight = scaled[i]!))
  }
  renderCriteria()
  refresh()
})

grid.addEventListener('input', (e) => {
  const box = e.target as HTMLTextAreaElement
  const criterion = rubric.criteria.find((c) => c.id === box.dataset.criterion)
  if (!criterion || !box.dataset.key) return
  criterion.descriptors[box.dataset.key] = box.value
  refresh()
})

// ---------- Events: marking and the download ----------

marking.addEventListener('change', () => {
  rubric.marking = marking.checked
  refresh()
})

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
  radio.addEventListener('change', () => {
    write(SOURCE_KEY, source())
    showSource()
    refresh()
  })
}

classSelect.addEventListener('change', () => {
  write(CLASS_KEY, classSelect.value)
  refresh()
})

namesText.addEventListener('input', refresh)

blankSheets.addEventListener('input', () => {
  write(SHEETS_KEY, blankSheets.value)
  refresh()
})

showPercent.addEventListener('change', () => {
  rubric.showPercent = showPercent.checked
  refresh()
})

reportOutOf.addEventListener('input', () => {
  rubric.reportOutOf = reportOutOf.value.trim() === '' ? null : numberFrom(reportOutOf)
  refresh()
})

showLevel.addEventListener('change', () => {
  rubric.showLevel = showLevel.checked
  refresh()
})

showSummary.addEventListener('change', () => {
  rubric.showSummary = showSummary.checked
  refresh()
})

downloadButton.addEventListener('click', async () => {
  if (checkRubric(rubric).errors.length > 0) return
  downloadButton.disabled = true
  downloadStatus.textContent = 'Building the Excel file…'
  try {
    const list = rubric.marking ? learners() : []
    const sheets = buildWorkbook(rubric, list)
    const bytes = await writeWorkbook(sheets)
    const name = rubricFileName(rubric.title)
    downloadFile(bytes, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    downloadStatus.textContent = `Downloaded ${name} with ${plural(sheets.length, 'sheet')}.`
  } catch {
    downloadStatus.textContent = 'The Excel file could not be made. Please try again.'
  } finally {
    refresh()
  }
})

async function start(): Promise<void> {
  scaleSelect.replaceChildren(...SCALES.map((s) => new Option(s.name, s.id)))
  taxonomy.replaceChildren(...COGNITIVE.map((t) => new Option(t.name, t.id)))
  renderSaved()
  await loadClasses()
  const lastSource = read(SOURCE_KEY)
  const wanted = lastSource === 'class' || lastSource === 'paste' ? lastSource : 'blank'
  // A remembered Class list source falls back to blank sheets when there are no Class lists.
  const use = wanted === 'class' && classes.length === 0 ? 'blank' : wanted
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
    radio.checked = radio.value === use
  }
  const lastSheets = read(SHEETS_KEY)
  if (lastSheets) blankSheets.value = lastSheets
  showSource()
  renderAll()
  document.body.dataset.ready = 'true'
}

void start()
