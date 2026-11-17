/**
 * Reordering by dragging a handle, with a finger, pen or mouse (HTML drag and drop does not work
 * with touch on most phones). The dragged item follows the pointer; the item under the pointer
 * shows where it will land; the page scrolls when the pointer nears the top or bottom edge.
 * Calls `onMove(from, to)` with indexes among the items. Handles need `touch-action: none`.
 */
export function attachPointerSort(
  container: HTMLElement,
  itemSelector: string,
  handleSelector: string,
  onMove: (from: number, to: number) => void,
): void {
  let drag: {
    item: HTMLElement
    from: number
    pointerId: number
    startX: number
    startY: number
    startScroll: number
    x: number
    y: number
    target: { index: number; after: boolean } | null
    frame: number
  } | null = null

  const items = () => [...container.querySelectorAll<HTMLElement>(itemSelector)]
  const clearMarks = () => {
    for (const el of items()) el.classList.remove('drop-before', 'drop-after')
  }

  const place = () => {
    if (!drag) return
    const dy = drag.y - drag.startY + (window.scrollY - drag.startScroll)
    drag.item.style.transform = `translate(${drag.x - drag.startX}px, ${dy}px)`
    clearMarks()
    drag.target = null
    const dragged = drag.item
    const under = document
      .elementsFromPoint(drag.x, drag.y)
      .find((el) => !dragged.contains(el))
      ?.closest<HTMLElement>(itemSelector)
    if (!under || under === drag.item || !container.contains(under)) return
    const r = under.getBoundingClientRect()
    const row = r.width > r.height * 1.5 // list rows compare vertically; grid cells horizontally
    const after = row ? drag.y > r.top + r.height / 2 : drag.x > r.left + r.width / 2
    under.classList.add(after ? 'drop-after' : 'drop-before')
    drag.target = { index: items().indexOf(under), after }
  }

  const tick = () => {
    if (!drag) return
    const edge = 56
    const speed =
      drag.y < edge ? -(edge - drag.y) / 3 : drag.y > innerHeight - edge ? (drag.y - innerHeight + edge) / 3 : 0
    if (speed) {
      window.scrollBy(0, speed)
      place()
    }
    drag.frame = requestAnimationFrame(tick)
  }

  const end = (commit: boolean) => {
    if (!drag) return
    const d = drag
    drag = null
    cancelAnimationFrame(d.frame)
    d.item.classList.remove('dragging')
    d.item.style.transform = ''
    clearMarks()
    if (!commit || !d.target) return
    let to = d.target.after ? d.target.index + 1 : d.target.index
    if (to > d.from) to-- // taking the dragged item out first shifts later indexes down
    if (to !== d.from) onMove(d.from, to)
  }

  container.addEventListener('pointerdown', (e) => {
    const handle = (e.target as Element).closest(handleSelector)
    const item = handle?.closest<HTMLElement>(itemSelector)
    if (!handle || !item || drag || e.button !== 0) return
    e.preventDefault()
    ;(handle as HTMLElement).setPointerCapture(e.pointerId)
    drag = {
      item,
      from: items().indexOf(item),
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: window.scrollY,
      x: e.clientX,
      y: e.clientY,
      target: null,
      frame: 0,
    }
    item.classList.add('dragging')
    drag.frame = requestAnimationFrame(tick)
  })
  container.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    drag.x = e.clientX
    drag.y = e.clientY
    place()
  })
  container.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) end(true)
  })
  container.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) end(false)
  })
}
