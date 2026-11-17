import type { PageView } from '../shared/pdf/page-viewer'
import {
  clientToFraction,
  moveRect,
  rectFromDrag,
  resizeRect,
  type FracRect,
  type Handle,
  type Point,
} from './geometry'
import { boxesOnPage, type Fill, type LayoutModel, type RedactionBox } from './model'

// Shows the redaction boxes over the pages and lets the teacher draw them by dragging (mouse,
// pen or finger), select, move, resize and delete them. A drag is one undo step.

/** A drag shorter than this (CSS px) is a tap, not a new box. */
const MIN_DRAG_PX = 6
const HANDLES: readonly Handle[] = ['nw', 'ne', 'sw', 'se']
const NUDGE = 0.002

export interface BoxesLayer {
  render(): void
  selected(): number | null
  select(id: number | null): void
  /** The anonymised name shown in labelled boxes for the file on screen. */
  setLabel(text: string): void
  destroy(): void
}

export interface BoxesLayerOptions {
  /** Whether a drag on an empty part of a page draws a box (otherwise it scrolls on touch). */
  drawing(): boolean
  fill(): Fill
  onSelect(box: RedactionBox | null): void
}

type Gesture =
  | { kind: 'draw'; page: PageView; start: Point; startClient: Point; draft: HTMLElement }
  | { kind: 'move' | 'resize'; id: number; handle?: Handle; start: Point; rect: FracRect; changed: boolean }

