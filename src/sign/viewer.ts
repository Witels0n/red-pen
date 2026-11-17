// Adapted from the marker's viewer (src/mark/viewer.ts): renders pages lazily around the
// viewport, and leaves form widgets off the canvas because Sign and fill shows them as inputs.
import { pdfjs, type PdfDocument, type PdfPage, type RenderTask } from './pdf-worker'
import { clampZoom, fitToWidthScale, layoutPages, stepZoom, visiblePages, type PageSize } from '../mark/viewer-math'

const GUTTER = 20 // px left/right of the pages, also used for fit-to-width
const GAP = 12 // px between pages (and above the first)
const RENDER_MARGIN = 600 // px beyond the viewport in which pages are rendered ahead of scrolling

/**
 * One page as the rest of the tool sees it. Layers go in `overlay`, which exactly covers the
 * page; positions are in displayed page units, shown at `x * scale` CSS px.
 */
export interface PageView {
  /** 1-based page number. */
  readonly pageNumber: number
  /** Page size in PDF units (1/72 in), at zoom 1. */
  readonly width: number
  readonly height: number
  /** Current CSS pixels per PDF unit. Updated in place when zoom changes. */
  scale: number
  /** Positioned container covering the page; annotation layer goes here. */
  readonly overlay: HTMLElement
  /** Outer page element (canvas + overlay). */
  readonly element: HTMLElement
  /** The pdf.js page, for its annotations and for rendering at other scales. */
  readonly pdfPage: PdfPage
}

export interface Viewer {
  readonly pages: readonly PageView[]
  readonly scale: number
  zoomIn(): void
  zoomOut(): void
  fitToWidth(): void
  /** Called after every scale change with the new scale; pages' `scale` is already updated. */
  onScaleChange(listener: (scale: number) => void): void
  destroy(): void
}

interface PageState {
  view: PageView
  page: PdfPage
  canvas: HTMLCanvasElement | null
  renderedScale: number | null
  task: RenderTask | null
}

export async function createViewer(container: HTMLElement, doc: PdfDocument): Promise<Viewer> {
  const pdfPages: PdfPage[] = []
  const sizes: PageSize[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    pdfPages.push(page)
    sizes.push({ width: vp.width, height: vp.height })
  }

  const pagesEl = document.createElement('div')
  pagesEl.className = 'pages'
  pagesEl.style.padding = `${GAP}px ${GUTTER}px`
  pagesEl.style.rowGap = `${GAP}px`
  container.replaceChildren(pagesEl)

  const states: PageState[] = pdfPages.map((page, i) => {
    const element = document.createElement('div')
    element.className = 'page'
    const overlay = document.createElement('div')
    overlay.className = 'page-overlay'
    element.append(overlay)
    pagesEl.append(element)
    const view: PageView = {
      pageNumber: i + 1,
      width: sizes[i].width,
      height: sizes[i].height,
      scale: 1,
      overlay,
      element,
      pdfPage: page,
    }
    return { view, page, canvas: null, renderedScale: null, task: null }
  })

  let scale = 1
  let fitMode = true
  let destroyed = false
  const listeners: Array<(scale: number) => void> = []

  const widest = () => Math.max(...sizes.map((s) => s.width))

  function applyScale(next: number): void {
    const ratio = container.scrollHeight > 0 ? container.scrollTop / container.scrollHeight : 0
    scale = clampZoom(next)
    sizes.forEach((s, i) => {
      const v = states[i].view
      v.scale = scale
      v.element.style.width = `${s.width * scale}px`
      v.element.style.height = `${s.height * scale}px`
    })
    for (const st of states) {
      // Stale-resolution canvases are dropped; visible ones are re-rendered below.
      if (st.renderedScale !== scale) release(st)
    }
    container.scrollTop = ratio * container.scrollHeight // keep roughly the same place in the document
    update()
    listeners.forEach((l) => l(scale))
  }

  function release(st: PageState): void {
    st.task?.cancel()
    st.task = null
    st.canvas?.remove()
    st.canvas = null
    st.renderedScale = null
  }

  async function render(st: PageState): Promise<void> {
    if (st.renderedScale === scale || st.task) return
    const target = scale
    const dpr = window.devicePixelRatio || 1
    const viewport = st.page.getViewport({ scale: target * dpr })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.className = 'page-canvas'
    canvas.style.width = `${st.view.width * target}px`
    canvas.style.height = `${st.view.height * target}px`
    const task = st.page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS })
    st.task = task
    try {
      await task.promise
    } catch (e) {
      if ((e as Error)?.name === 'RenderingCancelledException') return
      throw e
    } finally {
      if (st.task === task) st.task = null
    }
    if (destroyed || target !== scale) {
      // Zoom changed while rendering; the update() that followed it re-renders.
      update()
      return
    }
    st.canvas?.remove()
    st.canvas = canvas
    st.renderedScale = target
    st.view.element.prepend(canvas)
    st.view.element.dataset.rendered = 'true'
  }

  function update(): void {
    if (destroyed) return
    const layout = layoutPages(sizes, scale, GAP)
    const top = container.scrollTop - GAP
    const visible = new Set(visiblePages(layout, top, container.clientHeight, RENDER_MARGIN))
    states.forEach((st, i) => {
      if (visible.has(i)) {
        void render(st).catch(() => {})
      } else if (st.canvas) {
        release(st)
        delete st.view.element.dataset.rendered
      }
    })
  }

  function fit(): void {
    fitMode = true
    applyScale(fitToWidthScale(container.clientWidth, widest(), GUTTER))
  }

  let pending = 0
  const onScroll = () => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      update()
    })
  }
  container.addEventListener('scroll', onScroll, { passive: true })
  const resizeObserver = new ResizeObserver(() => {
    if (fitMode) fit()
    else update()
  })
  resizeObserver.observe(container)

  fit()

  return {
    pages: states.map((s) => s.view),
    get scale() {
      return scale
    },
    zoomIn() {
      fitMode = false
      applyScale(stepZoom(scale, 'in'))
    },
    zoomOut() {
      fitMode = false
      applyScale(stepZoom(scale, 'out'))
    },
    fitToWidth: fit,
    onScaleChange(listener) {
      listeners.push(listener)
    },
    destroy() {
      destroyed = true
      container.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      if (pending) cancelAnimationFrame(pending)
      states.forEach(release)
      container.replaceChildren()
      void doc.loadingTask.destroy()
    },
  }
}
