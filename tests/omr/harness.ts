// Synthetic test harness for the sheet reader: print a sheet with the real printer, rasterise it
// with pdf.js (legacy build, @napi-rs/canvas), fill bubbles with pencil-like marks, then distort it
// like a copier or a phone camera would. Node only; never part of the site.
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { homographyFrom, applyHomography, invertHomography, type Point } from '../../src/shared/omr/homography'
import type { RgbaImage } from '../../src/shared/omr/image'
import type { Bubble, SheetGeometry } from '../../src/shared/omr/types'

const FONTS = resolve(import.meta.dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/'

export interface Page {
  image: RgbaImage
  /** Pixels per layout point. */
  scale: number
}

/** Renders every page of a PDF at `dpi`. */
export async function rasterise(pdf: Uint8Array, dpi = 200): Promise<Page[]> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(), standardFontDataUrl: FONTS, verbosity: 0 }).promise
  const pages: Page[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const scale = dpi / 72
    const vp = page.getViewport({ scale })
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // pdf.js types expect a DOM canvas; @napi-rs/canvas implements the same drawing API.
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: vp }).promise
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
    pages.push({ image: { width: id.width, height: id.height, data: new Uint8ClampedArray(id.data) }, scale })
  }
  await doc.loadingTask.destroy()
  return pages
}

/** Small seeded random number generator (mulberry32), so every run draws the same marks. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type MarkKind = 'fill' | 'partial' | 'light' | 'erased' | 'cross' | 'tick' | 'dot'

export interface Mark {
  bubble: Bubble
  kind: MarkKind
  /** 0 to 1: how dark the pencil is (1 is a soft, dark pencil pressed hard). */
  darkness?: number
}

function toCanvas(page: Page) {
  const canvas = createCanvas(page.image.width, page.image.height)
  const ctx = canvas.getContext('2d')
  const id = ctx.createImageData(page.image.width, page.image.height)
  id.data.set(page.image.data)
  ctx.putImageData(id, 0, 0)
  return { canvas, ctx }
}

function fromCtx(ctx: SKRSContext2D, w: number, h: number): RgbaImage {
  const id = ctx.getImageData(0, 0, w, h)
  return { width: w, height: h, data: new Uint8ClampedArray(id.data) }
}

/** A wobbly closed outline round (cx, cy): how a hand fills a circle. */
function blob(ctx: SKRSContext2D, cx: number, cy: number, r: number, rand: () => number, coverage = 1): void {
  const n = 18
  const start = rand() * Math.PI * 2
  ctx.beginPath()
  if (coverage < 1) ctx.moveTo(cx, cy)
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2 * coverage
    const rr = r * (0.86 + rand() * 0.2)
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i === 0 && coverage === 1) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

/** Pencil marks drawn on a rasterised page. Positions come from the layout, like the printer's. */
export function drawMarks(page: Page, marks: Mark[], seed: number, strays = 0, geometry?: SheetGeometry): Page {
  const rand = rng(seed)
  const { canvas, ctx } = toCanvas(page)
  const s = page.scale
  for (const m of marks) {
    const cx = (m.bubble.cx + (rand() - 0.5) * 1.2) * s
    const cy = (m.bubble.cy + (rand() - 0.5) * 1.2) * s
    const r = m.bubble.r * s
    const dark = m.darkness ?? 0.85
    const pencil = (alpha: number) => `rgba(45, 45, 52, ${alpha})`
    switch (m.kind) {
      case 'fill':
        ctx.fillStyle = pencil(dark)
        blob(ctx, cx, cy, r * 0.98, rand)
        // Graphite texture: a few lighter strokes.
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth = 0.6 * s
        for (let i = 0; i < 4; i++) {
          ctx.beginPath()
          ctx.moveTo(cx - r * 0.7, cy - r * 0.6 + i * r * 0.4)
          ctx.lineTo(cx + r * 0.7, cy - r * 0.5 + i * r * 0.4)
          ctx.stroke()
        }
        break
      case 'partial':
        ctx.fillStyle = pencil(dark)
        blob(ctx, cx, cy, r * 0.95, rand, 0.65)
        break
      case 'light':
        ctx.fillStyle = pencil(dark * 0.38)
        blob(ctx, cx, cy, r * 0.95, rand)
        break
      case 'erased':
        ctx.fillStyle = pencil(0.14)
        blob(ctx, cx, cy, r * 1.05, rand)
        break
      case 'cross':
        // A filled answer that was then crossed out.
        ctx.fillStyle = pencil(dark)
        blob(ctx, cx, cy, r * 0.98, rand)
        ctx.strokeStyle = pencil(0.95)
        ctx.lineWidth = 1.3 * s
        ctx.beginPath()
        ctx.moveTo(cx - r * 1.5, cy - r * 1.5)
        ctx.lineTo(cx + r * 1.5, cy + r * 1.5)
        ctx.moveTo(cx + r * 1.5, cy - r * 1.5)
        ctx.lineTo(cx - r * 1.5, cy + r * 1.5)
        ctx.stroke()
        break
      case 'tick':
        // A tick through an empty bubble instead of filling it.
        ctx.strokeStyle = pencil(dark)
        ctx.lineWidth = 1.1 * s
        ctx.beginPath()
        ctx.moveTo(cx - r * 0.8, cy)
        ctx.lineTo(cx - r * 0.2, cy + r * 0.7)
        ctx.lineTo(cx + r * 0.9, cy - r * 0.9)
        ctx.stroke()
        break
      case 'dot':
        ctx.fillStyle = pencil(dark)
        blob(ctx, cx, cy, r * 0.3, rand)
        break
    }
  }
  if (strays > 0 && geometry) {
    // Stray marks between columns and next to question numbers, never on bubbles.
    ctx.strokeStyle = 'rgba(40,40,48,0.8)'
    ctx.lineWidth = 0.8 * s
    for (let i = 0; i < strays; i++) {
      const q = geometry.questions[Math.floor(rand() * geometry.questions.length)]
      const last = q.bubbles[q.bubbles.length - 1]
      const x = (last.cx + last.r + 4 + rand() * 20) * s
      const y = (last.cy + (rand() - 0.5) * 6) * s
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k++) ctx.lineTo(x + (rand() - 0.3) * 18 * s, y + (rand() - 0.5) * 6 * s)
      ctx.stroke()
    }
  }
  return { image: fromCtx(ctx, canvas.width, canvas.height), scale: page.scale }
}

