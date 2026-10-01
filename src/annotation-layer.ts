import { INK_CSS, STROKE_WIDTH, TICK_POINTS } from './annotation-geometry'
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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
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

const renderers: { [T in Annotation['type']]: (a: Extract<Annotation, { type: T }>, scale: number) => SVGSVGElement } = {
  tick(a, scale) {
    const root = anchor(a, scale)
    // Transparent hit area so the mark is easy to target later (select/move/delete).
    root.append(svg('circle', { r: String(10 * scale), fill: 'transparent' }))
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
}

function renderAnnotation(a: Annotation, scale: number): SVGSVGElement {
  return (renderers[a.type] as (a: Annotation, s: number) => SVGSVGElement)(a, scale)
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
      layers.get(page.pageNumber)!.replaceChildren(
        ...(byPage.get(page.pageNumber) ?? []).map((a) => renderAnnotation(a, page.scale)),
      )
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
