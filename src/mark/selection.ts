import type { AnnotationLayer } from './annotation-layer'
import type { MarkingModel } from './marking-model'
import type { PageView, Viewer } from './viewer'

// Selection, drag-to-move and Delete for Annotations of any type. Selection is UI state, so it
// lives here rather than in the marking model. It relies only on the layer's contract: every
// rendered annotation element carries `data-annotation-id` and has a `.annotation` class.
//
// Extending: nothing type-specific here. A new annotation type works as soon as its renderer
// uses `anchor()` (annotation-layer.ts). Undo/redo needs no change: moves and deletes go
// through the model's commands.

const DRAG_THRESHOLD_PX = 3

export interface Selection {
  getSelectedId(): string | null
  select(id: string | null): void
  destroy(): void
}

export function attachSelection(viewer: Viewer, model: MarkingModel, layer: AnnotationLayer): Selection {
  let selectedId: string | null = null
  const ac = new AbortController()
  const { signal } = ac

  function paint(): void {
    if (selectedId && !model.getAnnotations().some((a) => a.id === selectedId)) selectedId = null
    for (const el of document.querySelectorAll<HTMLElement>('[data-annotation-id]')) {
      el.classList.toggle('selected', el.dataset.annotationId === selectedId)
    }
  }

  function select(id: string | null): void {
    selectedId = id
    paint()
  }

  layer.onRender(paint)
  model.onChange(paint)

  const pageAt = (clientX: number, clientY: number): PageView | undefined =>
    viewer.pages.find((p) => {
      const r = p.overlay.getBoundingClientRect()
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
    })

  for (const page of viewer.pages) {
    page.overlay.addEventListener(
      'click',
      (e) => {
        if (!(e.target as Element).closest('[data-annotation-id]')) select(null) // blank page
      },
      { signal },
    )
    page.overlay.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return
        const el = (e.target as Element).closest<HTMLElement>('[data-annotation-id]')
        if (el) startDrag(e, el, page)
      },
      { signal },
    )
  }

  function startDrag(down: PointerEvent, el: HTMLElement, page: PageView): void {
    const id = el.dataset.annotationId!
    const annotation = model.getAnnotations().find((a) => a.id === id)
    if (!annotation) return
    select(id)
    down.preventDefault()
    // Offset between the pointer and the annotation's anchor, kept constant during the drag.
    const rect = page.overlay.getBoundingClientRect()
    const grabX = down.clientX - (rect.left + annotation.x * page.scale)
    const grabY = down.clientY - (rect.top + annotation.y * page.scale)
    let moved = false

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - down.clientX
      const dy = e.clientY - down.clientY
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      moved = true
      // Preview only: the model is updated once, on release.
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) return
      // The click that follows a drag must not place a Tick or change the selection.
      const swallow = (c: Event) => c.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      if (e.type === 'pointercancel') {
        el.style.transform = ''
        return
      }
      const target = pageAt(e.clientX, e.clientY) ?? page
      const r = target.overlay.getBoundingClientRect()
      const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
      model.moveAnnotation(
        id,
        clamp((e.clientX - grabX - r.left) / target.scale, target.width),
        clamp((e.clientY - grabY - r.top) / target.scale, target.height),
        target.pageNumber,
      )
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return
      if (!selectedId) return
      e.preventDefault()
      model.deleteAnnotation(selectedId) // paint() clears the selection
    },
    { signal },
  )

  return {
    getSelectedId: () => selectedId,
    select,
    destroy: () => ac.abort(),
  }
}
