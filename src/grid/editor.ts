// The grid editor: paper details, the question table, levels and topics, and the live summary.
import { downloadFile } from '../shared/pdf/download'
import { shareChart } from './chart'
import {
  DEFAULT_TOLERANCE,
  DIFFICULTY_NAMES,
  duplicateGrid,
  emptyRow,
  formatNumber,
  gridFileName,
  gridTitle,
  newId,
  parseNumber,
  type Difficulty,
  type Grid,
  type PaperDetails,
  type QuestionRow,
} from './core/model'
import { nextNumber } from './core/numbering'
import { applyPaste, looksLikeCells, rowsFromCells, splitCells } from './core/paste'
import { flagText, summarise, topicNames, type Share, type Summary } from './core/summary'
import { defaultTaxonomy, mapLevelsByPosition, TAXONOMY_NAMES, type TaxonomyId } from './core/taxonomy'
import { el, errorMessage, go, h, showMessage } from './dom'
import { rememberTaxonomy, savedTaxonomy } from './settings'
import { getGrid, saveGrid } from './storage'

const COLUMNS = ['number', 'marks', 'level', 'topic', 'area', 'difficulty', 'notes'] as const
type Column = (typeof COLUMNS)[number]

const tbody = el<HTMLTableElement>('question-table').tBodies[0]
const table = el<HTMLTableElement>('question-table')
const saveStatus = el('save-status')
const editError = el('edit-error')
const detailInputs: Record<keyof PaperDetails, HTMLInputElement> = {
  subject: el('d-subject'),
  grade: el('d-grade'),
  paper: el('d-paper'),
  date: el('d-date'),
  examiner: el('d-examiner'),
  moderator: el('d-moderator'),
}
const totalInput = el<HTMLInputElement>('d-total')
const toleranceInput = el<HTMLInputElement>('d-tolerance')
const showExtra = el<HTMLInputElement>('show-extra')
const taxonomySelect = el<HTMLSelectElement>('taxonomy')

let grid: Grid | null = null
let summary: Summary | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()

// ---------- Loading and saving ----------

export async function showEditor(id: string): Promise<void> {
  showMessage(editError, '')
  try {
    grid = (await getGrid(id)) ?? null
  } catch (error) {
    grid = null
    showMessage(editError, errorMessage(error))
    return
  }
  if (!grid) {
    go('#')
    return
  }
  saveStatus.textContent = 'Saved on this device'
  fillDetails()
  renderLevels()
  renderTopics()
  renderTable()
  renderSummary()
}

function scheduleSave(): void {
  saveStatus.textContent = 'Saving...'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), 400)
}

/** Saves any pending change now. Called before leaving the editor. */
export function flushSave(): Promise<void> {
  if (!saveTimer || !grid) return saving
  clearTimeout(saveTimer)
  saveTimer = null
  const snapshot = structuredClone(grid)
  saving = saving.then(async () => {
    try {
      const stored = await saveGrid(snapshot)
      if (grid?.id === stored.id) grid.updatedAt = stored.updatedAt
      if (!saveTimer) saveStatus.textContent = 'Saved on this device'
    } catch (error) {
      saveStatus.textContent = ''
      showMessage(editError, errorMessage(error))
    }
  })
  return saving
}

window.addEventListener('pagehide', () => void flushSave())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushSave()
})

/** After any edit: save soon and redraw the summary. */
function changed(): void {
  scheduleSave()
  renderSummary()
}

// ---------- Paper details ----------

function fillDetails(): void {
  const g = grid!
  for (const [k, input] of Object.entries(detailInputs)) input.value = g.details[k as keyof PaperDetails]
  totalInput.value = g.intendedTotal === null ? '' : String(g.intendedTotal)
  toleranceInput.value = String(g.tolerance)
  showExtra.checked = g.showExtra
  table.classList.toggle('show-extra', g.showExtra)
  taxonomySelect.value = g.taxonomy.id
  updateTitle()
}

