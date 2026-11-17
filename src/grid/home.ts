import { duplicateGrid, formatNumber, gridTitle, newGrid, type Grid } from './core/model'
import { summarise } from './core/summary'
import { TAXONOMY_NAMES } from './core/taxonomy'
import { changedWhen, el, errorMessage, go, h, showMessage } from './dom'
import { lastTaxonomyId, savedTaxonomy } from './settings'
import { deleteGrid, listGrids, saveGrid } from './storage'

const listEl = el<HTMLUListElement>('grid-list')
const noGrids = el('no-grids')
const homeError = el('home-error')

let grids: Grid[] = []
let confirming: string | null = null

export async function showHome(): Promise<void> {
  confirming = null
  showMessage(homeError, '')
  await refresh()
}

async function refresh(focusId?: string): Promise<void> {
  try {
    grids = await listGrids()
  } catch (error) {
    showMessage(homeError, errorMessage(error))
    grids = []
  }
  render()
  if (focusId) listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] .grid-name a`)?.focus()
}

function render(): void {
  noGrids.hidden = grids.length > 0
  listEl.replaceChildren(...grids.map(card))
}

function meta(g: Grid): string {
  const s = summarise(g)
  const total =
    s.intended === null ? `${formatNumber(s.total)} marks` : `${formatNumber(s.total)} of ${s.intended} marks`
  return `${total} · ${TAXONOMY_NAMES[g.taxonomy.id]} · changed ${changedWhen(g.updatedAt)}`
}

function button(text: string, label: string, onClick: () => void, cls = 'small'): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, text })
  b.addEventListener('click', onClick)
  return b
}

function card(g: Grid): HTMLLIElement {
  const title = gridTitle(g)
  const href = `#grid/${encodeURIComponent(g.id)}`
  const li = h(
    'li',
    { class: 'grid-card', 'data-id': g.id },
    h(
      'div',
      { class: 'grid-main' },
      h('h3', { class: 'grid-name' }, h('a', { href, text: title })),
      h('p', { class: 'meta', text: meta(g) }),
    ),
  )
  if (confirming === g.id) {
    const keep = button('Keep it', `Keep ${title}`, () => {
      confirming = null
      render()
    })
    const yes = button(
      'Delete',
      `Yes, delete ${title}`,
      async () => {
        try {
          await deleteGrid(g.id)
          confirming = null
          await refresh()
        } catch (error) {
          showMessage(homeError, errorMessage(error))
        }
      },
      'small danger',
    )
    li.append(
      h(
        'div',
        { class: 'confirm', role: 'group' },
        h('p', { text: `Delete ${title}? This cannot be undone.` }),
        h('div', { class: 'grid-actions' }, keep, yes),
      ),
    )
    queueMicrotask(() => keep.focus())
  } else {
    li.append(
      h(
        'div',
        { class: 'grid-actions' },
        h('a', { class: 'button small', href, 'aria-label': `Open ${title}`, text: 'Open' }),
        button('Duplicate', `Duplicate ${title}`, () => void duplicate(g)),
        button('Delete', `Delete ${title}`, () => {
          confirming = g.id
          render()
        }),
      ),
    )
  }
  return li
}

async function duplicate(g: Grid): Promise<void> {
  try {
    const copy = await saveGrid(duplicateGrid(g))
    await refresh(copy.id)
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
}

el('new-grid').addEventListener('click', async () => {
  try {
    const g = await saveGrid(newGrid(savedTaxonomy(lastTaxonomyId())))
    go(`#grid/${encodeURIComponent(g.id)}`)
  } catch (error) {
    showMessage(homeError, errorMessage(error))
  }
})
