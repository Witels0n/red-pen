import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { ClassStorageError, listClasses, rowsFromNames, type ClassList } from '../shared/classes'
import { downloadFile } from '../shared/pdf/download'
import {
  PRESETS,
  checkDesign,
  formatNumber,
  newId,
  parseDesign,
  parseSavedDesigns,
  presetDesign,
  upsertSaved,
  type MarkbookDesign,
  type PresetId,
  type Rounding,
  type SavedDesign,
} from './design'
import {
  buildLayout,
  learnerFormula,
  numberFormat,
  summaryFormula,
  SUMMARY_LABELS,
  type Column,
  type Layout,
} from './layout'
import { learnerRow, sampleMarks, summaryValue, type CellValue } from './maths'
import { buildMarkbook, markbookFileName, writeMarkbook, type SheetLearner } from './sheet'

registerOffline(mountSiteHeader({ toolName: 'Markbook builder' }))

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

// ---------- Storage (designs never hold learner names) ----------

const DESIGN_KEY = 'red-pen.markbook.design'
const SAVED_KEY = 'red-pen.markbook.saved'
const SOURCE_KEY = 'red-pen.markbook.source'
const CLASS_KEY = 'red-pen.markbook.class'
const ROWS_KEY = 'red-pen.markbook.rows'

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

let design: MarkbookDesign = parseDesign(readJson(DESIGN_KEY)) ?? presetDesign('term')
let saved: SavedDesign[] = parseSavedDesigns(readJson(SAVED_KEY))

function persist(): void {
  write(DESIGN_KEY, JSON.stringify(design))
}

// ---------- Elements ----------

const presetSelect = byId<HTMLSelectElement>('preset-select')
const presetHelp = byId('preset-help')
const savedSelect = byId<HTMLSelectElement>('saved-select')
const loadSaved = byId<HTMLButtonElement>('load-saved')
const deleteSaved = byId<HTMLButtonElement>('delete-saved')
const startStatus = byId('start-status')
const classSelect = byId<HTMLSelectElement>('class-select')
const noClasses = byId('no-classes')
const namesText = byId<HTMLTextAreaElement>('names-text')
const blankRows = byId<HTMLInputElement>('blank-rows')
const learnerSummary = byId('learner-summary')
const titleInput = byId<HTMLInputElement>('title')
const markLabel = byId<HTMLInputElement>('mark-label')
const useCategories = byId<HTMLInputElement>('use-categories')
const categoriesBlock = byId('categories-block')
const categoryList = byId<HTMLUListElement>('category-list')
const categoryTotal = byId('category-total')
const assessmentHelp = byId('assessment-help')
const assessmentList = byId<HTMLUListElement>('assessment-list')
const assessmentTotal = byId('assessment-total')
const showPercentages = byId<HTMLInputElement>('show-percentages')
const rounding = byId<HTMLSelectElement>('rounding')
const showLevel = byId<HTMLInputElement>('show-level')
const showResult = byId<HTMLInputElement>('show-result')
const passMark = byId<HTMLInputElement>('pass-mark')
const showSummary = byId<HTMLInputElement>('show-summary')
const showFormulas = byId<HTMLInputElement>('show-formulas')
const previewCaption = byId('preview-caption')
const preview = byId<HTMLTableElement>('preview')
const problems = byId<HTMLUListElement>('problems')
const downloadButton = byId<HTMLButtonElement>('download')
const downloadStatus = byId('download-status')
const saveName = byId<HTMLInputElement>('save-name')
const saveDesign = byId<HTMLButtonElement>('save-design')

const TINTS = ['#d3212d', '#2a5bd7', '#2a7a3b', '#b07800', '#7a3fc2', '#13807f']

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

/** The learners for the download, and the heading of the first column. */
function learners(): { list: SheetLearner[]; idHeader: string } {
  switch (source()) {
    case 'class': {
      const chosen = classes.find((c) => c.id === classSelect.value)
      return {
        list: (chosen?.learners ?? []).map((l) => ({ id: l.id, name: l.name ?? '' })),
        idHeader: 'Learner ID',
      }
    }
    case 'paste': {
      const names = rowsFromNames(namesText.value)
        .map((r) => r[0])
        .filter((n) => n !== '')
      return { list: names.map((name, i) => ({ id: String(i + 1), name })), idHeader: 'No.' }
    }
    case 'blank': {
      const n = Math.min(500, Math.max(0, Math.floor(numberFrom(blankRows)) || 0))
      return { list: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: '' })), idHeader: 'No.' }
    }
  }
}

