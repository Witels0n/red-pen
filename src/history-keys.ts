import type { MarkingModel } from './marking-model'

/** Ctrl/Cmd+Z undoes; Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redoes. Ignored while typing in a field. */
export function attachHistoryKeys(model: MarkingModel): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) model.undo()
    else if (key === 'y' || (key === 'z' && e.shiftKey)) model.redo()
    else return
    e.preventDefault()
  }
  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}
