// Browser-side export: draws the code on a canvas for PNG, and saves or copies files.
import type { QrMatrix } from './matrix'
import { qrGeometry, safeColour, type QrLogo, type QrStyle } from './render'

/** Loads an image from a data: or blob: URL. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The image could not be read.'))
    img.src = src
  })
}

/**
 * Draws the code at exactly pixelSize by pixelSize, using the same geometry as the SVG,
 * so the PNG and the preview always match. logoImage must already be loaded.
 */
export function drawToCanvas(
  matrix: QrMatrix,
  style: QrStyle,
  pixelSize: number,
  logo?: { logo: QrLogo; image: HTMLImageElement },
): HTMLCanvasElement {
  const g = qrGeometry(matrix, style, logo?.logo)
  const canvas = document.createElement('canvas')
  canvas.width = pixelSize
  canvas.height = pixelSize
  const ctx = canvas.getContext('2d')!
  const scale = pixelSize / g.view
  ctx.fillStyle = safeColour(style.background, '#ffffff')
  ctx.fillRect(0, 0, pixelSize, pixelSize)
  ctx.save()
  ctx.scale(scale, scale)
  ctx.fillStyle = safeColour(style.foreground, '#000000')
  ctx.fill(new Path2D(g.path), 'nonzero')
  if (g.padding) {
    ctx.fillStyle = safeColour(style.background, '#ffffff')
    ctx.beginPath()
    ctx.roundRect(g.padding.x, g.padding.y, g.padding.w, g.padding.h, 1)
    ctx.fill()
  }
  ctx.restore()
  if (g.logo && logo) {
    const l = g.logo
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(logo.image, l.x * scale, l.y * scale, l.w * scale, l.h * scale)
  }
  return canvas
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be made.'))), 'image/png'),
  )
}

/** Saves a file with the browser's normal download, without any network request. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** True when this browser can put an image on the clipboard. */
export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/** Copies a PNG to the clipboard. The blob is passed as a promise so Safari keeps the user gesture. */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** Reads a chosen file into a data: URI, entirely in the browser. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}