function learnerProblem(count: number): string | null {
  if (count > 0) return null
  switch (source()) {
    case 'class':
      return classes.length === 0 ? 'There is no Class list on this device yet.' : 'This Class list has no learners.'
    case 'paste':
      return 'Paste at least one name.'
    case 'blank':
      return 'Choose a number of rows from 1 to 500.'
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

function tintOf(categoryId: string | null): string {
  const i = design.categories.findIndex((c) => c.id === categoryId)
  return TINTS[(i < 0 ? 0 : i) % TINTS.length]
}

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

function renderCategories(): void {
  categoriesBlock.hidden = !design.useCategories
  categoryList.replaceChildren(
    ...design.categories.map((c, i) => {
      const name = el('input', { type: 'text', value: c.name, maxLength: 40 })
      name.dataset.field = 'name'
      const li = el(
        'li',
        { className: 'edit-item category' },
        el('label', { className: 'field name-field' }, el('span', {}, 'Category'), name),
        numberField('Weight (%)', 'weight', c.weight),
        itemButtons(i, design.categories.length, c.name || 'this Category', design.categories.length > 1),
      )
      li.dataset.id = c.id
      li.style.setProperty('--tint', tintOf(c.id))
      return li
    }),
  )
}

function renderAssessments(): void {
  assessmentHelp.textContent = design.useCategories
    ? "Each assessment's weight is its share of its Category, so the weights in each Category add up to 100%."
    : 'Each weight is the share of the weighted mark, so the weights add up to 100%.'
  assessmentList.replaceChildren(
    ...design.assessments.map((a, i) => {
      const name = el('input', { type: 'text', value: a.name, maxLength: 40 })
      name.dataset.field = 'name'
      const li = el(
        'li',
        { className: design.useCategories ? 'edit-item' : 'edit-item no-category' },
        el('label', { className: 'field name-field' }, el('span', {}, 'Assessment'), name),
        numberField('Out of', 'outOf', a.outOf, { min: '1' }),
        numberField('Weight (%)', 'weight', a.weight),
      )
      if (design.useCategories) {
        const select = el(
          'select',
          {},
          ...design.categories.map((c) => new Option(c.name.trim() || 'Unnamed Category', c.id)),
        )
        select.value = a.categoryId ?? ''
        select.dataset.field = 'category'
        li.append(el('label', { className: 'field category-field' }, el('span', {}, 'Category'), select))
        li.style.setProperty('--tint', tintOf(a.categoryId))
      }
      li.append(itemButtons(i, design.assessments.length, a.name || 'this assessment', design.assessments.length > 1))
      li.dataset.id = a.id
      return li
    }),
  )
}

function renderOptions(): void {
  titleInput.value = design.title
  markLabel.value = design.markLabel
  useCategories.checked = design.useCategories
  showPercentages.checked = design.showPercentages
  rounding.value = design.rounding
  showLevel.checked = design.showLevel
  showResult.checked = design.showResult
  passMark.value = numberText(design.passMark)
  passMark.disabled = !design.showResult
  showSummary.checked = design.showSummary
  if (!saveName.value) saveName.value = design.title
}

function setTotal(target: HTMLElement, total: number, label: string): void {
  const ok = Math.abs(total - 100) < 1e-6
  target.textContent = Number.isFinite(total)
    ? `${label} ${formatNumber(total)}%${ok ? ' ✓' : ', should be 100%'}`
    : `${label}: check the weights`
  target.className = `total ${ok ? 'ok' : 'off'}`
}

function renderTotals(): void {
  if (design.useCategories) {
    setTotal(
      categoryTotal,
      design.categories.reduce((t, c) => t + c.weight, 0),
      'Total',
    )
    const parts = design.categories.map((c) => {
      const inside = design.assessments.filter((a) => a.categoryId === c.id).reduce((t, a) => t + a.weight, 0)
      return { name: c.name.trim() || 'Unnamed', inside }
    })
    const allOk = parts.every((p) => Math.abs(p.inside - 100) < 1e-6)
    assessmentTotal.textContent = parts.map((p) => `${p.name} ${formatNumber(p.inside)}%`).join(', ')
    assessmentTotal.className = `total ${allOk ? 'ok' : 'off'}`
  } else {
    setTotal(
      assessmentTotal,
      design.assessments.reduce((t, a) => t + a.weight, 0),
      'Total',
    )
  }
}

function renderEditors(): void {
  renderOptions()
  renderCategories()
  renderAssessments()
}

// ---------- Preview ----------

const SAMPLE_ROWS = 5

function display(value: CellValue | undefined, format: string | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (format === '0') return value.toFixed(0)
  if (format === '0.0') return value.toFixed(1)
  return formatNumber(value)
}

function cellTint(column: Column): string | undefined {
  if (!design.useCategories) return undefined
  const categoryId = column.categoryId ?? design.assessments.find((a) => a.id === column.assessmentId)?.categoryId
  return categoryId ? tintOf(categoryId) : undefined
}

function td(text: string, className = '', formula?: string | null, tint?: string): HTMLTableCellElement {
  const cell = el('td', { className, textContent: text })
  if (formula) {
    cell.title = formula
    cell.dataset.formula = formula
    if (showFormulas.checked) cell.textContent = formula
  }
  if (tint) {
    cell.dataset.tint = ''
    cell.style.setProperty('--tint', tint)
  }
  return cell
}

function renderPreview(layout: Layout, realRows: number): void {
  const cols = layout.columns
  const rows: HTMLTableRowElement[] = []
  const rownum = (n: number | string) => el('th', { className: 'rownum', scope: 'row', textContent: String(n) })

  rows.push(
    el(
      'tr',
      { className: 'letters' },
      el('th', { className: 'rownum' }),
      ...cols.map((c) => el('th', { scope: 'col', textContent: c.letter })),
    ),
  )
  rows.push(
    el(
      'tr',
      { className: 'head' },
      rownum(1),
      ...cols.map((c) => td(c.header, c.kind === 'id' ? 'text' : '', null, cellTint(c))),
    ),
  )
  rows.push(
    el(
      'tr',
      {},
      rownum(2),
      ...cols.map((c) =>
        c.kind === 'name' ? td('Out of', 'label') : td(c.outOf !== undefined ? numberText(c.outOf) : ''),
      ),
    ),
  )
  rows.push(
    el(
      'tr',
      {},
      rownum(3),
      ...cols.map((c) =>
        c.kind === 'name' ? td('Weight (%)', 'label') : td(c.weight !== undefined ? numberText(c.weight) : ''),
      ),
    ),
  )

  const shown = Math.min(SAMPLE_ROWS, realRows)
  const marks = sampleMarks(design, shown)
  const values = marks.map((m, i) =>
    learnerRow(design, layout, { id: String(i + 1), name: `Sample learner ${String.fromCharCode(65 + i)}` }, m),
  )
  values.forEach((row, i) => {
    const r = layout.firstRow + i
    rows.push(
      el(
        'tr',
        {},
        rownum(r),
        ...cols.map((c, j) => {
          const v = row[j]
          const f = learnerFormula(design, layout, c, r)
          const classes = [
            f ? 'calc' : '',
            c.kind === 'name' || c.kind === 'id' ? 'text' : '',
            typeof v === 'string' && c.kind === 'mark' ? 'absent' : '',
            v === 'Fail' ? 'fail' : '',
          ]
          return td(display(v, numberFormat(design, c)), classes.filter(Boolean).join(' '), f)
        }),
      ),
    )
  })
  if (realRows > shown) {
    rows.push(
      el(
        'tr',
        { className: 'gap' },
        rownum('⋮'),
        el('td', {
          colSpan: cols.length,
          textContent: `${plural(realRows - shown, 'more learner row')} in the download`,
        }),
      ),
    )
  }

  if (layout.summary.length > 0) {
    rows.push(el('tr', {}, rownum(layout.lastRow + 1), ...cols.map(() => td(''))))
    for (const s of layout.summary) {
      rows.push(
        el(
          'tr',
          { className: 'summary' },
          rownum(s.row),
          ...cols.map((c, j) => {
            if (c.kind === 'name') return td(SUMMARY_LABELS[s.kind], 'text')
            const f = summaryFormula(design, layout, c, s.kind)
            const v = f
              ? summaryValue(
                  design,
                  c,
                  s.kind,
                  values.map((row) => row[j]),
                )
              : undefined
            return td(display(v, numberFormat(design, c, s.kind)), f ? 'calc' : '', f)
          }),
        ),
      )
    }
  }
  preview.classList.toggle('formulas', showFormulas.checked)
  preview.replaceChildren(el('tbody', {}, ...rows))
  previewCaption.textContent =
    `Made-up marks for ${plural(shown, 'sample learner')} show what the formulas do` +
    (marks.some((m) => Object.values(m).includes('ABS'))
      ? ', including an absent learner (ABS) and a blank mark'
      : '') +
    `. The download has ${plural(realRows, 'learner row')} with empty mark cells` +
    (layout.summary.length > 0 && realRows > shown ? ', and its summary covers every row.' : '.')
}

// ---------- Problems and refresh ----------

function refresh(): void {
  persist()
  renderTotals()
  const { list } = learners()
  learnerSummary.textContent = list.length > 0 ? `${plural(list.length, 'learner row')} in the markbook.` : ''
  const check = checkDesign(design)
  const learnerError = learnerProblem(list.length)
  const errors = learnerError ? [learnerError, ...check.errors] : check.errors
  problems.replaceChildren(
    ...errors.map((e) => el('li', { className: 'error-item', textContent: e })),
    ...check.warnings.map((w) => el('li', { textContent: w })),
  )
  downloadButton.disabled = errors.length > 0
  if (check.errors.length === 0) {
    renderPreview(buildLayout(design, Math.max(1, list.length), learners().idHeader), Math.max(1, list.length))
  } else {
    preview.replaceChildren()
    previewCaption.textContent = 'Fix the problems listed under Download to see the preview.'
  }
}

// ---------- Saved designs ----------

function renderSaved(selected?: string): void {
  savedSelect.replaceChildren(
    ...(saved.length === 0 ? [new Option('No saved designs yet', '')] : saved.map((s) => new Option(s.name, s.name))),
  )
  savedSelect.disabled = saved.length === 0
  loadSaved.disabled = saved.length === 0
  deleteSaved.disabled = saved.length === 0
  if (selected && saved.some((s) => s.name === selected)) savedSelect.value = selected
}

function storeSaved(): void {
  write(SAVED_KEY, JSON.stringify(saved))
}

function replaceDesign(next: MarkbookDesign): void {
  design = structuredClone(next)
  saveName.value = design.title
  renderEditors()
  refresh()
}

// ---------- Events ----------

presetSelect.replaceChildren(...PRESETS.map((p) => new Option(p.name, p.id)))
function presetHelpText(): void {
  const p = PRESETS.find((x) => x.id === presetSelect.value)
  presetHelp.textContent = p ? `${p.description} This replaces the assessments below.` : ''
}
presetSelect.addEventListener('change', presetHelpText)
byId('use-preset').addEventListener('click', () => {
  replaceDesign(presetDesign(presetSelect.value as PresetId))
  startStatus.textContent = `Started from ${presetSelect.selectedOptions[0]?.text ?? 'the layout'}.`
})

loadSaved.addEventListener('click', () => {
  const s = saved.find((x) => x.name === savedSelect.value)
  if (!s) return
  replaceDesign(s.design)
  saveName.value = s.name
  startStatus.textContent = `Loaded ${s.name}.`
})
deleteSaved.addEventListener('click', () => {
  const name = savedSelect.value
  if (!name) return
  saved = saved.filter((s) => s.name !== name)
  storeSaved()
  renderSaved()
  startStatus.textContent = `Deleted ${name}.`
})
saveDesign.addEventListener('click', () => {
  const name = saveName.value.trim() || design.title.trim() || 'Markbook'
  saved = upsertSaved(saved, { name, savedAt: Date.now(), design: structuredClone(design) })
  storeSaved()
  renderSaved(name)
  downloadStatus.textContent = `Saved the design as ${name}.`
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
blankRows.addEventListener('input', () => {
  write(ROWS_KEY, blankRows.value)
  refresh()
})

titleInput.addEventListener('input', () => {
  design.title = titleInput.value
  refresh()
})
markLabel.addEventListener('input', () => {
  design.markLabel = markLabel.value
  refresh()
})
useCategories.addEventListener('change', () => {
  design.useCategories = useCategories.checked
  if (design.useCategories) {
    if (design.categories.length === 0) design.categories.push({ id: newId('c'), name: 'Category 1', weight: 100 })
    const first = design.categories[0].id
    const ids = new Set(design.categories.map((c) => c.id))
    const orphans = design.assessments.filter((a) => !a.categoryId || !ids.has(a.categoryId))
    for (const a of orphans) a.categoryId = first
  }
  renderCategories()
  renderAssessments()
  refresh()
})

function move<T>(list: T[], index: number, by: number): void {
  const to = index + by
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(to, 0, item)
}

categoryList.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement
  const id = target.closest<HTMLElement>('li')?.dataset.id
  const c = design.categories.find((x) => x.id === id)
  if (!c) return
  if (target.dataset.field === 'name') {
    c.name = target.value
    renderAssessments()
  } else if (target.dataset.field === 'weight') {
    c.weight = numberFrom(target)
  }
  refresh()
})
categoryList.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  const id = button?.closest<HTMLElement>('li')?.dataset.id
  const index = design.categories.findIndex((x) => x.id === id)
  if (!button || index < 0) return
  if (button.dataset.action === 'up') move(design.categories, index, -1)
  if (button.dataset.action === 'down') move(design.categories, index, 1)
  if (button.dataset.action === 'remove' && design.categories.length > 1) {
    const [gone] = design.categories.splice(index, 1)
    const fallback = design.categories[0].id
    for (const a of design.assessments) if (a.categoryId === gone.id) a.categoryId = fallback
  }
  renderCategories()
  renderAssessments()
  refresh()
})
byId('add-category').addEventListener('click', () => {
  design.categories.push({ id: newId('c'), name: `Category ${design.categories.length + 1}`, weight: 0 })
  renderCategories()
  renderAssessments()
  refresh()
  categoryList.querySelector<HTMLInputElement>('li:last-child input[data-field="name"]')?.select()
})

