import { CROSS_STROKES, MARK_STROKE, TICK_POINTS } from './export'
import { INK_CSS, type ImageItem, type Ink, type Item, type ItemPatch, type SignModel } from './model'
import type { PageView } from './viewer'

// Shows what the teacher added (text, ticks, crosses, signatures, initials) over the pages and
// lets them select, move, resize and delete it. Every finished change is one undo step.

/** Font stack matching the Helvetica the saved PDF uses. */
const TEXT_FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif'
/** Baseline of a Helvetica-like font from the top of a line box 1.25 em high, in em. */
const BASELINE = 0.97
const LINE = 1.25

/** Text being typed that is not yet in the model (empty text is never added). */
export interface TextDraft {
  page: number
  x: number
  y: number
  size: number
  width?: number
  ink: Ink
}

export interface ItemsLayer {
  render(): void
  selected(): string | null
  select(id: string | null): void
  /** Start typing a new text item; it joins the model only if something is typed. */
  startText(draft: TextDraft): void
  /** Commit any text being typed (before saving). */
  commitTyping(): void
  destroy(): void
}

export function attachItemsLayer(pages: readonly PageView[], model: SignModel, onSelect: (item: Item | null) => void): ItemsLayer {
  const layers = new Map<number, HTMLElement>()
  for (const p of pages) {
    const layer = document.createElement('div')
    layer.className = 'items-layer'
    p.overlay.append(layer)
    layers.set(p.pageNumber, layer)
  }
  const pageOf = (n: number) => pages[n - 1]
  const elements = new Map<string, HTMLElement>()
  let selectedId: string | null = null
  let draft: (TextDraft & { element: HTMLElement }) | null = null

  const measure = document.createElement('canvas').getContext('2d')
  const textWidth = (text: string, px: number) => {
    if (!measure) return text.length * px * 0.55
    measure.font = `${px}px ${TEXT_FONT}`
    return measure.measureText(text).width
  }

  function sizeTextInput(input: HTMLInputElement, size: number, width: number | undefined, scale: number): void {
    const px = size * scale
    input.style.fontSize = `${px}px`
    input.style.height = `${px * LINE}px`
    input.style.lineHeight = `${px * LINE}px`
    const min = Math.max((width ?? 0) * scale, px * 4)
    input.style.width = `${Math.max(min, textWidth(input.value, px) + px * 0.6)}px`
  }

  function placeText(el: HTMLElement, x: number, y: number, size: number, width: number | undefined, scale: number): void {
    el.style.left = `${x * scale}px`
    el.style.top = `${(y - size * BASELINE) * scale}px`
    sizeTextInput(el.querySelector('input')!, size, width, scale)
  }

  function makeTextInput(ink: Ink): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'item-input'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('aria-label', 'Text')
    input.style.color = INK_CSS[ink]
    return input
  }

  function addControls(el: HTMLElement, id: string): void {
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'item-delete'
    del.setAttribute('aria-label', 'Delete')
    del.textContent = '×'
    del.addEventListener('pointerdown', (e) => e.stopPropagation())
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      remove(id)
    })
    const handle = document.createElement('span')
    handle.className = 'item-resize'
    handle.title = 'Drag to resize'
    handle.addEventListener('pointerdown', (e) => startResize(e, id))
    el.append(del, handle)
  }

  function create(item: Item): HTMLElement {
    const el = document.createElement('div')
    el.className = `item item-${item.type}`
    el.dataset.id = item.id
    if (item.type === 'text') {
      const grip = document.createElement('span')
      grip.className = 'item-grip'
      grip.title = 'Drag to move'
      grip.addEventListener('pointerdown', (e) => startMove(e, item.id))
      const input = makeTextInput(item.ink)
      input.value = item.text
      input.addEventListener('focus', () => select(item.id))
      input.addEventListener('input', () => {
        const current = model.get(item.id)
        if (current?.type === 'text') sizeTextInput(input, current.size, current.width, pageOf(current.page).scale)
      })
      input.addEventListener('change', () => {
        if (input.value.trim() === '') remove(item.id)
        else model.update(item.id, { text: input.value })
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur()
      })
      input.addEventListener('pointerdown', (e) => e.stopPropagation())
      el.append(grip, input)
    } else if (item.type === 'tick' || item.type === 'cross') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 1 1')
      const strokes = item.type === 'tick' ? [TICK_POINTS] : CROSS_STROKES.map((s) => [...s])
      for (const pts of strokes) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '))
        line.setAttribute('stroke-width', String(MARK_STROKE))
        svg.append(line)
      }
      el.append(svg)
      el.addEventListener('pointerdown', (e) => startMove(e, item.id))
    } else {
      const img = document.createElement('img')
      img.alt = item.type === 'signature' ? 'Signature' : 'Initials'
      img.draggable = false
      img.src = item.src
      el.append(img)
      el.addEventListener('pointerdown', (e) => startMove(e, item.id))
    }
    el.addEventListener('click', (e) => e.stopPropagation())
    addControls(el, item.id)
    return el
  }

  function position(el: HTMLElement, item: Item, override?: ItemPatch): void {
    const it = { ...item, ...override } as Item
    const s = pageOf(it.page).scale
    if (it.type === 'text') {
      el.style.color = INK_CSS[it.ink]
      const input = el.querySelector('input')!
      input.style.color = INK_CSS[it.ink]
      placeText(el, it.x, it.y, it.size, it.width, s)
    } else if (it.type === 'tick' || it.type === 'cross') {
      el.style.left = `${it.x * s}px`
      el.style.top = `${it.y * s}px`
      el.style.width = el.style.height = `${it.size * s}px`
      el.style.color = INK_CSS[it.ink]
    } else {
      el.style.left = `${it.x * s}px`
      el.style.top = `${it.y * s}px`
      el.style.width = `${it.width * s}px`
      el.style.height = `${it.height * s}px`
    }
  }

  function render(): void {
    const live = new Set<string>()
    for (const item of model.items()) {
      live.add(item.id)
      let el = elements.get(item.id)
      if (!el) {
        el = create(item)
        elements.set(item.id, el)
      }
      const layer = layers.get(item.page)
      if (layer && el.parentElement !== layer) layer.append(el)
      if (item.type === 'text') {
        const input = el.querySelector('input')!
        if (document.activeElement !== input && input.value !== item.text) input.value = item.text
      }
      if (item.type === 'signature' || item.type === 'initials') {
        const img = el.querySelector('img')!
        if (img.getAttribute('src') !== item.src) img.src = item.src
      }
      position(el, item)
      el.classList.toggle('selected', item.id === selectedId)
    }
    for (const [id, el] of elements) {
      if (live.has(id)) continue
      el.remove()
      elements.delete(id)
    }
    if (selectedId && !live.has(selectedId)) select(null)
    if (draft) placeText(draft.element, draft.x, draft.y, draft.size, draft.width, pageOf(draft.page).scale)
  }

  function select(id: string | null): void {
    if (selectedId === id) return
    selectedId = id
    for (const [eid, el] of elements) el.classList.toggle('selected', eid === id)
    onSelect(id ? (model.get(id) ?? null) : null)
  }

  function remove(id: string): void {
    if (selectedId === id) select(null)
    model.remove(id)
  }

  /** Pointer drags: move live on screen, then one model update when released. */
  function drag(e: PointerEvent, id: string, onMove: (item: Item, dx: number, dy: number) => ItemPatch): void {
    if (e.button !== 0) return
    const item = model.get(id)
    const el = elements.get(id)
    if (!item || !el) return
    e.preventDefault()
    e.stopPropagation()
    const active = document.activeElement as HTMLElement | null
    if (active && el.contains(active) === false) active.blur?.()
    select(id)
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const scale = pageOf(item.page).scale
    const sx = e.clientX
    const sy = e.clientY
    let patch: ItemPatch = {}
    const move = (ev: PointerEvent) => {
      patch = onMove(item, (ev.clientX - sx) / scale, (ev.clientY - sy) / scale)
      position(el, item, patch)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      if (Object.keys(patch).length) model.update(id, patch)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  function startMove(e: PointerEvent, id: string): void {
    drag(e, id, (item, dx, dy) => {
      const page = pageOf(item.page)
      return { x: clamp(item.x + dx, -10, page.width - 5), y: clamp(item.y + dy, 0, page.height) }
    })
  }

  function startResize(e: PointerEvent, id: string): void {
    drag(e, id, (item, dx, dy) => {
      if (item.type === 'text') {
        const h = item.size * LINE
        return { size: Math.round(clamp((item.size * (h + dy)) / h, 5, 72) * 2) / 2 }
      }
      if (item.type === 'tick' || item.type === 'cross') return { size: clamp(item.size + Math.max(dx, dy), 4, 120) }
      const img = item as ImageItem
      const aspect = img.width / img.height
      const width = clamp(img.width + Math.max(dx, dy * aspect), 12, 600)
      return { width, height: width / aspect }
    })
  }

  function startText(d: TextDraft): void {
    commitTyping()
    select(null)
    const layer = layers.get(d.page)
    if (!layer) return
    const el = document.createElement('div')
    el.className = 'item item-text item-draft'
    const input = makeTextInput(d.ink)
    input.addEventListener('input', () => sizeTextInput(input, d.size, d.width, pageOf(d.page).scale))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') {
        input.value = ''
        input.blur()
      }
    })
    input.addEventListener('blur', () => commitTyping())
    input.addEventListener('pointerdown', (e) => e.stopPropagation())
    el.addEventListener('click', (e) => e.stopPropagation())
    el.append(input)
    layer.append(el)
    draft = { ...d, element: el }
    placeText(el, d.x, d.y, d.size, d.width, pageOf(d.page).scale)
    input.focus()
  }

  function commitTyping(): void {
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.classList.contains('item-input') && !draft?.element.contains(active)) {
      active.dispatchEvent(new Event('change'))
    }
    if (!draft) return
    const d = draft
    draft = null
    const text = d.element.querySelector('input')!.value
    d.element.remove()
    if (text.trim() !== '') {
      const id = model.add({ type: 'text', page: d.page, x: d.x, y: d.y, size: d.size, width: d.width, text, ink: d.ink })
      select(id)
    }
  }

  render()
  return {
    render,
    selected: () => selectedId,
    select,
    startText,
    commitTyping,
    destroy() {
      draft?.element.remove()
      draft = null
      layers.forEach((l) => l.remove())
      elements.clear()
    },
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
