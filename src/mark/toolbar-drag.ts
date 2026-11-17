import type { PageView, Viewer } from './viewer'

// Drag a tool (a toolbar element with `data-tool`) onto a page. Calls `onDrop` with the tool
// name and the drop position in PDF page units. Dropping anywhere that is not a page cancels.
// From the keyboard, Enter or Space on a tool places it in the middle of what is in view of
// `viewArea`, so the tools work without a pointer.

export function attachToolbarDrag(
  toolbar: HTMLElement,
  getViewer: () => Viewer | null,
  onDrop: (tool: string, page: PageView, x: number, y: number) => void,
  viewArea?: HTMLElement,
): () => void {
  const ac = new AbortController()
  const pageAt = (clientX: number, clientY: number) =>
    getViewer()?.pages.find((p) => {
      const r = p.overlay.getBoundingClientRect()
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
    })
  const dropAt = (tool: HTMLElement, clientX: number, clientY: number) => {
    const page = pageAt(clientX, clientY)
    if (!page) return false
    const r = page.overlay.getBoundingClientRect()
    onDrop(tool.dataset.tool!, page, (clientX - r.left) / page.scale, (clientY - r.top) / page.scale)
    return true
  }
  toolbar.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const tool = (e.target as Element).closest<HTMLElement>('[data-tool]')
      if (!tool || tool.getAttribute('aria-disabled') === 'true' || !viewArea) return
      e.preventDefault()
      const area = viewArea.getBoundingClientRect()
      const x = area.left + area.width / 2
      // Try the middle of the view, then a little higher and lower, to land on a page rather than the gap between pages.
      for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) if (dropAt(tool, x, area.top + area.height * fraction)) return
    },
    { signal: ac.signal },
  )
  toolbar.addEventListener(
    'pointerdown',
    (down) => {
      const tool = (down.target as Element).closest<HTMLElement>('[data-tool]')
      if (!tool || down.button !== 0 || tool.getAttribute('aria-disabled') === 'true') return
      down.preventDefault()
      const ghost = document.createElement('div')
      ghost.className = 'tool-ghost'
      ghost.textContent = tool.dataset.ghost ?? tool.textContent
      tool.classList.add('dragging')
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
        tool.classList.remove('dragging')
        if (e.type === 'pointercancel') return
        dropAt(tool, e.clientX, e.clientY)
      }
      window.addEventListener('pointermove', place)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    { signal: ac.signal },
  )
  return () => ac.abort()
}
