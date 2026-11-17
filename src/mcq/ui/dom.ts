// Small DOM helpers shared by the MCQ screens.
import { downloadFile } from '../../shared/pdf/download'

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

type AttrValue = string | number | boolean | undefined | null
/** Attributes, plus `onclick`-style listeners. */
type Attrs = Record<string, AttrValue | ((event: never) => unknown)>
type Child = Node | string | null | undefined | false

/** A small element builder. Text is always set as text, never as HTML. `on*` keys add listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener)
    } else if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'value' && 'value' in node) (node as HTMLInputElement).value = String(value)
    else if (key === 'checked' && 'checked' in node) (node as HTMLInputElement).checked = Boolean(value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) if (child) node.append(child)
  return node
}

export function clear(node: HTMLElement, ...children: (Child | Child[])[]): void {
  node.replaceChildren(...(children.flat().filter(Boolean) as (Node | string)[]))
}

/** Shows a message in an error or status line, or hides it when the message is empty. */
export function showMessage(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

export const MIME = {
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export function download(data: Uint8Array | string, fileName: string, type: string): void {
  downloadFile(typeof data === 'string' ? new TextEncoder().encode(data) : data, fileName, type)
}

/**
 * Runs a slow job from a button: disables it and shows `busy` text while it runs, and reports a
 * failure in `status`.
 */
export async function busy(
  button: HTMLButtonElement,
  label: string,
  status: HTMLElement,
  work: () => Promise<void>,
): Promise<void> {
  const original = button.textContent
  button.disabled = true
  button.textContent = label
  showMessage(status, '')
  try {
    await work()
  } catch (error) {
    status.classList.add('error')
    showMessage(status, errorMessage(error))
  } finally {
    button.disabled = false
    button.textContent = original
  }
}

const dateFormat = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' })

export function changedWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  return new Date(now).toDateString() === d.toDateString() ? `today at ${timeFormat.format(d)}` : dateFormat.format(d)
}

let cancelOpenConfirm: (() => void) | null = null

/**
 * An in-page question with a button per choice and Cancel, placed in `host`. Resolves to the chosen
 * value, or null on Cancel (or Escape). The first choice is drawn as `firstClass` (for example danger).
 */
export function choiceInPage<T extends string>(
  host: HTMLElement,
  message: string,
  choices: readonly { value: T; label: string }[],
  firstClass = 'primary',
): Promise<T | null> {
  cancelOpenConfirm?.()
  return new Promise((resolve) => {
    const box = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': message })
    const done = (value: T | null) => {
      cancelOpenConfirm = null
      box.remove()
      resolve(value)
    }
    cancelOpenConfirm = () => done(null)
    const buttons = choices.map((c, i) =>
      h('button', {
        type: 'button',
        class: i === 0 ? `${firstClass} small` : 'small',
        text: c.label,
        onclick: () => done(c.value),
      }),
    )
    const no = h('button', { type: 'button', class: 'small', text: 'Cancel', onclick: () => done(null) })
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null)
    })
    box.append(h('p', { text: message }), h('div', { class: 'actions' }, ...buttons, no))
    host.append(box)
    no.focus()
  })
}

/** An in-page "Are you sure?" with two buttons, placed in `host`. Resolves true on confirm. */
export async function confirmInPage(host: HTMLElement, message: string, confirmLabel: string): Promise<boolean> {
  return (await choiceInPage(host, message, [{ value: 'yes', label: confirmLabel }], 'danger')) === 'yes'
}

/** A way to find the focused control again after a screen is re-drawn: its id, or its name and value. */
export function focusKey(): string | null {
  const a = document.activeElement
  if (!(a instanceof HTMLElement) || a === document.body) return null
  if (a.id) return `#${CSS.escape(a.id)}`
  const name = a.getAttribute('name')
  if (name) return `[name="${CSS.escape(name)}"][value="${CSS.escape((a as HTMLInputElement).value)}"]`
  const label = a.getAttribute('aria-label')
  return label ? `${a.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]` : null
}

export function restoreFocus(root: HTMLElement, key: string | null): void {
  if (key) root.querySelector<HTMLElement>(key)?.focus()
}
