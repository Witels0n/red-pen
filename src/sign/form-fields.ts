import type { FieldValue } from './export'
import type { PageView } from './viewer'

// Real form fields (AcroForm) shown as editable inputs over the page. pdf.js reports where each
// widget is and what it holds; the values are written back with pdf-lib on save.

/** A widget's place on the page in displayed page units. */
export interface FieldRect {
  x: number
  y: number
  width: number
  height: number
}

interface WidgetInfo {
  name: string
  rect: FieldRect
  element: HTMLElement
}

/** The parts of a pdf.js widget annotation this layer reads. */
interface PdfWidget {
  subtype: string
  fieldName?: string
  fieldType?: string
  rect: number[]
  fieldValue?: string | string[] | null
  exportValue?: string
  buttonValue?: string
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  multiLine?: boolean
  readOnly?: boolean
  hidden?: boolean
  combo?: boolean
  maxLen?: number
  options?: { exportValue: string; displayValue: string }[]
}

export interface FormLayer {
  /** Number of fields shown. */
  readonly count: number
  /** Values of the fields the teacher changed, by full field name. Untouched fields keep their look. */
  values(): Map<string, FieldValue>
  /** Widget areas on a page, so detected boxes under them can be dropped. */
  rects(pageNumber: number): FieldRect[]
  /** Re-position after zoom. */
  layout(): void
  destroy(): void
}

export async function attachFormLayer(pages: readonly PageView[], onEdit: () => void): Promise<FormLayer> {
  const widgets: (WidgetInfo & { page: PageView })[] = []
  const values = new Map<string, FieldValue>()
  const changed = new Set<string>()
  const edited = (name: string) => {
    changed.add(name)
    onEdit()
  }
  const radioCount = new Map<string, number>()
  const layers: HTMLElement[] = []

  for (const page of pages) {
    let annotations: PdfWidget[]
    try {
      annotations = (await page.pdfPage.getAnnotations()) as PdfWidget[]
    } catch {
      continue
    }
    const viewport = page.pdfPage.getViewport({ scale: 1 })
    let layer: HTMLElement | null = null
    for (const a of annotations) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.hidden || a.pushButton) continue
      if (a.fieldType !== 'Tx' && a.fieldType !== 'Btn' && a.fieldType !== 'Ch') continue
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[]
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[]
      const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
      const element = createInput(a, values, radioCount, edited)
      if (!element) continue
      if (!layer) {
        layer = document.createElement('div')
        layer.className = 'form-layer'
        page.overlay.append(layer)
        layers.push(layer)
      }
      element.classList.add('form-field')
      element.dataset.field = a.fieldName
      layer.append(element)
      widgets.push({ name: a.fieldName, rect, element, page })
    }
  }

  // Widgets of the same field (a name printed twice) stay in step.
  for (const w of widgets) {
    const input = w.element as HTMLInputElement
    if (input.type === 'radio' || input.type === 'checkbox') continue
    w.element.addEventListener('input', () => {
      for (const other of widgets) if (other !== w && other.name === w.name) (other.element as HTMLInputElement).value = input.value
    })
  }
  for (const w of widgets) {
    if ((w.element as HTMLInputElement).type !== 'checkbox') continue
    w.element.addEventListener('change', () => {
      for (const other of widgets) if (other !== w && other.name === w.name) (other.element as HTMLInputElement).checked = (w.element as HTMLInputElement).checked
    })
  }

  const layout = () => {
    for (const w of widgets) {
      const s = w.page.scale
      const st = w.element.style
      st.left = `${w.rect.x * s}px`
      st.top = `${w.rect.y * s}px`
      st.width = `${w.rect.width * s}px`
      st.height = `${w.rect.height * s}px`
      if (w.element.tagName !== 'INPUT' || (w.element as HTMLInputElement).type === 'text') {
        st.fontSize = `${Math.max(6, Math.min(w.rect.height * 0.65, 14)) * s}px`
      }
    }
  }
  layout()

  return {
    count: widgets.length,
    values: () => new Map([...values].filter(([name]) => changed.has(name))),
    rects: (n) => widgets.filter((w) => w.page.pageNumber === n).map((w) => w.rect),
    layout,
    destroy: () => layers.forEach((l) => l.remove()),
  }
}

function createInput(a: PdfWidget, values: Map<string, FieldValue>, radioCount: Map<string, number>, onEdit: (name: string) => void): HTMLElement | null {
  const name = a.fieldName!
  const label = `Form field ${name}`
  if (a.fieldType === 'Btn' && a.radioButton) {
    const index = radioCount.get(name) ?? 0
    radioCount.set(name, index + 1)
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = `field-${name}`
    input.value = a.buttonValue ?? ''
    input.checked = a.fieldValue === a.buttonValue
    input.disabled = !!a.readOnly
    input.setAttribute('aria-label', `${label}: ${input.value}`)
    if (!values.has(name)) values.set(name, { kind: 'radio', value: null })
    if (input.checked) values.set(name, { kind: 'radio', value: input.value, index })
    input.addEventListener('change', () => {
      if (input.checked) values.set(name, { kind: 'radio', value: input.value, index })
      onEdit(name)
    })
    return input
  }
  if (a.fieldType === 'Btn') {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = !!a.fieldValue && a.fieldValue !== 'Off'
    input.disabled = !!a.readOnly
    input.setAttribute('aria-label', label)
    values.set(name, { kind: 'checkbox', checked: input.checked })
    input.addEventListener('change', () => {
      values.set(name, { kind: 'checkbox', checked: input.checked })
      onEdit(name)
    })
    return input
  }
  if (a.fieldType === 'Ch') {
    const select = document.createElement('select')
    select.disabled = !!a.readOnly
    select.setAttribute('aria-label', label)
    select.append(new Option('', ''))
    const current = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue
    for (const o of a.options ?? []) {
      const text = o.displayValue ?? o.exportValue
      select.append(new Option(text, text, false, current === o.exportValue || current === o.displayValue))
    }
    values.set(name, { kind: 'choice', value: select.value })
    select.addEventListener('change', () => {
      values.set(name, { kind: 'choice', value: select.value })
      onEdit(name)
    })
    return select
  }
  const input = a.multiLine ? document.createElement('textarea') : document.createElement('input')
  if (input instanceof HTMLInputElement) input.type = 'text'
  input.value = typeof a.fieldValue === 'string' ? a.fieldValue : ''
  input.disabled = !!a.readOnly
  if (a.maxLen) input.maxLength = a.maxLen
  input.setAttribute('aria-label', label)
  input.spellcheck = false
  values.set(name, { kind: 'text', value: input.value })
  input.addEventListener('input', () => {
    values.set(name, { kind: 'text', value: input.value })
    onEdit(name)
  })
  return input
}
