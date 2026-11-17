export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

type Attrs = Record<string, string | number | boolean | undefined>

/** A small element builder. Text children are always set as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'value') (node as HTMLInputElement).value = String(value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child) node.append(child)
  return node
}

/** Shows a message in an error or status line, or hides the line when the message is empty. */
export function showMessage(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const dateFormat = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' })

/** "today at 08:45" or "3 Nov 2026". */
export function changedWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  return new Date(now).toDateString() === d.toDateString() ? `today at ${timeFormat.format(d)}` : dateFormat.format(d)
}

/** Moves to another screen by changing the address (#grid/<id>, or '' for the list), so Back and reload work. */
export function go(hash: string): void {
  const target = hash === '#' ? '' : hash
  if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else if (target === '') {
    history.pushState(null, '', location.pathname + location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = target
  }
}
