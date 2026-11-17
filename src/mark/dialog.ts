/** Ask for a positive number in a small modal. Resolves to null if cancelled. */
export function askNumber(title: string, initial: number | undefined): Promise<number | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    const dialog = document.createElement('form')
    dialog.className = 'dialog'
    dialog.setAttribute('role', 'dialog')
    const label = document.createElement('label')
    label.textContent = title
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '0'
    input.step = 'any'
    input.id = 'dialog-input'
    if (initial !== undefined) input.value = String(initial)
    label.append(' ', input)
    const row = document.createElement('div')
    row.className = 'row'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    const ok = document.createElement('button')
    ok.type = 'submit'
    ok.id = 'dialog-ok'
    ok.textContent = 'OK'
    row.append(cancel, ok)
    dialog.append(label, row)
    backdrop.append(dialog)

    const close = (value: number | null) => {
      backdrop.remove()
      resolve(value)
    }
    dialog.addEventListener('submit', (e) => {
      e.preventDefault()
      const n = Number(input.value)
      if (input.value !== '' && Number.isFinite(n) && n > 0) close(n)
      else input.focus()
    })
    cancel.addEventListener('click', () => close(null))
    backdrop.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') close(null)
    })
    // Clicks in the dialog must not reach the page underneath.
    backdrop.addEventListener('click', (e) => e.stopPropagation())
    document.body.append(backdrop)
    input.focus()
    input.select()
  })
}