assessmentList.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  const li = target.closest<HTMLElement>('li')
  const a = design.assessments.find((x) => x.id === li?.dataset.id)
  if (!a || !li) return
  switch (target.dataset.field) {
    case 'name':
      a.name = target.value
      break
    case 'outOf':
      a.outOf = numberFrom(target as HTMLInputElement)
      break
    case 'weight':
      a.weight = numberFrom(target as HTMLInputElement)
      break
  }
  refresh()
})
assessmentList.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement
  if (target.dataset.field !== 'category') return
  const li = target.closest<HTMLElement>('li')
  const a = design.assessments.find((x) => x.id === li?.dataset.id)
  if (!a || !li) return
  a.categoryId = target.value
  li.style.setProperty('--tint', tintOf(a.categoryId))
  refresh()
})
assessmentList.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  const id = button?.closest<HTMLElement>('li')?.dataset.id
  const index = design.assessments.findIndex((x) => x.id === id)
  if (!button || index < 0) return
  if (button.dataset.action === 'up') move(design.assessments, index, -1)
  if (button.dataset.action === 'down') move(design.assessments, index, 1)
  if (button.dataset.action === 'remove' && design.assessments.length > 1) design.assessments.splice(index, 1)
  renderAssessments()
  refresh()
})
byId('add-assessment').addEventListener('click', () => {
  const last = design.assessments[design.assessments.length - 1]
  design.assessments.push({
    id: newId('a'),
    name: `Task ${design.assessments.length + 1}`,
    outOf: last?.outOf ?? 50,
    weight: 0,
    categoryId: design.useCategories ? (last?.categoryId ?? design.categories[0]?.id ?? null) : null,
  })
  renderAssessments()
  refresh()
  assessmentList.querySelector<HTMLInputElement>('li:last-child input[data-field="name"]')?.select()
})

