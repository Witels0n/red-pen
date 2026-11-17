const DRAG_TYPE = 'application/x-red-pen-item'

/**
 * Drag and drop reordering for the items in `container` that match `itemSelector`.
 * Each item needs `draggable="true"`. Calls `onMove(from, to)` with indexes among those items;
 * the caller updates its model and re-renders. Keyboard users get move buttons instead.
 */
export function attachSortable(
  container: HTMLElement,
  itemSelector: string,
  onMove: (from: number, to: number) => void,
): void {
  let from = -1
  const items = () => [...container.querySelectorAll<HTMLElement>(itemSelector)]
  const itemOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(itemSelector) : null
  const clearMarks = () => {
    for (const el of items()) el.classList.remove('drop-before', 'drop-after', 'dragging')
  }
  /** Whether a drop at this point lands after the item under the pointer rather than before it. */
  const isAfter = (item: HTMLElement, e: DragEvent): boolean => {
    const r = item.getBoundingClientRect()
    const row = r.width > r.height * 1.5 // list rows compare vertically; grid cells horizontally
    return row ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2
  }

  container.addEventListener('dragstart', (e) => {
    const item = itemOf(e.target)
    if (!item || !e.dataTransfer) return
    from = items().indexOf(item)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_TYPE, String(from))
    item.classList.add('dragging')
  })
  container.addEventListener('dragover', (e) => {
    if (from < 0) return
    const item = itemOf(e.target)
    if (!item) return
    e.preventDefault()
    const after = isAfter(item, e)
    for (const el of items()) el.classList.remove('drop-before', 'drop-after')
    item.classList.add(after ? 'drop-after' : 'drop-before')
  })
  container.addEventListener('drop', (e) => {
    if (from < 0) return
    e.preventDefault()
    const start = from
    from = -1
    const item = itemOf(e.target)
    clearMarks()
    if (!item) return
    const index = items().indexOf(item)
    let to = isAfter(item, e) ? index + 1 : index
    if (to > start) to-- // taking the dragged item out first shifts later indexes down
    if (to !== start) onMove(start, to)
  })
  container.addEventListener('dragend', () => {
    from = -1
    clearMarks()
  })
}