function updateTitle(): void {
  if (!grid) return
  el('edit-title').textContent = gridTitle(grid)
  document.title = `${gridTitle(grid)} · Question paper grid · Red Pen`
}

for (const [k, input] of Object.entries(detailInputs)) {
  input.addEventListener('input', () => {
    if (!grid) return
    grid.details[k as keyof PaperDetails] = input.value
    updateTitle()
    scheduleSave()
  })
}

totalInput.addEventListener('input', () => {
  if (!grid) return
  const n = parseNumber(totalInput.value)
  grid.intendedTotal = n !== null && n > 0 ? n : null
  changed()
})

toleranceInput.addEventListener('input', () => {
  if (!grid) return
  const n = parseNumber(toleranceInput.value)
  grid.tolerance = n !== null && n >= 0 ? n : DEFAULT_TOLERANCE
  changed()
})

showExtra.addEventListener('change', () => {
  if (!grid) return
  grid.showExtra = showExtra.checked
  table.classList.toggle('show-extra', grid.showExtra)
  scheduleSave()
})

// ---------- The question table ----------

function levelSelect(row: QuestionRow): HTMLSelectElement {
  const select = h('select', { 'data-col': 'level', 'aria-label': `Cognitive level of question ${row.number}` })
  select.append(h('option', { value: '', text: 'Choose' }))
  grid!.taxonomy.levels.forEach((l, i) => select.append(h('option', { value: l.id, text: `${i + 1}: ${l.name}` })))
  select.value = grid!.taxonomy.levels.some((l) => l.id === row.level) ? row.level : ''
  return select
}

function difficultySelect(row: QuestionRow): HTMLSelectElement {
  const select = h('select', { 'data-col': 'difficulty', 'aria-label': `Difficulty of question ${row.number}` })
  select.append(h('option', { value: '', text: 'Not set' }))
  for (const [value, text] of Object.entries(DIFFICULTY_NAMES)) select.append(h('option', { value, text }))
  select.value = row.difficulty
  return select
}

function textInput(row: QuestionRow, col: Column, label: string, extra: Record<string, string> = {}): HTMLInputElement {
  const value = col === 'marks' ? (row.marks === null ? '' : String(row.marks)) : String(row[col] ?? '')
  return h('input', {
    type: 'text',
    'data-col': col,
    'aria-label': label,
    value,
    autocomplete: 'off',
    spellcheck: col === 'notes' || col === 'area' ? 'true' : 'false',
    ...extra,
  })
}

function cell(col: string, label: string, ...children: Node[]): HTMLTableCellElement {
  return h(
    'td',
    { class: `c-${col}${['area', 'difficulty', 'notes'].includes(col) ? ' c-extra' : ''}`, 'data-label': label },
    ...children,
  )
}

function questionRow(row: QuestionRow, index: number): HTMLTableRowElement {
  const q = row.number.trim() || String(index + 1)
  const tr = h('tr', { 'data-id': row.id })
  const remove = h('button', {
    type: 'button',
    class: 'small icon remove-row',
    'aria-label': `Remove question ${q}`,
    text: '×',
  })
  const marksCell = cell(
    'marks',
    'Marks',
    textInput(row, 'marks', `Marks for question ${q}`, { inputmode: 'decimal' }),
    h('span', { class: 'subtotal-badge', hidden: true }),
  )
  tr.append(
    cell('number', 'No.', textInput(row, 'number', `Number of question ${index + 1}`)),
    marksCell,
    cell('level', 'Level', levelSelect(row)),
    cell('topic', 'Topic', textInput(row, 'topic', `Topic of question ${q}`, { list: 'topic-options' })),
    cell('area', 'Content area', textInput(row, 'area', `Content area of question ${q}`)),
    cell('difficulty', 'Difficulty', difficultySelect(row)),
    cell('notes', 'Notes', textInput(row, 'notes', `Notes on question ${q}`)),
    h('td', { class: 'c-actions' }, remove),
  )
  return tr
}

