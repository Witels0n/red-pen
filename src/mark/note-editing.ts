import { askNumber } from './dialog'
import { getLastOutOf, setLastOutOf } from './last-out-of'
import type { MarkingModel } from './marking-model'
import type { PageView, Viewer } from './viewer'

// In-place editing: typing into Text notes and changing the Total's out-of value.

/** Open an inline editor at a position; Enter or blur commits, Escape cancels. */
export function editTextAt(
  page: PageView,
  x: number,
  y: number,
  initial: string,
  onCommit: (text: string) => void,
): void {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'note-editor'
  input.value = initial
  input.style.left = `${x * page.scale}px`
  input.style.top = `${y * page.scale}px`
  for (const type of ['click', 'dblclick', 'contextmenu', 'pointerdown']) {
    input.addEventListener(type, (e) => e.stopPropagation())
  }
  let done = false
  const finish = (commit: boolean) => {
    if (done) return
    done = true
    const text = input.value.trim()
    input.remove()
    if (commit) onCommit(text)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
  page.overlay.append(input)
  input.focus()
  input.select()
}

/** Ask for the Total's out-of value and place it (pre-filled with the last value used). */
export async function placeTotalWithPrompt(model: MarkingModel, page: PageView, x: number, y: number): Promise<void> {
  if (model.getTotal()) return
  const outOf = await askNumber('Total marks (out of):', getLastOutOf())
  if (outOf === null || model.getTotal()) return
  setLastOutOf(outOf)
  model.placeTotal(page.pageNumber, x, y, outOf)
}

export function attachNoteEditing(viewer: Viewer, model: MarkingModel): () => void {
  const ac = new AbortController()
  const find = (e: Event) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-annotation-id]')
    return el ? model.getAnnotations().find((a) => a.id === el.dataset.annotationId) : undefined
  }
  for (const page of viewer.pages) {
    // Clicking the Total edits its out-of value.
    page.overlay.addEventListener(
      'click',
      (e) => {
        const a = find(e)
        if (a?.type !== 'total') return
        void askNumber('Total marks (out of):', a.outOf).then((outOf) => {
          if (outOf === null) return
          setLastOutOf(outOf)
          model.setTotalOutOf(a.id, outOf)
        })
      },
      { signal: ac.signal },
    )
    // Double-clicking a Text note edits it; clearing it removes the note.
    page.overlay.addEventListener(
      'dblclick',
      (e) => {
        const a = find(e)
        if (a?.type !== 'text') return
        editTextAt(page, a.x, a.y, a.text, (text) => {
          if (text === '') model.deleteAnnotation(a.id)
          else if (text !== a.text) model.editText(a.id, text)
        })
      },
      { signal: ac.signal },
    )
  }
  return () => ac.abort()
}
