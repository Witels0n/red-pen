import type { MarkingModel } from './marking-model'
import type { ReasonsList } from './reasons'

// The Reason pop-up: a small, non-blocking panel offering Reasons for a Cross. It never takes
// focus and never swallows page clicks, so marking carries on as normal. Dismissing it (Escape,
// any pointer press elsewhere, scrolling) leaves the Cross as it is, bare or with its Reason.
//
// Isolated on purpose, and independent of selection (src/selection.ts): `onModelChange` opens
// the pop-up for a newly placed Cross, and the click listener on `root` re-opens it for a
// clicked Cross (the same click also selects it; a drag-move swallows its click, so moving a
// Cross never opens the pop-up). Deleting the Cross closes the pop-up.

export interface ReasonPopup {
  /** Open the pop-up for a Cross (no-op if it does not exist or is not a Cross). */
  open(crossId: string): void
  close(): void
  destroy(): void
}

export interface ReasonPopupOptions {
  /** The scrolling viewer element; clicks on Crosses inside it re-open the pop-up. */
  root: HTMLElement
  model: MarkingModel
  reasons: ReasonsList
  /** Called when the teacher chooses "Edit reasons" in the pop-up. */
  onEditReasons(): void
}

export function attachReasonPopup({ root, model, reasons, onEditReasons }: ReasonPopupOptions): ReasonPopup {
  let popup: HTMLElement | null = null
  let popupFor: string | null = null
  let knownIds = new Set(model.getAnnotations().map((a) => a.id))

  function close(): void {
    popup?.remove()
    popup = null
    popupFor = null
  }

  function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = label
    // Keep keyboard/mouse focus where it was; the pop-up must never interrupt marking.
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  function open(crossId: string): void {
    const cross = model.getAnnotations().find((a) => a.id === crossId)
    if (cross?.type !== 'cross') return
    close()
    const panel = document.createElement('div')
    panel.className = 'reason-popup'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Reason for this cross')
    for (const r of reasons.get()) {
      const b = button(r, 'reason-choice', () => {
        model.setReason(crossId, r)
        close()
      })
      b.setAttribute('aria-pressed', String(cross.reason === r))
      panel.append(b)
    }
    if (cross.reason) {
      panel.append(
        button('Clear', 'reason-clear', () => {
          model.setReason(crossId, undefined)
          close()
        }),
      )
    }
    panel.append(
      button('Edit reasons…', 'reason-edit', () => {
        close()
        onEditReasons()
      }),
    )
    document.body.append(panel)
    popup = panel
    popupFor = crossId
    position(panel, crossId)
  }

  /** Place the panel beside the Cross, kept inside the window. */
  function position(panel: HTMLElement, crossId: string): void {
    const target = document.querySelector(`[data-annotation-id="${CSS.escape(crossId)}"]`)
    const r = (target?.querySelector('circle') ?? target)?.getBoundingClientRect()
    if (!r) {
      close()
      return
    }
    const box = panel.getBoundingClientRect()
    const left = Math.max(4, Math.min(r.right + 8, window.innerWidth - box.width - 4))
    const top = Math.max(4, Math.min(r.top - 4, window.innerHeight - box.height - 4))
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  // Open for a newly placed Cross. The annotation layer renders on the same change, so wait a
  // microtask for its element to exist before positioning.
  function onModelChange(): void {
    const annotations = model.getAnnotations()
    const added = annotations.filter((a) => !knownIds.has(a.id))
    knownIds = new Set(annotations.map((a) => a.id))
    if (added.length === 1 && added[0].type === 'cross') {
      const id = added[0].id
      queueMicrotask(() => open(id))
    } else if (popupFor && !knownIds.has(popupFor)) {
      close() // its Cross was deleted (or the Test was replaced)
    }
  }
  const offModel = model.onChange(onModelChange)

  const onPointerDown = (e: PointerEvent) => {
    if (popup && !popup.contains(e.target as Node)) close()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const onRootClick = (e: MouseEvent) => {
    const el = (e.target as Element).closest('.annotation-cross')
    const id = el?.getAttribute('data-annotation-id')
    if (id) open(id)
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
  root.addEventListener('click', onRootClick)
  root.addEventListener('scroll', close)
  window.addEventListener('resize', close)

  return {
    open,
    close,
    destroy() {
      close()
      offModel()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('click', onRootClick)
      root.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    },
  }
}