// ---- Distortions, all on plain RGBA buffers ----

export interface Placement {
  /** Output image size. */
  width: number
  height: number
  /** Where the page's corners land: top left, top right, bottom right, bottom left. */
  corners: Point[]
  /** The table under the page. */
  background?: [number, number, number]
}

/** Places a page in a new image with a perspective transform (rotation, scale, keystone, offset). */
export function place(src: RgbaImage, p: Placement): RgbaImage {
  const srcCorners = [
    { x: 0, y: 0 },
    { x: src.width, y: 0 },
    { x: src.width, y: src.height },
    { x: 0, y: src.height },
  ]
  const toOut = homographyFrom(srcCorners, p.corners)
  const back = invertHomography(toOut)
  const out = new Uint8ClampedArray(p.width * p.height * 4)
  const [br, bg, bb] = p.background ?? [90, 84, 76]
  const sw = src.width
  const d = src.data
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const q = applyHomography(back, x + 0.5, y + 0.5)
      const o = (y * p.width + x) * 4
      const sx = q.x - 0.5
      const sy = q.y - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      if (x0 < 0 || y0 < 0 || x0 >= src.width - 1 || y0 >= src.height - 1) {
        out[o] = br
        out[o + 1] = bg
        out[o + 2] = bb
        out[o + 3] = 255
        continue
      }
      const fx = sx - x0
      const fy = sy - y0
      const i = (y0 * sw + x0) * 4
      for (let c = 0; c < 3; c++) {
        const a = d[i + c] + (d[i + 4 + c] - d[i + c]) * fx
        const b = d[i + sw * 4 + c] + (d[i + sw * 4 + 4 + c] - d[i + sw * 4 + c]) * fx
        out[o + c] = a + (b - a) * fy
      }
      out[o + 3] = 255
    }
  }
  return { width: p.width, height: p.height, data: out }
}

export interface Camera {
  /** Output size. */
  width: number
  height: number
  /** Degrees, clockwise. */
  rotate?: number
  /** Fraction of the output's shorter side the page's longer side covers (about 0.9 fills it). */
  fill?: number
  /** Top edge shorter than the bottom by this fraction (phone tilted back). */
  keystone?: number
  /** Left edge shorter than the right by this fraction. */
  sideTilt?: number
  shift?: Point
  background?: [number, number, number]
}

/** A phone-style view of the page: rotation, perspective and placement in a larger frame. */
export function camera(src: RgbaImage, c: Camera): RgbaImage {
  const aspect = src.width / src.height
  const landscape = c.width > c.height
  const fill = c.fill ?? 0.9
  const pageH = (landscape ? c.width : c.height) * fill
  const pageW = pageH * aspect
  const k = c.keystone ?? 0
  const t = c.sideTilt ?? 0
  // Page corners around the origin, then keystone, then rotation, then into the frame.
  const raw: Point[] = [
    { x: (-pageW / 2) * (1 - k), y: (-pageH / 2) * (1 - t) },
    { x: (pageW / 2) * (1 - k), y: (-pageH / 2) * (1 + t) },
    { x: pageW / 2, y: (pageH / 2) * (1 + t) },
    { x: -pageW / 2, y: (pageH / 2) * (1 - t) },
  ]
  const a = (((c.rotate ?? 0) + (landscape ? 90 : 0)) * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = c.width / 2 + (c.shift?.x ?? 0)
  const cy = c.height / 2 + (c.shift?.y ?? 0)
  const corners = raw.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }))
  return place(src, { width: c.width, height: c.height, corners, background: c.background })
}

