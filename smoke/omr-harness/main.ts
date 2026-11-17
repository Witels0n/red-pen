// Test-only page: drives the real OMR worker in the browser for smoke/omr.spec.ts.
// Prints sheets with the real printer, renders them with pdf.js, pencils in answers on a canvas,
// optionally turns the page into a rotated JPEG "photo", and reads it with createOmrReader().
import {
  createOmrReader,
  layoutSheet,
  pdfPagesToImageData,
  photoToImageData,
  renderAnswerSheetsPdf,
  renderCoverSheetsPdf,
  SCAN_DPI,
  type SheetRead,
  type SheetSpec,
} from '../../src/shared/omr'

export interface HarnessCase {
  spec: SheetSpec
  /** Option index to fill per question (null leaves it blank), page 1 only. */
  answers: (number | null)[]
  /** Bubbled ID digits to fill. */
  idDigits?: string
  /** Turn the page into a JPEG photo rotated by this many degrees. Omit for a straight scan. */
  photoRotate?: number
}

const reader = createOmrReader()

function canvasOf(image: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  c.getContext('2d')!.putImageData(image, 0, 0)
  return c
}

async function run(c: HarnessCase): Promise<SheetRead & { millis: number }> {
  const pdf = await renderAnswerSheetsPdf([c.spec])
  const { image } = (await pdfPagesToImageData(pdf).next()).value!
  const g = layoutSheet(c.spec)[0]
  const s = SCAN_DPI / 72
  const canvas = canvasOf(image)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(40, 40, 48, 0.85)'
  const fill = (cx: number, cy: number, r: number) => {
    ctx.beginPath()
    ctx.arc(cx * s, cy * s, r * s * 0.92, 0, Math.PI * 2)
    ctx.fill()
  }
  g.questions.forEach((q, i) => {
    const a = c.answers[i]
    if (a !== null && a !== undefined) fill(q.bubbles[a].cx, q.bubbles[a].cy, q.bubbles[a].r)
  })
  g.idColumns.forEach((col, d) => {
    const b = col.bubbles[Number(c.idDigits?.[d] ?? 0)]
    fill(b.cx, b.cy, b.r)
  })

  let input: ImageData
  if (c.photoRotate === undefined) {
    input = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } else {
    // A photo: the page on a dark table, rotated, saved as a JPEG and decoded like an upload.
    const photo = document.createElement('canvas')
    photo.width = 1800
    photo.height = 2400
    const p = photo.getContext('2d')!
    p.fillStyle = '#4a4540'
    p.fillRect(0, 0, photo.width, photo.height)
    p.translate(photo.width / 2, photo.height / 2)
    p.rotate((c.photoRotate * Math.PI) / 180)
    const k = (photo.height * 0.88) / canvas.height
    p.drawImage(canvas, (-canvas.width * k) / 2, (-canvas.height * k) / 2, canvas.width * k, canvas.height * k)
    const blob = await new Promise<Blob>((resolve) => photo.toBlob((b) => resolve(b!), 'image/jpeg', 0.8))
    input = await photoToImageData(blob)
  }
  const started = performance.now()
  const read = await reader.read(input, { templates: [c.spec] })
  return { ...read, millis: performance.now() - started }
}

async function identifyCover(learnerId: string) {
  const pdf = await renderCoverSheetsPdf([{ learnerId, learnerName: 'Test Learner' }])
  const { image } = (await pdfPagesToImageData(pdf).next()).value!
  return reader.identify(image)
}

declare global {
  interface Window {
    omrHarness: { run: typeof run; identifyCover: typeof identifyCover }
  }
}

window.omrHarness = { run, identifyCover }
document.getElementById('status')!.textContent = 'Ready'
