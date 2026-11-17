import {
  BOX_HEIGHT,
  boxWidth,
  CROSS_STROKES,
  FONT_SIZE,
  INK_CSS,
  REASON_TAG,
  STROKE_WIDTH,
  SUBTOTAL_RADIUS,
  TICK_POINTS,
  WARNING_CSS,
} from './annotation-geometry'
import type { Annotation, MarkingModel } from './marking-model'
import type { PageView, Viewer } from './viewer'

// Renders the model's Annotations into each page's overlay and turns pointer input on blank
// page area into model commands. Positions are PDF units; everything is drawn at `x * scale`
// and rebuilt on model change and on zoom, so marks stay sharp (vector SVG) at every zoom.
//
// Extending: add a renderer for the new type to `renderers` (returns an SVG element positioned
// by `place`), and handle new pointer gestures in `attachAnnotationLayer`. Rendered annotation
// elements carry `data-annotation-id` so pointer handlers can tell them from blank page.

const SVG_NS = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

/** A zero-size, overflow-visible <svg> whose origin sits at the annotation's position. */
function anchor(a: Annotation, scale: number): SVGSVGElement {
  const root = svg('svg', {
    class: `annotation annotation-${a.type}`,
    width: '0',
    height: '0',
    overflow: 'visible',
    'data-annotation-id': a.id,
    'data-type': a.type,
  })
  root.style.left = `${a.x * scale}px`
  root.style.top = `${a.y * scale}px`
  return root
}

function label(text: string, scale: number, attrs: Record<string, string>): SVGTextElement {
  const t = svg('text', {
    'font-family': 'Helvetica, Arial, sans-serif',
    'font-size': String(FONT_SIZE * scale),
    'dominant-baseline': 'central',
    ...attrs,
  })
  t.textContent = text
  return t
}

type Renderer<T extends Annotation['type']> = (
  a: Extract<Annotation, { type: T }>,
  scale: number,
  model: MarkingModel,
) => SVGSVGElement

