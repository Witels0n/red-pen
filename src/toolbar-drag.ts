import type { PageView, Viewer } from './viewer'

// Drag a tool (a toolbar element with `data-tool`) onto a page. Calls `onDrop` with the tool
// name and the drop position in PDF page units. Dropping anywhere that is not a page cancels.

export function attachToolbarDrag(
  toolbar: HTMLElement,
  getViewer: () => Viewer | null,
  onDrop: (tool: string, page: PageView, x: number, y: number) => void,
): () => void {
  const ac = new AbortController()
  toolbar.addEventListener(
    'pointerdown',
    (down) => {
      const tool = (down.target as Element).closest<HTMLElement>('[data-tool]')
      if (!tool || down.button !== 0 || tool.getAttribute('aria-disabled') === 'true') return
      down.preventDefault()
      const ghost = document.createElement('div')
      ghost.className = 'tool-ghost'
      ghost.textContent = tool.dataset.ghost ?? tool.textContent
      const place = (e: PointerEvent) => {
        ghost.style.left = `${e.clientX}px`
        ghost.style.top = `${e.clientY}px`
      }
      place(down)
      document.body.append(ghost)

      const finish = (e: PointerEvent) => {
        window.removeEventListener('pointermove', place)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        ghost.remove()
        if (e.type === 'pointercancel') return
        const page = getViewer()?.pages.find((p) => {
          const r = p.overlay.getBoundingClientRect()
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        })
        if (!page) return
        const r = page.overlay.getBoundingClientRect()
        onDrop(tool.dataset.tool!, page, (e.clientX - r.left) / page.scale, (e.clientY - r.top) / page.scale)
      }
      window.addEventListener('pointermove', place)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    { signal: ac.signal },
  )
  return () => ac.abort()
}