showPercentages.addEventListener('change', () => {
  design.showPercentages = showPercentages.checked
  refresh()
})
rounding.addEventListener('change', () => {
  design.rounding = rounding.value as Rounding
  refresh()
})
showLevel.addEventListener('change', () => {
  design.showLevel = showLevel.checked
  refresh()
})
showResult.addEventListener('change', () => {
  design.showResult = showResult.checked
  passMark.disabled = !design.showResult
  refresh()
})
passMark.addEventListener('input', () => {
  design.passMark = numberFrom(passMark)
  refresh()
})
showSummary.addEventListener('change', () => {
  design.showSummary = showSummary.checked
  refresh()
})
showFormulas.addEventListener('change', refresh)

downloadButton.addEventListener('click', async () => {
  const { list, idHeader } = learners()
  if (list.length === 0 || checkDesign(design).errors.length > 0) return
  downloadButton.disabled = true
  downloadStatus.textContent = 'Making the markbook...'
  try {
    const { sheets } = buildMarkbook(design, list, { idHeader })
    const bytes = await writeMarkbook(sheets)
    const name = markbookFileName(design.title)
    downloadFile(bytes, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    downloadStatus.textContent = `Downloaded ${name} with ${plural(list.length, 'learner row')}.`
  } catch (error) {
    downloadStatus.textContent = `The markbook could not be made.${error instanceof Error && error.message ? ` ${error.message}` : ''}`
  } finally {
    downloadButton.disabled = false
  }
})

// ---------- Start ----------

async function start(): Promise<void> {
  presetHelpText()
  renderSaved()
  const rows = read(ROWS_KEY)
  if (rows) blankRows.value = rows
  renderEditors()
  await loadClasses()
  const last = read(SOURCE_KEY) as Source | null
  const preferred: Source =
    last === 'paste' || last === 'blank' || last === 'class' ? last : classes.length > 0 ? 'class' : 'blank'
  const radio = document.querySelector<HTMLInputElement>(`input[name="source"][value="${preferred}"]`)
  if (radio) radio.checked = true
  showSource()
  refresh()
  document.body.dataset.ready = 'true'
}

void start()
