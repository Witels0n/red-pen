// Small DOM helpers for the Marks analysis screens.
import { downloadFile } from '../../shared/pdf/download'

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

type AttrValue = string | number | boolean | undefined | null
type Attrs = Record<string, AttrValue | ((event: never) => unknown)>
export type Child = Node | string | null | undefined | false

/** A small element builder. Text is always set as text, never as HTML. `on*` keys add listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener)
    else if (key === 'class') node.className = String(value)
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

export function showMessage(target: HTMLElement, message: string): void {
  target.textContent = message
  target.hidden = message === ''
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

export const MIME = {
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8',
} as const

export function download(data: Uint8Array | string, fileName: string, type: string): void {
  downloadFile(typeof data === 'string' ? new TextEncoder().encode(data) : data, fileName, type)
}

/** A file name that is safe on every system. */
export function safeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
