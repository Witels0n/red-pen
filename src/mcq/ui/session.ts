// Scans for this visit only: each page is read in the OMR worker, and a straightened copy is kept
// in memory (as a JPEG) for Review crops and marked answer sheets. Nothing here is ever saved.
import {
  A4_HEIGHT,
  A4_WIDTH,
  createOmrReader,
  isReadableUpload,
  pdfPagesToImageData,
  photoToImageData,
  rectifyRegion,
  type OmrReader,
  type SheetRead,
  type SheetSpec,
} from '../../shared/omr'
import { newId, type ScannedPage, type StoredRead } from '../core/model'

/** Pixels per layout point of the kept copy: about 144 dpi, plenty for a crop or a print. */
export const KEPT_SCALE = 2

const images = new Map<string, Blob>()

export function scanImage(pageId: string): Blob | undefined {
  return images.get(pageId)
}

export function forgetScan(pageId: string): void {
  images.delete(pageId)
}

export function forgetAllScans(): void {
  images.clear()
}

export function heldScanCount(pageIds: readonly string[]): number {
  return pageIds.filter((id) => images.has(id)).length
}

let reader: OmrReader | null = null

function omr(): OmrReader {
  return (reader ??= createOmrReader())
}

function stored(read: SheetRead): StoredRead {
  return {
    ok: read.ok,
    ...(read.kind ? { kind: read.kind } : {}),
    ...(read.identity.learnerId ? { learnerId: read.identity.learnerId } : {}),
    idSource: read.identity.source,
    idConfidence: read.idConfidence,
    ...(read.assessmentCode ? { assessmentCode: read.assessmentCode } : {}),
    ...(read.version ? { version: read.version } : {}),
    page: read.page,
    pages: read.pages,
    questionStart: read.questionStart,
    answers: read.answers,
    confidences: read.confidences,
    flags: read.flags,
    problems: read.problems,
  }
}

function failedRead(problem: string): StoredRead {
  return {
    ok: false,
    idSource: 'qr',
    idConfidence: 0,
    page: 1,
    pages: 1,
    questionStart: 0,
    answers: [],
    confidences: [],
    flags: [],
    problems: [problem],
  }
}

async function keepStraightened(image: ImageData, homography: number[]): Promise<Blob | undefined> {
  const flat = rectifyRegion(image, homography, { x: 0, y: 0, w: A4_WIDTH, h: A4_HEIGHT }, KEPT_SCALE)
  const canvas = document.createElement('canvas')
  canvas.width = flat.width
  canvas.height = flat.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.putImageData(new ImageData(flat.data as ImageDataArray, flat.width, flat.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  canvas.width = canvas.height = 0
  return blob ?? undefined
}

export interface ReadProgress {
  file: string
  /** Pages done so far, over all files. */
  done: number
  /** Pages known so far (grows as each PDF is opened). */
  total: number
}

export interface ReadJob {
  cancel(): void
  /** Resolves when every page is read or the job is cancelled. */
  finished: Promise<{ cancelled: boolean }>
}

/**
 * Reads every page of every file, calling `onPage` with each result as soon as it is ready.
 * Files the reader cannot take are reported as unreadable pages.
 */
export function readFiles(
  files: readonly File[],
  templates: SheetSpec[],
  onPage: (page: ScannedPage) => void,
  onProgress: (p: ReadProgress) => void,
): ReadJob {
  let cancelled = false
  const progress: ReadProgress = { file: '', done: 0, total: files.length }

  const add = (fileName: string, filePage: number, read: StoredRead, jpeg?: Blob) => {
    const page: ScannedPage = { id: newId(), fileName, filePage, read, decisions: {}, addedAt: Date.now() }
    if (jpeg) images.set(page.id, jpeg)
    onPage(page)
  }

  const readOne = async (fileName: string, filePage: number, image: ImageData) => {
    const copy = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    const read = await omr().read(image, { templates })
    const jpeg = read.ok && read.homography ? await keepStraightened(copy, read.homography) : undefined
    if (!cancelled) add(fileName, filePage, stored(read), jpeg)
  }

  const run = async () => {
    for (const file of files) {
      if (cancelled) break
      progress.file = file.name
      onProgress({ ...progress })
      const kind = isReadableUpload(file)
      try {
        if (kind === 'pdf') {
          const bytes = new Uint8Array(await file.arrayBuffer())
          let first = true
          for await (const { page, pages, image } of pdfPagesToImageData(bytes)) {
            if (cancelled) break
            if (first) {
              progress.total += pages - 1
              first = false
            }
            await readOne(file.name, page, image)
            progress.done++
            onProgress({ ...progress })
          }
        } else if (kind === 'photo') {
          await readOne(file.name, 1, await photoToImageData(file))
          progress.done++
        } else {
          add(file.name, 1, failedRead('This is not a PDF or a photo.'))
          progress.done++
        }
      } catch (error) {
        if (cancelled) break
        const message = error instanceof Error ? error.message : String(error)
        add(file.name, 1, failedRead(kind === 'pdf' ? `This PDF could not be opened (${message}).` : message))
        progress.done++
      }
      onProgress({ ...progress })
    }
    return { cancelled }
  }

  return {
    cancel() {
      cancelled = true
      // Stops a read in progress straight away; a new worker starts with the next job.
      reader?.terminate()
      reader = null
    },
    finished: run(),
  }
}

/** Draws part of a kept scan (a layout-space rectangle) onto a new canvas, `width` CSS pixels wide. */
export async function cropScan(
  pageId: string,
  rect: { x: number; y: number; w: number; h: number },
  width: number,
): Promise<HTMLCanvasElement | null> {
  const blob = images.get(pageId)
  if (!blob) return null
  const bitmap = await createImageBitmap(blob)
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round((width * ratio * rect.h) / rect.w)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    bitmap,
    rect.x * KEPT_SCALE,
    rect.y * KEPT_SCALE,
    rect.w * KEPT_SCALE,
    rect.h * KEPT_SCALE,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()
  return canvas
}