function subtotalRow(key: string, label: string): HTMLTableRowElement {
  return h(
    'tr',
    { class: 'subtotal-row', 'data-section': key },
    h(
      'td',
      { colspan: 8 },
      h('span', { text: `Question ${label} subtotal` }),
      ' ',
      h('strong', { class: 'subtotal-value' }),
    ),
  )
}

/** Redraws the table, keeping the cursor in the same cell. */
function renderTable(): void {
  const g = grid!
  const active = document.activeElement as HTMLInputElement | null
  const focus =
    active && tbody.contains(active)
      ? {
          id: active.closest('tr')?.dataset.id,
          col: active.dataset.col,
          start: 'selectionStart' in active ? active.selectionStart : null,
        }
      : null

  const numbering = summarise(g).numbering
  const after = new Map<string, { key: string; label: string; depth: number }[]>()
  for (const s of numbering.sections) {
    if (s.headingRowId) continue
    const list = after.get(s.lastRowId) ?? []
    list.push({ key: s.key, label: s.label, depth: s.depth })
    after.set(s.lastRowId, list)
  }

  const rows: HTMLTableRowElement[] = []
  g.rows.forEach((row, i) => {
    rows.push(questionRow(row, i))
    for (const s of (after.get(row.id) ?? []).sort((a, b) => b.depth - a.depth)) rows.push(subtotalRow(s.key, s.label))
  })
  tbody.replaceChildren(...rows)
  renderTopicOptions()
  updateSubtotals()

  if (focus?.id && focus.col) {
    const target = tbody.querySelector<HTMLInputElement>(
      `tr[data-id="${CSS.escape(focus.id)}"] [data-col="${focus.col}"]`,
    )
    target?.focus()
    if (target && focus.start !== null && target instanceof HTMLInputElement) {
      try {
        target.setSelectionRange(focus.start, focus.start)
      } catch {
        // Not a text input.
      }
    }
  }
}

/** Updates the subtotal rows and heading badges in place, without redrawing the table. */
function updateSubtotals(): void {
  const s = summary ?? summarise(grid!)
  for (const section of s.numbering.sections) {
    if (section.headingRowId) {
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(section.headingRowId)}"]`)
      const badge = tr?.querySelector<HTMLElement>('.subtotal-badge')
      const input = tr?.querySelector<HTMLInputElement>('[data-col="marks"]')
      const row = grid!.rows.find((r) => r.id === section.headingRowId)
      if (badge && input && row) {
        tr!.classList.add('heading-row')
        for (const c of tr!.querySelectorAll<HTMLInputElement>('[data-col="level"], [data-col="topic"]')) {
          c.disabled = true
          c.title = 'A heading: its sub-questions carry the level and topic'
        }
        badge.hidden = false
        badge.textContent = `Subtotal ${formatNumber(section.marks, 2)}`
        input.placeholder = formatNumber(section.marks, 2)
        badge.classList.toggle('mismatch', row.marks !== null && Math.abs(row.marks - section.marks) > 1e-9)
      }
    } else {
      const v = tbody.querySelector(`tr[data-section="${CSS.escape(section.key)}"] .subtotal-value`)
      if (v) v.textContent = `${formatNumber(section.marks, 2)} marks`
    }
  }
}

function rowIndexOf(target: HTMLElement): number {
  const id = target.closest('tr')?.dataset.id
  return grid!.rows.findIndex((r) => r.id === id)
}

function focusCell(rowIndex: number, col: string): void {
  const row = grid!.rows[rowIndex]
  if (!row) return
  const target = tbody.querySelector<HTMLInputElement>(`tr[data-id="${CSS.escape(row.id)}"] [data-col="${col}"]`)
  target?.focus()
  if (target instanceof HTMLInputElement) target.select()
}