/**
 * Non-linear warps a four-point transform cannot undo: barrel lens distortion (k > 0) and a page
 * that bows up in the middle (curl, in pixels of sideways and downward bulge at the centre).
 */
export function bend(src: RgbaImage, k: number, curl = 0): RgbaImage {
  const { width: w, height: h } = src
  const out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2
  const cy = h / 2
  const norm = Math.hypot(cx, cy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / norm
      const dy = (y - cy) / norm
      const f = 1 + k * (dx * dx + dy * dy)
      // Curl: the middle of the page rises towards the camera, pushing content outwards in y.
      const lift = curl * Math.sin((Math.PI * x) / w)
      const sx = cx + dx * norm * f
      const sy = cy + dy * norm * f - lift * (dy * 2)
      const o = (y * w + x) * 4
      const ix = Math.round(sx)
      const iy = Math.round(sy)
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
        out[o] = 90
        out[o + 1] = 84
        out[o + 2] = 76
      } else {
        const i = (iy * w + ix) * 4
        out[o] = src.data[i]
        out[o + 1] = src.data[i + 1]
        out[o + 2] = src.data[i + 2]
      }
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

/** Gaussian-like blur: three box blurs per axis. */
export function blur(src: RgbaImage, sigma: number): RgbaImage {
  if (sigma <= 0) return src
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5))
  let data = new Uint8ClampedArray(src.data)
  const { width: w, height: h } = src
  const pass = (input: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(input.length)
    const len = horizontal ? w : h
    const lines = horizontal ? h : w
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0
        const at = (i: number) => {
          const j = Math.min(len - 1, Math.max(0, i))
          return input[(horizontal ? line * w + j : j * w + line) * 4 + c]
        }
        for (let i = -r; i <= r; i++) acc += at(i)
        for (let i = 0; i < len; i++) {
          out[(horizontal ? line * w + i : i * w + line) * 4 + c] = acc / (2 * r + 1)
          acc += at(i + r + 1) - at(i - r)
        }
      }
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255
    return out
  }
  for (let k = 0; k < 3; k++) data = pass(pass(data, true), false)
  return { width: w, height: h, data }
}

export function noise(src: RgbaImage, sigma: number, seed: number): RgbaImage {
  const rand = rng(seed)
  const data = new Uint8ClampedArray(src.data)
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand()) * sigma
    data[i] += n
    data[i + 1] += n
    data[i + 2] += n
  }
  return { ...src, data }
}

/** Darkens towards one side (a hand or phone shadow); `hard` makes a sharp-edged band instead of a ramp. */
export function shadow(src: RgbaImage, strength: number, angle = 30, hard = false): RgbaImage {
  const data = new Uint8ClampedArray(src.data)
  const a = (angle * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const max = Math.abs(dx * src.width) + Math.abs(dy * src.height)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      let t = (x * dx + y * dy) / max
      t = Math.min(1, Math.max(0, t))
      const f = hard ? (t > 0.55 ? 1 - strength : 1) : 1 - strength * t
      const i = (y * src.width + x) * 4
      data[i] *= f
      data[i + 1] *= f
      data[i + 2] *= f
    }
  }
  return { ...src, data }
}

/** Squeezes the brightness range into [lo, hi]. */
export function contrast(src: RgbaImage, lo: number, hi: number): RgbaImage {
  const data = new Uint8ClampedArray(src.data)
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = lo + (data[i + c] * (hi - lo)) / 255
  }
  return { ...src, data }
}

/** Warm indoor light: blue drops more than red. */
export function tint(src: RgbaImage, r: number, g: number, b: number): RgbaImage {
  const data = new Uint8ClampedArray(src.data)
  for (let i = 0; i < data.length; i += 4) {
    data[i] *= r
    data[i + 1] *= g
    data[i + 2] *= b
  }
  return { ...src, data }
}

/** Round-trips through JPEG at the given quality (0 to 100). */
export async function jpeg(src: RgbaImage, quality: number): Promise<RgbaImage> {
  const canvas = createCanvas(src.width, src.height)
  const ctx = canvas.getContext('2d')
  const id = ctx.createImageData(src.width, src.height)
  id.data.set(src.data)
  ctx.putImageData(id, 0, 0)
  const bytes = await canvas.encode('jpeg', quality)
  const img = await loadImage(bytes)
  const back = createCanvas(src.width, src.height)
  const bctx = back.getContext('2d')
  bctx.drawImage(img, 0, 0)
  return fromCtx(bctx, src.width, src.height)
}

/** Writes an image to a PNG file, for looking at a failing case by eye. */
export async function savePng(src: RgbaImage, path: string): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const canvas = createCanvas(src.width, src.height)
  const ctx = canvas.getContext('2d')
  const id = ctx.createImageData(src.width, src.height)
  id.data.set(src.data)
  ctx.putImageData(id, 0, 0)
  writeFileSync(path, await canvas.encode('png'))
}
