// The assessment cards: one per column, with its name, "out of", counts, include tick box and the
// unreadable cells listed for correcting in place.
import type { AnalysedColumn, Analysis } from '../core/analysis'
import { learnerLabel } from '../core/parse'
import { h, plural } from './dom'
import { correctCell, setChoice } from './state'

function outOfNote(c: AnalysedColumn): HTMLElement | null {
  const col = c.column
  switch (col.outOfSource) {
    case 'assumed':
      return h('p', { class: 'warning small-note', text: 'Assumed percentages. Is this out of something else?' })
    case 'missing':
      return h('p', {
        class: 'error small-note',
        role: 'alert',
        text: 'Some marks are above 100. Type what this is out of to analyse it.',
      })
    case 'heading':
      return h('p', {
        class: 'help',
        text: col.outOf === null ? 'Percentages, from the heading.' : `Out of ${col.outOf}, from the heading.`,
      })
    case 'cells':
      return h('p', { class: 'help', text: 'Each mark carries its own total or percentage.' })
    default:
      return h('p', {
        class: 'help',
        text: col.outOf === null ? 'Read as percentages.' : `Out of ${col.outOf}, as you typed it.`,
      })
  }
}

function counts(c: AnalysedColumn): string {
  const k = c.column.counts
  const parts = [plural(k.marks, 'mark'), `${k.absent} absent`]
  if (k.unreadable) parts.push(`${k.unreadable} unreadable`)
  return parts.join(', ')
}

function unreadableList(c: AnalysedColumn, analysis: Analysis, refresh: () => void): HTMLElement | null {
  const bad = c.column.cells.flatMap((cell, r) => (cell.status === 'unreadable' ? [{ cell, r }] : []))
  if (bad.length === 0) return null
  return h(
    'details',
    { class: 'unreadable', open: bad.length <= 5 },
    h('summary', { text: `${plural(bad.length, 'unreadable mark')}: left out until corrected` }),
    h(
      'ul',
      {},
      bad.map(({ cell, r }) => {
        const label = `Row ${analysis.rowNumbers[r]}${analysis.names[r] ? `, ${analysis.names[r]}` : ''}`
        const input = h('input', {
          type: 'text',
          value: cell.raw,
          'aria-label': `Correct ${c.column.name}, ${learnerLabel(analysis.names[r], analysis.rowNumbers[r])}`,
          class: 'fix-input',
          spellcheck: 'false',
        })
        input.addEventListener('change', () => {
          correctCell(analysis, r, c.index, input.value)
          refresh()
        })
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur()
        })
        return h(
          'li',
          {},
          h('span', { class: 'fix-label' }, h('strong', { text: label }), ` (${cell.reason ?? 'not a mark'})`),
          input,
        )
      }),
    ),
  )
}

function card(c: AnalysedColumn, analysis: Analysis, refresh: () => void): HTMLLIElement {
  const col = c.column
  const id = `card-${c.index}`
  const include = h('input', {
    type: 'checkbox',
    checked: c.included,
    id: `${id}-include`,
    'aria-label': `Include ${col.name}`,
  })
  include.addEventListener('change', () => {
    setChoice(c.index, { included: include.checked })
    refresh()
  })
  const name = h('input', {
    type: 'text',
    value: col.name,
    id: `${id}-name`,
    class: 'card-name',
    'aria-label': `Name of assessment ${c.index + 1}`,
  })
  name.addEventListener('change', () => {
    setChoice(c.index, { name: name.value })
    refresh()
  })
  const outOf = h('input', {
    type: 'number',
    min: '1',
    step: 'any',
    inputmode: 'decimal',
    id: `${id}-outof`,
    value: col.outOf ?? '',
    placeholder: '%',
  })
  outOf.addEventListener('change', () => {
    const v = Number(outOf.value.replace(',', '.'))
    setChoice(c.index, { outOf: outOf.value.trim() === '' || !(v > 0) ? null : v })
    refresh()
  })
  return h(
    'li',
    { class: c.included ? 'card' : 'card excluded', 'data-column': c.index },
    h(
      'div',
      { class: 'card-top' },
      h('label', { class: 'check include' }, include, h('span', { text: 'Include' })),
      name,
      col.calculated ? h('span', { class: 'tag', title: 'Worked out from other marks', text: 'calculated' }) : null,
    ),
    h(
      'div',
      { class: 'card-row' },
      h('label', { class: 'field outof' }, h('span', { text: 'Out of' }), outOf),
      h('p', { class: 'card-counts', text: counts(c) }),
    ),
    outOfNote(c),
    unreadableList(c, analysis, refresh),
  )
}

export function renderCards(host: HTMLElement, analysis: Analysis, refresh: () => void): void {
  host.replaceChildren(...analysis.columns.map((c) => card(c, analysis, refresh)))
}