function addRow(at = grid!.rows.length): number {
  const g = grid!
  const above = g.rows[at - 1]
  const row = emptyRow(nextNumber(above?.number ?? ''))
  if (above) row.topic = above.topic
  g.rows.splice(at, 0, row)
  renderTable()
  changed()
  return at
}

tbody.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  const col = target.dataset.col as Column | undefined
  const i = rowIndexOf(target)
  if (!grid || !col || i < 0) return
  const row = grid.rows[i]
  if (col === 'marks') {
    const n = parseNumber(target.value)
    row.marks = n !== null && n >= 0 ? n : null
  } else if (col === 'difficulty') row.difficulty = target.value as Difficulty
  else row[col] = target.value
  changed()
  updateSubtotals()
})

tbody.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement
  const col = target.dataset.col
  if (!grid) return
  if (col === 'number') renderTable()
  if (col === 'topic' && target.value.trim()) {
    ensureTopics([target.value])
    renderTopics()
    renderTopicOptions()
  }
})

tbody.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('.remove-row')
  if (!button || !grid) return
  const i = rowIndexOf(button as HTMLElement)
  if (i < 0) return
  grid.rows.splice(i, 1)
  renderTable()
  changed()
  focusCell(Math.min(i, grid.rows.length - 1), 'number')
  if (grid.rows.length === 0) el('add-row').focus()
})

tbody.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement
  const col = target.dataset.col
  if (!grid || !col) return
  const i = rowIndexOf(target)
  const isSelect = target instanceof HTMLSelectElement
  const down = (e.key === 'Enter' && !e.shiftKey) || (e.key === 'ArrowDown' && !isSelect && !e.altKey)
  const up = (e.key === 'Enter' && e.shiftKey) || (e.key === 'ArrowUp' && !isSelect && !e.altKey)
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    addRow(i + 1)
    focusCell(i + 1, 'number')
    return
  }
  if (down) {
    e.preventDefault()
    if (target instanceof HTMLInputElement && target.dataset.col === 'topic')
      target.dispatchEvent(new Event('change', { bubbles: true }))
    if (i === grid.rows.length - 1) {
      if (e.key !== 'Enter') return
      addRow()
    } else if (col === 'number') renderTable()
    focusCell(i + 1, col)
  } else if (up && i > 0) {
    e.preventDefault()
    if (col === 'number') renderTable()
    focusCell(i - 1, col)
  }
})

/** Cells copied from a spreadsheet fill the table from the cell they are pasted into. */
tbody.addEventListener('paste', (e) => {
  const target = e.target as HTMLElement
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!grid || !target.dataset.col || !looksLikeCells(text)) return
  e.preventDefault()
  const start = COLUMNS.indexOf(target.dataset.col as Column)
  pasteRows(text, rowIndexOf(target), start)
})

function pasteRows(text: string, atRow: number, startColumn: number): number {
  const g = grid!
  const { rows } = rowsFromCells(splitCells(text), g.taxonomy.levels, startColumn)
  if (rows.length === 0) return 0
  g.rows = applyPaste(g.rows, rows, atRow)
  ensureTopics(rows.map((r) => r.topic ?? ''))
  if (rows.some((r) => r.area || r.difficulty || r.notes) && !g.showExtra) {
    g.showExtra = true
    showExtra.checked = true
    table.classList.add('show-extra')
  }
  renderTopics()
  renderTable()
  changed()
  return rows.length
}

el('add-row').addEventListener('click', () => {
  if (!grid) return
  const i = addRow()
  focusCell(i, 'number')
})

el('paste-add').addEventListener('click', () => {
  if (!grid) return
  const textarea = el<HTMLTextAreaElement>('paste-text')
  // Fill blank rows at the end first, then add more.
  let at = grid.rows.length
  while (at > 0 && isBlank(grid.rows[at - 1])) at--
  const n = pasteRows(textarea.value, at, 0)
  grid.rows = grid.rows.filter((r, i) => i < at + n || !isBlank(r))
  renderTable()
  textarea.value = ''
  el('paste-status').textContent = n === 0 ? 'Nothing to add.' : `Added ${n} row${n === 1 ? '' : 's'}.`
})

