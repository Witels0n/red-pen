import { inkBounds, smoothStroke, whiteToTransparent } from './image-utils'
import { INK_CSS, type Ink } from './model'
import type { SavedSignatures, SignatureKind } from './saved-signature'

// The dialog for making a signature or initials: draw it, type it in a script font, or upload
// a picture of it. The result is a trimmed PNG with a transparent background.

export const SIGNATURE_FONT = '"Great Vibes", "Segoe Script", cursive'

type Mode = 'draw' | 'type' | 'upload'
type Point = { x: number; y: number }

export interface SignatureResult {
  src: string
  /** Width / height. */
  aspect: number
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...children)
  return el
}

/** The aspect ratio of a PNG data URL. */
export function imageAspect(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight))
    img.onerror = () => resolve(3)
    img.src = src
  })
}

/** Crop a canvas to its ink with a little padding; null if it is empty. */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const b = inkBounds(data.data, canvas.width, canvas.height)
  if (!b) return null
  const pad = 4
  const out = document.createElement('canvas')
  out.width = b.width + pad * 2
  out.height = b.height + pad * 2
  out.getContext('2d')!.drawImage(canvas, b.x, b.y, b.width, b.height, pad, pad, b.width, b.height)
  return out.toDataURL('image/png')
}

export function openSignatureDialog(
  kind: SignatureKind,
  current: string | null,
  saved: SavedSignatures,
): Promise<SignatureResult | null> {
  const noun = kind === 'signature' ? 'signature' : 'initials'
  return new Promise((resolve) => {
    let mode: Mode = 'draw'
    let ink: Ink = 'black'
    let strokes: Point[][] = []
    let uploaded: string | null = null

    const dialog = h('dialog', { className: 'sign-dialog', id: 'signature-dialog' })
    dialog.setAttribute('aria-labelledby', 'signature-title')
    const title = h('h2', {
      id: 'signature-title',
      textContent: kind === 'signature' ? 'Your signature' : 'Your initials',
    })

    // Current signature, if there is one: one click to use it again.
    const currentBox = h('div', { className: 'sign-current' })
    if (current) {
      const useCurrent = h('button', {
        type: 'button',
        className: 'primary',
        id: 'sig-use-current',
        textContent: `Use this ${noun}`,
      })
      useCurrent.addEventListener('click', async () => finish({ src: current, aspect: await imageAspect(current) }))
      currentBox.append(
        h('img', { src: current, alt: `Current ${noun}` }),
        useCurrent,
        h('p', { className: 'muted', textContent: `Or make a new one:` }),
      )
    } else currentBox.hidden = true

    const tabs = h('div', { className: 'sign-tabs' })
    tabs.setAttribute('role', 'tablist')
    const tabButtons: Record<Mode, HTMLButtonElement> = {
      draw: h('button', { type: 'button', textContent: 'Draw', id: 'sig-tab-draw' }),
      type: h('button', { type: 'button', textContent: 'Type', id: 'sig-tab-type' }),
      upload: h('button', { type: 'button', textContent: 'Upload', id: 'sig-tab-upload' }),
    }
    for (const [m, b] of Object.entries(tabButtons) as [Mode, HTMLButtonElement][]) {
      b.setAttribute('role', 'tab')
      b.addEventListener('click', () => setMode(m))
      tabs.append(b)
    }

    // Draw
    const pad = h('canvas', { className: 'sign-pad', id: 'sig-pad' })
    pad.setAttribute('aria-label', `Draw your ${noun} here`)
    const clear = h('button', { type: 'button', textContent: 'Clear', id: 'sig-clear' })
    const drawPanel = h(
      'div',
      { className: 'sign-panel' },
      pad,
      h(
        'div',
        { className: 'sign-row' },
        h('span', { className: 'muted', textContent: 'Use a mouse, finger or stylus.' }),
        clear,
      ),
    )

    // Type
    const typed = h('input', {
      type: 'text',
      id: 'sig-typed',
      placeholder: kind === 'signature' ? 'Type your name' : 'Type your initials',
      autocomplete: 'off',
    })
    typed.setAttribute('aria-label', kind === 'signature' ? 'Your name' : 'Your initials')
    const preview = h('div', { className: 'sign-typed-preview', id: 'sig-typed-preview' })
    preview.style.fontFamily = SIGNATURE_FONT
    typed.addEventListener('input', () => (preview.textContent = typed.value))
    const typePanel = h('div', { className: 'sign-panel' }, typed, preview)

    // Upload
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', id: 'sig-file' })
    file.setAttribute('aria-label', `Picture of your ${noun}`)
    const uploadPreview = h('img', { className: 'sign-upload-preview', alt: '' })
    uploadPreview.hidden = true
    const uploadNote = h('p', {
      className: 'muted',
      textContent: 'A PNG or JPG on white paper. The white background is made transparent.',
    })
    const uploadPanel = h('div', { className: 'sign-panel' }, file, uploadNote, uploadPreview)
    const panels: Record<Mode, HTMLElement> = { draw: drawPanel, type: typePanel, upload: uploadPanel }

    // Ink
    const inkGroup = h('fieldset', { className: 'sign-ink' }, h('legend', { textContent: 'Ink' }))
    for (const value of ['black', 'blue'] as Ink[]) {
      const radio = h('input', {
        type: 'radio',
        name: 'sig-ink',
        value,
        checked: value === ink,
        id: `sig-ink-${value}`,
      })
      radio.addEventListener('change', () => {
        ink = value
        preview.style.color = INK_CSS[ink]
        redraw()
      })
      inkGroup.append(h('label', {}, radio, value === 'black' ? ' Black' : ' Blue'))
    }

    // Remember (opt-in)
    const remember = h('input', { type: 'checkbox', id: 'sig-remember', checked: saved.load(kind) !== null })
    const rememberLabel = h('label', { className: 'sign-remember' }, remember, ` Remember my ${noun} on this device`)
    const rememberNote = h('p', {
      className: 'muted',
      textContent: `Saved only in this browser, never uploaded. Anyone who uses this device and browser could use it.`,
    })
    const forget = h('button', { type: 'button', id: 'sig-forget', textContent: `Forget saved ${noun}` })
    forget.hidden = saved.load(kind) === null
    forget.addEventListener('click', () => {
      saved.forget(kind)
      remember.checked = false
      forget.hidden = true
      error.textContent = `Your saved ${noun} has been removed from this device.`
      error.hidden = false
    })

    const error = h('p', { className: 'sign-message', id: 'sig-message' })
    error.setAttribute('role', 'status')
    error.hidden = true
    const cancel = h('button', { type: 'button', textContent: 'Cancel', id: 'sig-cancel' })
    const done = h('button', { type: 'button', className: 'primary', textContent: `Use ${noun}`, id: 'sig-done' })
    const actions = h('div', { className: 'sign-actions' }, forget, h('span', { className: 'spacer' }), cancel, done)

    dialog.append(
      title,
      currentBox,
      tabs,
      drawPanel,
      typePanel,
      uploadPanel,
      inkGroup,
      rememberLabel,
      rememberNote,
      error,
      actions,
    )
    document.body.append(dialog)

    function setMode(m: Mode): void {
      mode = m
      for (const [k, b] of Object.entries(tabButtons) as [Mode, HTMLButtonElement][])
        b.setAttribute('aria-selected', String(k === m))
      for (const [k, p] of Object.entries(panels) as [Mode, HTMLElement][]) p.hidden = k !== m
      inkGroup.hidden = m === 'upload'
      error.hidden = true
      if (m === 'draw') sizePad()
      if (m === 'type') typed.focus()
    }

    // Drawing pad
    const ctx = pad.getContext('2d')!
    function sizePad(): void {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(200, pad.clientWidth)
      const hgt = Math.max(100, pad.clientHeight)
      if (pad.width !== Math.round(w * dpr)) {
        pad.width = Math.round(w * dpr)
        pad.height = Math.round(hgt * dpr)
        redraw()
      }
    }
    function drawStroke(points: Point[]): void {
      const dpr = window.devicePixelRatio || 1
      const pts = smoothStroke(points).map((p) => ({ x: p.x * dpr, y: p.y * dpr }))
      ctx.strokeStyle = INK_CSS[ink]
      ctx.fillStyle = INK_CSS[ink]
      ctx.lineWidth = 2.6 * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pts.length === 1) {
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        return
      }
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length - 1; i++) {
        const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y)
      }
      const last = pts[pts.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }
    function redraw(): void {
      ctx.clearRect(0, 0, pad.width, pad.height)
      strokes.forEach(drawStroke)
    }
    pad.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      pad.setPointerCapture(e.pointerId)
      const r = pad.getBoundingClientRect()
      const stroke = [{ x: e.clientX - r.left, y: e.clientY - r.top }]
      strokes.push(stroke)
      error.hidden = true
      const move = (ev: PointerEvent) => {
        const events = ev.getCoalescedEvents?.() ?? [ev]
        for (const c of events.length ? events : [ev]) stroke.push({ x: c.clientX - r.left, y: c.clientY - r.top })
        redraw()
      }
      const up = () => {
        pad.removeEventListener('pointermove', move)
        pad.removeEventListener('pointerup', up)
        pad.removeEventListener('pointercancel', up)
        redraw()
      }
      pad.addEventListener('pointermove', move)
      pad.addEventListener('pointerup', up)
      pad.addEventListener('pointercancel', up)
      redraw()
    })
    clear.addEventListener('click', () => {
      strokes = []
      redraw()
    })

    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      if (!f) return
      uploaded = null
      uploadPreview.hidden = true
      try {
        uploaded = await imageFileToSignature(f)
        uploadPreview.src = uploaded
        uploadPreview.hidden = false
        error.hidden = true
      } catch {
        error.textContent = 'That picture could not be used. Please choose a PNG or JPG file.'
        error.hidden = false
      }
    })

    async function makeImage(): Promise<string | null> {
      if (mode === 'upload') return uploaded
      if (mode === 'draw') return strokes.length ? trimmed(pad) : null
      const text = typed.value.trim()
      if (!text) return null
      try {
        await document.fonts.load(`96px ${SIGNATURE_FONT}`, text)
      } catch {
        // Falls back to another script face.
      }
      const c = document.createElement('canvas')
      const cx = c.getContext('2d')!
      cx.font = `96px ${SIGNATURE_FONT}`
      c.width = Math.ceil(cx.measureText(text).width + 60)
      c.height = 170
      cx.font = `96px ${SIGNATURE_FONT}`
      cx.fillStyle = INK_CSS[ink]
      cx.textBaseline = 'alphabetic'
      cx.fillText(text, 30, 115)
      return trimmed(c)
    }

    function finish(result: SignatureResult | null): void {
      if (result) {
        if (remember.checked) saved.save(kind, result.src)
        else saved.forget(kind)
      }
      dialog.close()
      dialog.remove()
      resolve(result)
    }

    done.addEventListener('click', async () => {
      const src = await makeImage()
      if (!src) {
        error.textContent =
          mode === 'draw'
            ? `Draw your ${noun} first.`
            : mode === 'type'
              ? `Type your ${kind === 'signature' ? 'name' : 'initials'} first.`
              : 'Choose a picture first.'
        error.hidden = false
        return
      }
      finish({ src, aspect: await imageAspect(src) })
    })
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      finish(null)
    })
    // Keys typed in the dialog are not shortcuts for the page underneath.
    dialog.addEventListener('keydown', (e) => e.stopPropagation())

    dialog.showModal()
    setMode('draw')
  })
}

/** Load a PNG or JPG, scale it down, make its white background transparent and trim it. */
async function imageFileToSignature(file: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('not an image')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 1200 / img.naturalWidth, 600 / img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * scale))
    c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const cx = c.getContext('2d', { willReadFrequently: true })!
    cx.drawImage(img, 0, 0, c.width, c.height)
    const data = cx.getImageData(0, 0, c.width, c.height)
    whiteToTransparent(data.data)
    cx.putImageData(data, 0, 0)
    const out = trimmed(c)
    if (!out) throw new Error('blank')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}
