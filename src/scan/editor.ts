// The page editor: four corner handles to crop and straighten, quarter turns and the look.
import { byId } from '../shared/pdf/tool-page'
import { FILTERS, type ScanFilter } from './filters'
import type { ScanEngine } from './engine'
import { addTurn, clampQuad, FULL_QUAD, isConvexQuad, orderCorners, type Quad } from './geometry'
import type { PageLook } from './pipeline'

export interface EditRequest {
  title: string
  preview: Blob
  look: PageLook
  /** The suggested corners found when the photo was added, if any. */
  detected: Quad | null
}

export interface EditResult {
  look: PageLook
  /** The teacher asked for this look (filter) on every page. */
  filterForAll: boolean
}

const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left']
const RESULT_SIDE = 640

export interface PageEditor {
  open(request: EditRequest): Promise<EditResult | null>
}

export function createEditor(engine: ScanEngine): PageEditor {
  const dialog = byId<HTMLDialogElement>('editor')
  const title = byId('editor-title')
  const crop = byId('crop')
  const image = byId<HTMLImageElement>('crop-image')
  const outline = byId('crop-outline') as unknown as SVGPolygonElement
  const shade = byId('crop-shade') as unknown as SVGPathElement
  const note = byId('editor-note')
  const result = byId<HTMLCanvasElement>('result')
  const filterChoices = byId('filter-choices')
  const detectButton = byId<HTMLButtonElement>('detect')
  const doneButton = byId<HTMLButtonElement>('editor-done')

  let request: EditRequest | null = null
  let look: PageLook = { corners: FULL_QUAD, turns: 0, filter: 'original' }
  let filterForAll = false
  let finish: ((r: EditResult | null) => void) | null = null
  let previewUrl = ''
  let resultTimer = 0
  let resultVersion = 0

  for (const f of FILTERS) {
    const label = document.createElement('label')
    label.className = 'filter-choice'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'filter'
    input.value = f.value
    label.append(input, document.createTextNode(f.label))
    filterChoices.append(label)
  }

  const handles = CORNER_NAMES.map((name, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'handle'
    b.dataset.corner = String(i)
    b.setAttribute('aria-label', `Move the ${name} corner (arrow keys)`)
    crop.append(b)
    return b
  })

  function drawCorners(): void {
    const q = look.corners
    q.forEach((p, i) => {
      handles[i].style.left = `${p.x * 100}%`
      handles[i].style.top = `${p.y * 100}%`
    })
    const pts = q.map((p) => `${p.x},${p.y}`).join(' ')
    outline.setAttribute('points', pts)
    shade.setAttribute('d', `M0,0H1V1H0Z M${q.map((p) => `${p.x},${p.y}`).join(' L')}Z`)
    const ok = isConvexQuad(q)
    crop.classList.toggle('bad', !ok)
    doneButton.disabled = !ok
    note.textContent = ok
      ? filterForAll
        ? 'Every page gets this look when you choose Done.'
        : ''
      : 'The corners cross over. Move them onto the corners of the page.'
  }

  function syncFilter(): void {
    for (const input of filterChoices.querySelectorAll<HTMLInputElement>('input'))
      input.checked = input.value === look.filter
  }

  /** Redraws the finished page a moment after the last change. */
  function scheduleResult(): void {
    clearTimeout(resultTimer)
    resultTimer = window.setTimeout(() => void drawResult(), 150)
  }

  async function drawResult(): Promise<void> {
    if (!request || !isConvexQuad(look.corners)) return
    const version = ++resultVersion
    try {
      const img = await engine.thumb(request.preview, { ...look, corners: look.corners }, RESULT_SIDE)
      if (version !== resultVersion) return
      result.width = img.width
      result.height = img.height
      result
        .getContext('2d')
        ?.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    } catch {
      // The finished page is drawn again after the next change.
    }
  }

  function setCorners(q: Quad): void {
    look = { ...look, corners: q }
    drawCorners()
    scheduleResult()
  }

  function close(r: EditResult | null): void {
    const done = finish
    finish = null
    request = null
    if (dialog.open) dialog.close()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = ''
    done?.(r)
  }

  // Dragging a corner.
  let dragging: { index: number; pointerId: number } | null = null
  const pointAt = (e: PointerEvent) => {
    const r = image.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  crop.addEventListener('pointerdown', (e) => {
    const handle = (e.target as Element).closest<HTMLButtonElement>('.handle')
    if (!handle || dragging) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('active')
    dragging = { index: Number(handle.dataset.corner), pointerId: e.pointerId }
  })
  crop.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return
    const q = [...look.corners] as Quad
    q[dragging.index] = pointAt(e)
    setCorners(clampQuad(q))
  })
  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return
    handles[dragging.index].classList.remove('active')
    dragging = null
    // A corner dragged past its neighbour: put the corners back in order.
    const ordered = orderCorners(look.corners)
    if (isConvexQuad(ordered)) setCorners(ordered)
  }
  crop.addEventListener('pointerup', endDrag)
  crop.addEventListener('pointercancel', endDrag)

  crop.addEventListener('keydown', (e) => {
    const handle = (e.target as Element).closest<HTMLButtonElement>('.handle')
    if (!handle) return
    const step = e.shiftKey ? 0.02 : 0.005
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const i = Number(handle.dataset.corner)
    const q = [...look.corners] as Quad
    q[i] = { x: q[i].x + d[0], y: q[i].y + d[1] }
    setCorners(clampQuad(q))
  })

  filterChoices.addEventListener('change', (e) => {
    look = { ...look, filter: (e.target as HTMLInputElement).value as ScanFilter }
    scheduleResult()
  })
  byId('turn-left').addEventListener('click', () => {
    look = { ...look, turns: addTurn(look.turns, -1) }
    scheduleResult()
  })
  byId('turn-right').addEventListener('click', () => {
    look = { ...look, turns: addTurn(look.turns, 1) }
    scheduleResult()
  })
  byId('whole-photo').addEventListener('click', () => setCorners(FULL_QUAD))
  detectButton.addEventListener('click', () => {
    if (request?.detected) setCorners(request.detected)
  })
  byId('look-all').addEventListener('click', () => {
    filterForAll = true
    drawCorners()
  })
  byId('editor-cancel').addEventListener('click', () => close(null))
  doneButton.addEventListener('click', () => close({ look, filterForAll }))
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    close(null)
  })

  return {
    open(req) {
      if (finish) close(null)
      request = req
      look = { ...req.look, corners: [...req.look.corners] as Quad }
      filterForAll = false
      title.textContent = req.title
      detectButton.disabled = !req.detected
      detectButton.title = req.detected ? '' : 'No page stood out from the background in this photo.'
      previewUrl = URL.createObjectURL(req.preview)
      image.src = previewUrl
      syncFilter()
      drawCorners()
      result.width = result.height = 1
      dialog.showModal()
      void drawResult()
      return new Promise((resolve) => (finish = resolve))
    },
  }
}