export function attachBoxesLayer(
  pages: readonly PageView[],
  model: LayoutModel,
  options: BoxesLayerOptions,
): BoxesLayer {
  const layers = new Map<number, HTMLElement>()
  const elements = new Map<string, HTMLElement>()
  let selectedId: number | null = null
  let label = ''
  let gesture: Gesture | null = null
  const cleanups: Array<() => void> = []

  const listen = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ) => {
    el.addEventListener(type, fn)
    cleanups.push(() => el.removeEventListener(type, fn))
  }

  const pointIn = (page: PageView, e: PointerEvent) =>
    clientToFraction(e.clientX, e.clientY, page.overlay.getBoundingClientRect())

  function place(el: HTMLElement, r: FracRect): void {
    el.style.left = `${r.x * 100}%`
    el.style.top = `${r.y * 100}%`
    el.style.width = `${r.w * 100}%`
    el.style.height = `${r.h * 100}%`
  }

  function select(id: number | null): void {
    selectedId = id
    render()
    options.onSelect(id === null ? null : (model.get(id) ?? null))
  }

  function boxElement(page: PageView, box: RedactionBox): HTMLElement {
    const el = document.createElement('div')
    el.className = 'rbox'
    el.tabIndex = 0
    el.dataset.id = String(box.id)
    const text = document.createElement('span')
    text.className = 'rbox-label'
    el.append(text)
    for (const h of HANDLES) {
      const handle = document.createElement('span')
      handle.className = `handle handle-${h}`
      handle.dataset.handle = h
      el.append(handle)
    }
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const current = model.get(box.id)
      if (!current) return
      if (selectedId !== box.id) select(box.id)
      el.focus({ preventScroll: true })
      const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
      gesture = {
        kind: handle ? 'resize' : 'move',
        id: box.id,
        handle,
        start: pointIn(page, e),
        rect: { x: current.x, y: current.y, w: current.w, h: current.h },
        changed: false,
      }
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', (e) => {
      if (!gesture || gesture.kind === 'draw' || gesture.id !== box.id) return
      const p = pointIn(page, e)
      const dx = p.x - gesture.start.x
      const dy = p.y - gesture.start.y
      if (!gesture.changed) {
        if (dx === 0 && dy === 0) return
        model.checkpoint()
        gesture.changed = true
      }
      const next =
        gesture.kind === 'move' ? moveRect(gesture.rect, dx, dy) : resizeRect(gesture.rect, gesture.handle!, dx, dy)
      model.update(box.id, next, false)
    })
    const end = () => {
      if (gesture && gesture.kind !== 'draw' && gesture.id === box.id) gesture = null
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('keydown', (e) => {
      const current = model.get(box.id)
      if (!current) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        model.remove(box.id)
        select(null)
        return
      }
      const step = e.shiftKey ? NUDGE * 10 : NUDGE
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const move = moves[e.key]
      if (!move) return
      e.preventDefault()
      model.update(box.id, moveRect(current, move[0], move[1]))
    })
    el.addEventListener('focus', () => {
      if (selectedId !== box.id) select(box.id)
    })
    return el
  }

  function render(): void {
    const boxes = model.boxes()
    if (selectedId !== null && !boxes.some((b) => b.id === selectedId)) {
      selectedId = null
      options.onSelect(null)
    }
    const wanted = new Set<string>()
    for (const page of pages) {
      const layer = layers.get(page.pageNumber)!
      for (const [i, box] of boxesOnPage(boxes, page.pageNumber).entries()) {
        const key = `${page.pageNumber}:${box.id}`
        wanted.add(key)
        let el = elements.get(key)
        if (!el) {
          el = boxElement(page, box)
          elements.set(key, el)
          layer.append(el)
        }
        place(el, box)
        el.classList.toggle('rbox-white', box.fill === 'white')
        el.classList.toggle('selected', box.id === selectedId)
        el.classList.toggle('every-page', box.everyPage)
        el.setAttribute(
          'aria-label',
          `Redaction box ${i + 1} on page ${page.pageNumber}${box.everyPage ? ', on every page' : ''}`,
        )
        el.querySelector<HTMLElement>('.rbox-label')!.textContent = box.label ? label : ''
      }
    }
    for (const [key, el] of elements) {
      if (wanted.has(key)) continue
      el.remove()
      elements.delete(key)
    }
  }

  for (const page of pages) {
    const layer = document.createElement('div')
    layer.className = 'boxes-layer'
    page.overlay.append(layer)
    layers.set(page.pageNumber, layer)

    listen(page.overlay, 'pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.rbox')) return
      if (!options.drawing()) {
        if (selectedId !== null) select(null)
        return
      }
      e.preventDefault()
      const draft = document.createElement('div')
      draft.className = `rbox rbox-draft${options.fill() === 'white' ? ' rbox-white' : ''}`
      layer.append(draft)
      const start = pointIn(page, e)
      place(draft, { ...start, w: 0, h: 0 })
      gesture = { kind: 'draw', page, start, startClient: { x: e.clientX, y: e.clientY }, draft }
      page.overlay.setPointerCapture(e.pointerId)
    })
    listen(page.overlay, 'pointermove', (e) => {
      if (gesture?.kind !== 'draw' || gesture.page !== page) return
      place(gesture.draft, rectFromDrag(gesture.start, pointIn(page, e)))
    })
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (gesture?.kind !== 'draw' || gesture.page !== page) return
      const g = gesture
      gesture = null
      g.draft.remove()
      const far =
        Math.abs(e.clientX - g.startClient.x) >= MIN_DRAG_PX && Math.abs(e.clientY - g.startClient.y) >= MIN_DRAG_PX
      if (cancelled || !far) {
        if (selectedId !== null) select(null)
        return
      }
      const rect = rectFromDrag(g.start, pointIn(page, e))
      const added = model.add({ ...rect, page: page.pageNumber, everyPage: false, fill: options.fill(), label: false })
      select(added.id)
    }
    listen(page.overlay, 'pointerup', (e) => finish(e, false))
    listen(page.overlay, 'pointercancel', (e) => finish(e, true))
  }

  render()

  return {
    render,
    selected: () => selectedId,
    select,
    setLabel(text) {
      label = text
      render()
    },
    destroy() {
      cleanups.forEach((c) => c())
      for (const layer of layers.values()) layer.remove()
      elements.clear()
    },
  }
}