function isBlank(r: QuestionRow): boolean {
  return r.marks === null && !r.level && !r.topic.trim() && !r.area.trim() && !r.notes.trim() && !r.difficulty
}

// ---------- Cognitive levels ----------

function renderLevels(): void {
  const g = grid!
  const custom = g.taxonomy.id === 'custom'
  const list = el('level-list')
  list.replaceChildren(
    ...g.taxonomy.levels.map((level, i) => {
      const name = custom
        ? h('input', {
            type: 'text',
            value: level.name,
            'aria-label': `Name of level ${i + 1}`,
            'data-level': level.id,
            'data-part': 'name',
          })
        : h('span', { class: 'level-name', text: level.name })
      const target = h('input', {
        type: 'text',
        inputmode: 'decimal',
        value: String(level.target),
        'aria-label': `Target percentage for level ${i + 1}, ${level.name}`,
        'data-level': level.id,
        'data-part': 'target',
      })
      const li = h(
        'li',
        { class: 'level-row' },
        h('span', { class: 'level-number', text: `Level ${i + 1}` }),
        name,
        h('span', { class: 'target' }, target, h('span', { text: '%' })),
      )
      if (custom && g.taxonomy.levels.length > 1) {
        const remove = h('button', {
          type: 'button',
          class: 'small icon',
          'aria-label': `Remove level ${i + 1}`,
          text: '×',
        })
        remove.addEventListener('click', () => {
          g.taxonomy.levels.splice(i, 1)
          for (const r of g.rows) if (r.level === level.id) r.level = ''
          levelsChanged(true)
        })
        li.append(remove)
      }
      return li
    }),
  )
  el('add-level').hidden = !custom
  updateLevelSum()
}

function updateLevelSum(): void {
  const sum = summarise(grid!).levelTargetSum
  const line = el('level-sum')
  line.textContent = `Targets add up to ${formatNumber(sum, 2)}%.`
  line.classList.toggle('bad', sum !== 100)
}

function levelsChanged(structure: boolean): void {
  rememberTaxonomy(grid!.taxonomy)
  if (structure) {
    renderLevels()
    renderTable()
  } else updateLevelSum()
  changed()
}

el('level-list').addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  const level = grid?.taxonomy.levels.find((l) => l.id === input.dataset.level)
  if (!level) return
  if (input.dataset.part === 'target') level.target = parseNumber(input.value) ?? 0
  else level.name = input.value
  levelsChanged(false)
})

el('level-list').addEventListener('change', (e) => {
  if ((e.target as HTMLElement).dataset.part === 'name') renderTable()
})

taxonomySelect.addEventListener('change', () => {
  if (!grid) return
  const next = savedTaxonomy(taxonomySelect.value as TaxonomyId)
  const map = mapLevelsByPosition(grid.taxonomy.levels, next.levels)
  for (const r of grid.rows) r.level = map.get(r.level) ?? ''
  grid.taxonomy = next
  levelsChanged(true)
  saveStatus.textContent = `Now using ${TAXONOMY_NAMES[next.id]}. Questions keep their level number.`
})

el('add-level').addEventListener('click', () => {
  if (!grid) return
  grid.taxonomy.levels.push({ id: `c-${newId()}`, name: `Level ${grid.taxonomy.levels.length + 1}`, target: 0 })
  levelsChanged(true)
  el('level-list').querySelector<HTMLInputElement>('li:last-child input')?.select()
})

el('reset-levels').addEventListener('click', () => {
  if (!grid) return
  const base = defaultTaxonomy(grid.taxonomy.id)
  if (grid.taxonomy.id === 'custom') {
    grid.taxonomy.levels.forEach((l, i) => (l.target = base.levels[i]?.target ?? 0))
  } else grid.taxonomy.levels = base.levels
  levelsChanged(true)
})