const renderers: { [T in Annotation['type']]: Renderer<T> } = {
  tick(a, scale) {
    const root = anchor(a, scale)
    // Transparent hit area so the mark is easy to target later (select/move/delete).
    root.append(svg('circle', { class: 'hit', r: String(10 * scale), fill: 'transparent' }))
    root.append(
      svg('polyline', {
        points: TICK_POINTS.map(([dx, dy]) => `${dx * scale},${dy * scale}`).join(' '),
        fill: 'none',
        stroke: INK_CSS,
        'stroke-width': String(STROKE_WIDTH * scale),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    )
    return root
  },
  cross(a, scale) {
    const root = anchor(a, scale)
    root.append(svg('circle', { class: 'hit', r: String(10 * scale), fill: 'transparent' }))
    for (const [[x1, y1], [x2, y2]] of CROSS_STROKES) {
      root.append(
        svg('line', {
          x1: String(x1 * scale),
          y1: String(y1 * scale),
          x2: String(x2 * scale),
          y2: String(y2 * scale),
          stroke: INK_CSS,
          'stroke-width': String(STROKE_WIDTH * scale),
          'stroke-linecap': 'round',
        }),
      )
    }
    if (a.reason) {
      const tag = svg('text', {
        class: 'reason-tag',
        x: String(REASON_TAG.dx * scale),
        y: String(REASON_TAG.dy * scale),
        fill: INK_CSS,
        'font-size': String(REASON_TAG.fontSize * scale),
        'font-family': 'Helvetica, Arial, sans-serif',
      })
      tag.textContent = a.reason
      root.append(tag)
    }
    return root
  },
  subtotal(a, scale, model) {
    const root = anchor(a, scale)
    const r = SUBTOTAL_RADIUS * scale
    root.append(svg('circle', { class: 'hit', r: String(r + 3 * scale), fill: 'transparent' }))
    root.append(
      svg('circle', { r: String(r), fill: 'none', stroke: INK_CSS, 'stroke-width': String(STROKE_WIDTH * scale) }),
    )
    root.append(label(String(model.getSubtotalCount(a.id) ?? 0), scale, { 'text-anchor': 'middle', fill: INK_CSS }))
    return root
  },
  total(a, scale, model) {
    const root = anchor(a, scale)
    const summary = model.getTotal()
    const text = `${summary?.count ?? 0} / ${a.outOf}`
    const colour = summary?.over ? WARNING_CSS : INK_CSS
    const w = boxWidth(text) * scale
    const h = BOX_HEIGHT * scale
    root.append(
      svg('rect', {
        class: 'hit',
        x: String(-w / 2),
        y: String(-h / 2),
        width: String(w),
        height: String(h),
        fill: 'transparent',
        stroke: colour,
        'stroke-width': String(STROKE_WIDTH * scale),
      }),
    )
    root.append(
      label(text, scale, { 'text-anchor': 'middle', fill: colour, 'font-weight': summary?.over ? 'bold' : 'normal' }),
    )
    return root
  },
  text(a, scale) {
    const root = anchor(a, scale)
    const w = (a.text.length * FONT_SIZE * 0.56 + 4) * scale
    const h = BOX_HEIGHT * scale
    root.append(
      svg('rect', {
        class: 'hit',
        x: String(-2 * scale),
        y: String(-h / 2),
        width: String(w),
        height: String(h),
        fill: 'transparent',
      }),
    )
    root.append(label(a.text, scale, { 'text-anchor': 'start', fill: INK_CSS }))
    return root
  },
}

function renderAnnotation(a: Annotation, scale: number, model: MarkingModel): SVGSVGElement {
  return (renderers[a.type] as Renderer<Annotation['type']>)(a, scale, model)
}

export interface AnnotationLayer {
  /** Called after every (re)render; selection uses it to restyle the freshly built elements. */
  onRender(listener: () => void): void
  destroy(): void
}

export function attachAnnotationLayer(viewer: Viewer, model: MarkingModel): AnnotationLayer {
  const layers = new Map<number, HTMLElement>()
  const renderListeners: Array<() => void> = []
  for (const page of viewer.pages) {
    const layer = document.createElement('div')
    layer.className = 'annotation-layer'
    page.overlay.append(layer)
    layers.set(page.pageNumber, layer)
    page.overlay.addEventListener('click', onClick(page))
    page.overlay.addEventListener('contextmenu', onContextMenu(page))
  }

  // Right-click places a Cross (blank page only); the browser menu never shows over a page.
  function onContextMenu(page: PageView) {
    return (e: MouseEvent) => {
      e.preventDefault()
      if ((e.target as Element).closest('[data-annotation-id]')) return
      const rect = page.overlay.getBoundingClientRect()
      model.placeCross(page.pageNumber, (e.clientX - rect.left) / page.scale, (e.clientY - rect.top) / page.scale)
    }
  }

  function onClick(page: PageView) {
    return (e: MouseEvent) => {
      if ((e.target as Element).closest('[data-annotation-id]')) return // not blank page
      const rect = page.overlay.getBoundingClientRect()
      model.placeTick(page.pageNumber, (e.clientX - rect.left) / page.scale, (e.clientY - rect.top) / page.scale)
    }
  }

  function render(): void {
    const byPage = new Map<number, Annotation[]>()
    for (const a of model.getAnnotations()) {
      byPage.set(a.page, [...(byPage.get(a.page) ?? []), a])
    }
    for (const page of viewer.pages) {
      layers
        .get(page.pageNumber)!
        .replaceChildren(...(byPage.get(page.pageNumber) ?? []).map((a) => renderAnnotation(a, page.scale, model)))
    }
    renderListeners.forEach((l) => l())
  }

  const off = model.onChange(render)
  viewer.onScaleChange(render)
  render()

  return {
    onRender: (listener) => void renderListeners.push(listener),
    destroy() {
      off()
      layers.forEach((l) => l.remove())
    },
  }
}
