export interface FileIntakeOptions {
  /** The hidden <input type="file">; every <label for> pointing at it opens the picker. */
  input: HTMLInputElement
  /** Gets the class `drag-over` while files are dragged over the window. */
  highlight: HTMLElement
  /** Called with the chosen or dropped files (only the first one unless the input is `multiple`). */
  onFiles(files: File[]): void
}

/**
 * Takes files from the file picker or from a drag and drop anywhere in the window.
 * Drags that carry no files (for example reordering a list) are left alone.
 */
export function attachFileIntake({ input, highlight, onFiles }: FileIntakeOptions): void {
  const deliver = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])]
    if (files.length === 0) return
    onFiles(input.multiple ? files : files.slice(0, 1))
  }

  input.addEventListener('change', () => {
    deliver(input.files)
    input.value = '' // allow choosing the same file again
  })

  let dragDepth = 0
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth++
    highlight.classList.add('drag-over')
  })
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault()
  })
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) highlight.classList.remove('drag-over')
  })
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    highlight.classList.remove('drag-over')
    deliver(e.dataTransfer?.files)
  })
}
