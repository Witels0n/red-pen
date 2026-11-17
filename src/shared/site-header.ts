import './tokens.css'
import './site-header.css'
import './motion'

export interface SiteHeaderOptions {
  /** The tool's name, shown after the wordmark. Omit on the landing page. */
  toolName?: string
}

/**
 * Inserts the shared Red Pen header at the top of <body> and returns it.
 * The wordmark links to the site's home page, wherever the site is hosted.
 */
export function mountSiteHeader(options: SiteHeaderOptions = {}): HTMLElement {
  const header = document.createElement('header')
  header.className = 'site-header'

  const home = document.createElement('a')
  home.className = 'wordmark'
  home.href = import.meta.env.BASE_URL
  home.innerHTML = 'Red <span>Pen</span>'
  header.append(home)

  const label = document.createElement('span')
  if (options.toolName) {
    label.className = 'tool-name'
    label.textContent = options.toolName
  } else {
    label.className = 'tagline'
    label.textContent = 'Tools for teachers'
  }
  header.append(label)

  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  header.append(spacer)

  document.body.prepend(header)
  return header
}

/** Shows "A new version of Red Pen is ready" with a Reload button in the header. */
export function showUpdateNote(header: HTMLElement, reload: () => void): void {
  if (header.querySelector('.update-note')) return
  const note = document.createElement('span')
  note.className = 'update-note'
  note.setAttribute('role', 'status')
  note.textContent = 'A new version of Red Pen is ready.'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Reload'
  button.addEventListener('click', reload)
  note.append(button)
  header.append(note)
}
