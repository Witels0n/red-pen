// What the three moderation form pages share: the fields bound to one set of values, the draft
// and saved forms kept in this browser, the school's logo, and the PDF downloads.
import './styles.css'
import { mountSiteHeader } from '../shared/site-header'
import { registerOffline } from '../shared/pwa'
import { downloadFile } from '../shared/pdf/download'
import {
  SHARED_KEYS,
  formFileName,
  freshValues,
  parseSavedForms,
  parseValues,
  upsertForm,
  type FormInfo,
  type SavedForm,
  type Values,
} from './core/forms'

const SHARED_KEY = 'red-pen.moderation.details'
const LOGO_KEY = 'red-pen.moderation.logo'
/** The longest side of a stored logo, in pixels: plenty for print at the size it is drawn. */
const LOGO_SIDE = 900
const LOGO_BYTES = 400_000

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function readJson(key: string): unknown {
  const raw = read(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------- Field builders ----------

export interface FieldOptions {
  type?: 'text' | 'date' | 'textarea'
  placeholder?: string
  maxLength?: number
  rows?: number
  /** Extra classes on the wrapping label. */
  className?: string
  /** Hide the label visually (it is still read out). */
  quiet?: boolean
}

/** A labelled input bound to `key`. */
export function field(label: string | Node, key: string, options: FieldOptions = {}): HTMLLabelElement {
  const type = options.type ?? 'text'
  const input =
    type === 'textarea'
      ? el('textarea', { rows: options.rows ?? 2, maxLength: options.maxLength ?? 600 })
      : el('input', { type, maxLength: options.maxLength ?? 120 })
  if (options.placeholder) input.placeholder = options.placeholder
  input.dataset.key = key
  const caption = el('span', { className: options.quiet ? 'visually-hidden' : '' }, label)
  return el('label', { className: `field ${options.className ?? ''}`.trim() }, caption, input)
}

/** A row of pills where one may be chosen, or none. */
export function choice(legend: string, key: string, options: { value: string; label: string }[]): HTMLElement {
  const group = el('div', { className: 'segmented' })
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', legend)
  for (const option of [...options, { value: '', label: 'Leave blank' }]) {
    const input = el('input', { type: 'radio', name: key, value: option.value })
    input.dataset.key = key
    group.append(el('label', {}, input, el('span', {}, option.label)))
  }
  return el('div', { className: 'choice' }, el('span', { className: 'choice-legend' }, legend), group)
}

export function panel(title: string, ...children: (Node | string)[]): HTMLElement {
  return el('section', { className: 'panel' }, el('h2', {}, title), ...children)
}

/** Criterion text for the page: **double asterisks** become bold. */
export function marked(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  text.split('**').forEach((part, i) => {
    if (part === '') return
    out.append(i % 2 === 1 ? el('b', {}, part) : part)
  })
  return out
}

// ---------- The page ----------

export interface FormPage {
  form: FormInfo
  toolName: string
  /** Builds the form's own fields into the page. */
  render(root: HTMLElement, page: { values: () => Values; set: (changes: Values) => void }): void
  build(values: Values, logo: string | null): Promise<Uint8Array>
  /** The parts of the file name after the form's own, for example the subject and the task. */
  fileParts(values: Values): (string | undefined)[]
}

async function shrinkLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Choose a PNG or JPEG picture.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That picture could not be opened. Save it as a PNG or JPEG and try again.')
  }
  try {
    const scale = Math.min(1, LOGO_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not prepare the picture.')
    // On white, so a see-through logo does not print on black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let data = canvas.toDataURL('image/png')
    if (data.length * 0.75 > LOGO_BYTES) data = canvas.toDataURL('image/jpeg', 0.9)
    if (data.length * 0.75 > LOGO_BYTES) throw new Error('That picture is too large, even after shrinking.')
    return data
  } finally {
    bitmap.close()
  }
}

export function startFormPage(page: FormPage): void {
  registerOffline(mountSiteHeader({ toolName: page.toolName }))
  const { form } = page
  const DRAFT_KEY = `red-pen.moderation.${form.id}.draft`
  const SAVED_KEY = `red-pen.moderation.${form.id}.saved`

  const root = byId('form-fields')
  const status = byId('form-status')
  const savedSelect = byId<HTMLSelectElement>('saved-select')
  const loadSaved = byId<HTMLButtonElement>('load-saved')
  const deleteSaved = byId<HTMLButtonElement>('delete-saved')
  const saveName = byId<HTMLInputElement>('save-name')
  const downloadStatus = byId('download-status')
  const logoInput = byId<HTMLInputElement>('logo-input')
  const logoPreview = byId<HTMLImageElement>('logo-preview')
  const logoRemove = byId<HTMLButtonElement>('logo-remove')
  const logoStatus = byId('logo-status')

  const shared = (): Values => parseValues(readJson(SHARED_KEY))
  const draft = readJson(DRAFT_KEY)
  let values: Values = draft === null ? freshValues(shared()) : parseValues(draft)
  let saved: SavedForm[] = parseSavedForms(readJson(SAVED_KEY))
  let logo = read(LOGO_KEY)

  function persist(): void {
    write(DRAFT_KEY, JSON.stringify(values))
    const details = shared()
    let changed = false
    for (const key of SHARED_KEYS) {
      if (values[key] && values[key] !== details[key]) {
        details[key] = values[key]!
        changed = true
      }
    }
    if (changed) write(SHARED_KEY, JSON.stringify(details))
  }

  /** Puts the values into every field on the page. */
  function fill(): void {
    for (const node of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-key]')) {
      const value = values[node.dataset.key!] ?? ''
      if (node instanceof HTMLInputElement && node.type === 'radio') node.checked = node.value === value
      else node.value = value
    }
    if (!saveName.value) saveName.value = suggestedName()
  }

  function suggestedName(): string {
    return page
      .fileParts(values)
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(' - ')
  }

  function set(changes: Values): void {
    for (const [key, value] of Object.entries(changes)) {
      if (value === '') delete values[key]
      else values[key] = value
    }
    persist()
    fill()
  }

  page.render(root, { values: () => values, set })

  document.addEventListener('input', (event) => {
    const node = event.target as HTMLInputElement | HTMLTextAreaElement
    const key = node.dataset?.key
    if (!key) return
    if (node instanceof HTMLInputElement && node.type === 'radio' && !node.checked) return
    if (node.value === '') delete values[key]
    else values[key] = node.value
    persist()
  })

  // ---------- Saved forms ----------

  function renderSaved(selected?: string): void {
    savedSelect.replaceChildren(
      ...(saved.length === 0 ? [new Option('No saved forms yet', '')] : saved.map((s) => new Option(s.name, s.name))),
    )
    savedSelect.disabled = saved.length === 0
    loadSaved.disabled = saved.length === 0
    deleteSaved.disabled = saved.length === 0
    if (selected) savedSelect.value = selected
  }

  byId('start-new').addEventListener('click', () => {
    values = freshValues(shared())
    saveName.value = ''
    persist()
    fill()
    status.textContent = 'Started a new form. Your school details were kept.'
    scrollTo({ top: 0, behavior: 'auto' })
  })

  loadSaved.addEventListener('click', () => {
    const found = saved.find((s) => s.name === savedSelect.value)
    if (!found) return
    values = { ...found.values }
    saveName.value = found.name
    persist()
    fill()
    status.textContent = `Opened "${found.name}".`
  })

  deleteSaved.addEventListener('click', () => {
    const name = savedSelect.value
    if (!name) return
    saved = saved.filter((s) => s.name !== name)
    write(SAVED_KEY, JSON.stringify(saved))
    renderSaved()
    status.textContent = `Deleted "${name}".`
  })

  byId('save-form').addEventListener('click', () => {
    const name = saveName.value.trim() || suggestedName() || form.title
    saved = upsertForm(saved, { name, savedAt: Date.now(), values: { ...values } })
    const kept = write(SAVED_KEY, JSON.stringify(saved))
    renderSaved(name)
    downloadStatus.textContent = kept
      ? `Saved "${name}" in this browser.`
      : 'This browser would not save the form. Download the PDF instead.'
  })

  // ---------- Logo ----------

  function renderLogo(): void {
    logoPreview.hidden = !logo
    logoRemove.hidden = !logo
    if (logo) logoPreview.src = logo
    else logoPreview.removeAttribute('src')
  }

  logoInput.addEventListener('change', async () => {
    const file = logoInput.files?.[0]
    logoInput.value = ''
    if (!file) return
    try {
      logo = await shrinkLogo(file)
      logoStatus.textContent = write(LOGO_KEY, logo)
        ? 'The logo is kept in this browser and goes on all three forms.'
        : 'The logo is on this form, but this browser would not keep it for next time.'
    } catch (error) {
      logoStatus.textContent = error instanceof Error ? error.message : 'That picture could not be used.'
    }
    renderLogo()
  })

  logoRemove.addEventListener('click', () => {
    logo = null
    write(LOGO_KEY, null)
    logoStatus.textContent = 'The logo was removed.'
    renderLogo()
  })

  // ---------- Downloads ----------

  async function download(blank: boolean, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    downloadStatus.textContent = 'Making the PDF…'
    try {
      const use: Values = blank ? (values.annexure ? { annexure: values.annexure } : {}) : values
      const bytes = await page.build(use, logo)
      const name = blank ? `${form.fileStem} - blank.pdf` : formFileName(form, page.fileParts(values))
      downloadFile(bytes, name, 'application/pdf')
      downloadStatus.textContent = `Downloaded ${name}.`
    } catch {
      downloadStatus.textContent = 'The PDF could not be made. Please try again.'
    } finally {
      button.disabled = false
    }
  }

  const downloadButton = byId<HTMLButtonElement>('download')
  const blankButton = byId<HTMLButtonElement>('download-blank')
  downloadButton.addEventListener('click', () => void download(false, downloadButton))
  blankButton.addEventListener('click', () => void download(true, blankButton))

  renderSaved()
  renderLogo()
  fill()
  document.body.dataset.ready = 'true'
}