// ---------- Topics ----------

function ensureTopics(names: string[]): void {
  const g = grid!
  const known = new Set(g.topics.map((t) => t.name.trim().toLowerCase()))
  for (const n of names) {
    const name = n.trim()
    if (name && !known.has(name.toLowerCase())) {
      known.add(name.toLowerCase())
      g.topics.push({ name, target: null })
    }
  }
}

function renderTopicOptions(): void {
  el('topic-options').replaceChildren(...topicNames(grid!).map((t) => h('option', { value: t })))
}

function renderTopics(): void {
  const g = grid!
  ensureTopics(g.rows.map((r) => r.topic))
  el('no-topics').hidden = g.topics.length > 0
  el('topic-list').replaceChildren(
    ...g.topics.map((topic, i) => {
      const name = h('input', { type: 'text', value: topic.name, 'aria-label': `Name of topic ${i + 1}` })
      const target = h('input', {
        type: 'text',
        inputmode: 'decimal',
        value: topic.target === null ? '' : String(topic.target),
        placeholder: 'None',
        'aria-label': `Target percentage for ${topic.name}`,
      })
      const remove = h('button', {
        type: 'button',
        class: 'small icon',
        'aria-label': `Remove topic ${topic.name}`,
        text: '×',
      })
      let before = topic.name
      name.addEventListener('change', () => {
        const after = name.value.trim()
        if (!after) {
          name.value = before
          return
        }
        for (const r of g.rows) if (r.topic.trim().toLowerCase() === before.toLowerCase()) r.topic = after
        topic.name = after
        before = after
        renderTable()
        changed()
      })
      target.addEventListener('input', () => {
        const n = parseNumber(target.value)
        topic.target = n !== null && n >= 0 ? n : null
        changed()
      })
      remove.addEventListener('click', () => {
        let cleared = 0
        for (const r of g.rows) {
          if (r.topic.trim().toLowerCase() === topic.name.toLowerCase()) {
            r.topic = ''
            cleared++
          }
        }
        g.topics.splice(i, 1)
        renderTopics()
        renderTable()
        changed()
        if (cleared)
          saveStatus.textContent = `Removed ${topic.name} from ${cleared} question${cleared === 1 ? '' : 's'}.`
      })
      return h(
        'li',
        { class: 'topic-row' },
        name,
        h('span', { class: 'target' }, target, h('span', { text: '%' })),
        remove,
      )
    }),
  )
}

el('add-topic-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const input = el<HTMLInputElement>('new-topic')
  if (!grid || !input.value.trim()) return
  ensureTopics([input.value])
  input.value = ''
  renderTopics()
  renderTopicOptions()
  changed()
  input.focus()
})

// ---------- Summary ----------

const FLAG_MARK: Record<Share['flag'], string> = { ok: '✓', over: '▲', under: '▼', none: '' }

function shareTable(target: HTMLTableElement, shares: Share[], heading: string): void {
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { scope: 'col', text: heading }),
      h('th', { scope: 'col', class: 'num', text: 'Marks' }),
      h('th', { scope: 'col', class: 'num', text: '%' }),
      h('th', { scope: 'col', class: 'num', text: 'Target' }),
      h('th', { scope: 'col', text: 'Check' }),
    ),
  )
  const body = h(
    'tbody',
    {},
    ...shares.map((s) =>
      h(
        'tr',
        { class: `flag-${s.flag}`, 'data-key': s.key },
        h('th', { scope: 'row', text: s.name }),
        h('td', { class: 'num', text: formatNumber(s.marks, 2) }),
        h('td', { class: 'num', text: `${formatNumber(s.percent)}%` }),
        h('td', { class: 'num', text: s.target === null ? 'none' : `${formatNumber(s.target)}%` }),
        h(
          'td',
          { class: 'flag' },
          h('span', { class: `flag-text flag-${s.flag}`, text: `${FLAG_MARK[s.flag]} ${flagText(s)}`.trim() }),
        ),
      ),
    ),
  )
  target.replaceChildren(head, body)
}

