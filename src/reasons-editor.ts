import { DEFAULT_REASONS, type ReasonsList } from './reasons'

// The "Edit reasons" dialog: one Reason per line. Saved to the Reasons list (and so to browser
// storage, which holds only that list). Built lazily; no markup needed in index.html.

export function openReasonsEditor(reasons: ReasonsList): void {
  const dialog = document.createElement('dialog')
  dialog.id = 'reasons-editor'

  const heading = document.createElement('h2')
  heading.textContent = 'Edit reasons'
  const hint = document.createElement('p')
  hint.textContent = 'One reason per line. These are offered when you place a cross, and are remembered in this browser.'
  const area = document.createElement('textarea')
  area.id = 'reasons-text'
  area.rows = 10
  area.setAttribute('aria-label', 'Reasons, one per line')
  area.value = reasons.get().join('\n')

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.id = 'reasons-restore'
  restore.textContent = 'Restore defaults'
  restore.addEventListener('click', () => {
    area.value = DEFAULT_REASONS.join('\n') // takes effect on Save
  })
  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => dialog.close())
  const save = document.createElement('button')
  save.type = 'button'
  save.id = 'reasons-save'
  save.textContent = 'Save'
  save.addEventListener('click', () => {
    reasons.set(area.value.split(/\r?\n/))
    dialog.close()
  })
  actions.append(restore, spacer, cancel, save)

  dialog.append(heading, hint, area, actions)
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
  area.focus()
}
