import { registerOffline } from '../pwa'
import { mountSiteHeader } from '../site-header'
import './pdf-tool.css'

/** Sets up a PDF Tool page: the shared header, offline support and the PDF Tools' styles. */
export function startPdfTool(toolName: string): void {
  registerOffline(mountSiteHeader({ toolName }))
  // File pickers are <label for> a hidden input; make them reachable and usable from the keyboard.
  for (const label of document.querySelectorAll<HTMLLabelElement>('label.button[for]')) {
    label.tabIndex = 0
    label.setAttribute('role', 'button')
    label.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      document.getElementById(label.htmlFor)?.click()
    })
  }
}

/** Shorthand for a required element by id. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

/** "1 page", "3 pages". */
export function pages(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`
}