function renderSummary(): void {
  const g = grid!
  summary = summarise(g)
  const s = summary
  const line = el('total-line')
  line.replaceChildren(
    h('span', { class: 'total-value', text: formatNumber(s.total, 2) }),
    s.intended === null ? ' marks' : ` of ${formatNumber(s.intended, 2)} marks`,
  )
  line.classList.toggle('bad', s.difference !== null && s.difference !== 0)
  line.classList.toggle('good', s.difference === 0)

  el('warnings').replaceChildren(...s.warnings.map((w) => h('li', { text: w })))

  const levels = s.levels.map((l, i) => (l.key ? { ...l, name: `${i + 1}: ${l.name}` } : l))
  shareTable(el<HTMLTableElement>('level-summary'), levels, 'Level')
  el('level-chart').replaceChildren(shareChart(levels, g.tolerance, 'Marks per cognitive level against targets'))
  shareTable(el<HTMLTableElement>('topic-summary'), s.topics, 'Topic')
  el('topic-chart').replaceChildren(
    s.topics.length > 0 ? shareChart(s.topics, g.tolerance, 'Marks per topic against targets') : '',
  )

  const m = s.matrix
  const levelName = (id: string) => {
    const i = g.taxonomy.levels.findIndex((l) => l.id === id)
    return i < 0 ? 'No level' : `${i + 1}: ${g.taxonomy.levels[i].name}`
  }
  el('matrix').replaceChildren(
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', text: 'Level' }),
        ...m.topics.map((t) => h('th', { scope: 'col', class: 'num', text: t || 'No topic' })),
        h('th', { scope: 'col', class: 'num', text: 'Total' }),
      ),
    ),
    h(
      'tbody',
      {},
      ...m.levels.map((l, li) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row', text: levelName(l) }),
          ...m.cells[li].map((c) => h('td', { class: `num${c === 0 ? ' zero' : ''}`, text: formatNumber(c, 2) })),
          h('td', { class: 'num total', text: formatNumber(m.levelTotals[li], 2) }),
        ),
      ),
      h(
        'tr',
        { class: 'total' },
        h('th', { scope: 'row', text: 'Total' }),
        ...m.topicTotals.map((c) => h('td', { class: 'num', text: formatNumber(c, 2) })),
        h('td', { class: 'num', text: formatNumber(s.total, 2) }),
      ),
    ),
  )

  el('question-totals').replaceChildren(
    ...s.numbering.questions.map((q) =>
      h('li', {}, h('span', { text: `Question ${q.key}` }), h('strong', { text: formatNumber(q.marks, 2) })),
    ),
  )
}

// ---------- Toolbar ----------

el('duplicate-grid').addEventListener('click', async () => {
  if (!grid) return
  await flushSave()
  try {
    const copy = await saveGrid(duplicateGrid(grid))
    go(`#grid/${encodeURIComponent(copy.id)}`)
  } catch (error) {
    showMessage(editError, errorMessage(error))
  }
})

el('download-pdf').addEventListener('click', async () => {
  if (!grid) return
  try {
    const { gridPdf } = await import('./pdf')
    downloadFile(await gridPdf(grid), gridFileName(grid, 'pdf'), 'application/pdf')
  } catch (error) {
    showMessage(editError, errorMessage(error))
  }
})

el('download-xlsx').addEventListener('click', async () => {
  if (!grid) return
  try {
    const { gridXlsx } = await import('./xlsx')
    downloadFile(
      await gridXlsx(grid),
      gridFileName(grid, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  } catch (error) {
    showMessage(editError, errorMessage(error))
  }
})
