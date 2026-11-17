// Draws the wheel (or the ticker for long lists) on a canvas and animates it to a chosen entry.
import { TAU, edgesBetween, landingRotation, sliceFontSize, spinAt, tickerAt, tickerLanding } from './spin'

export type DrawStyle = 'wheel' | 'ticker'

/** Soft colours with dark text: they read well on a projector and in light or dark mode. */
const SLICE_COLOURS = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']
const SLICE_TEXT = '#1b2330'
const TICKER_ROWS = 7

export interface SpinOptions {
  reducedMotion: boolean
  /** A whole extra turn count and where in the slice to stop (0 to 1), chosen by the caller. */
  turns: number
  offset: number
  onTick: () => void
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Fits text into `max` pixels, shortening it with an ellipsis if needed. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, Math.max(1, lo))}…`
}

function sliceColour(i: number, count: number): string {
  // Avoid the last slice matching the first where the wheel wraps around.
  let c = i % SLICE_COLOURS.length
  if (count > 1 && i === count - 1 && c === 0) c = 3
  return SLICE_COLOURS[c]
}

export class WheelView {
  private labels: string[] = []
  private style: DrawStyle = 'wheel'
  private rotation = 0
  private position = 0
  private winner: number | null = null
  private size = 0
  private frame = 0
  spinning = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    new ResizeObserver(() => this.resize()).observe(canvas)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw())
    this.resize()
  }

  setEntries(labels: readonly string[], style: DrawStyle): void {
    this.labels = [...labels]
    this.style = style
    this.winner = null
    this.draw()
  }

  /** Dims every slice but the winner, or clears the highlight with null. */
  highlight(index: number | null): void {
    this.winner = index
    this.draw()
  }

  /** Spins so `index` ends under the pointer (or in the middle row of the ticker). */
  spinTo(index: number, options: SpinOptions): Promise<void> {
    const count = this.labels.length
    cancelAnimationFrame(this.frame)
    this.winner = null
    this.spinning = true
    const wheel = this.style === 'wheel'
    const from = wheel ? this.rotation : this.position
    const to = wheel
      ? landingRotation(this.rotation, index, count, {
          turns: options.reducedMotion ? 1 : options.turns,
          offset: options.offset,
        })
      : tickerLanding(this.position, index, count, options.reducedMotion ? 1 : Math.max(2, Math.ceil(36 / count)))
    const duration = options.reducedMotion ? 900 : 4200 + options.offset * 1200
    const start = performance.now()
    let last = from

    return new Promise((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const value = spinAt(from, to, t)
        const passed = wheel ? edgesBetween(last, value, count) : Math.abs(Math.round(value) - Math.round(last))
        if (passed > 0 && count > 1) options.onTick()
        last = value
        if (wheel) this.rotation = value
        else this.position = value
        this.draw()
        if (t < 1) {
          this.frame = requestAnimationFrame(step)
        } else {
          this.spinning = false
          // Keep the numbers small so many spins never lose precision.
          if (wheel) this.rotation %= TAU
          else this.position = tickerAt(this.position, count)
          resolve()
        }
      }
      this.frame = requestAnimationFrame(step)
    })
  }

  private resize(): void {
    const css = this.canvas.clientWidth
    if (css === 0) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    this.size = css
    this.canvas.width = Math.round(css * dpr)
    this.canvas.height = Math.round(css * dpr)
    this.draw()
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx || this.size === 0) return
    const dpr = this.canvas.width / this.size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.size, this.size)
    if (this.labels.length === 0) return
    if (this.style === 'wheel') this.drawWheel(ctx)
    else this.drawTicker(ctx)
  }

  private drawWheel(ctx: CanvasRenderingContext2D): void {
    const count = this.labels.length
    const size = this.size
    const c = size / 2
    const r = c - Math.max(4, size * 0.02)
    const slice = TAU / count
    const font = sliceFontSize(r, count, 9, Math.max(14, r * 0.12))
    const edge = token('--edge', '#1b2330')
    const family = token('--font-body', 'sans-serif')

    for (let i = 0; i < count; i++) {
      const a0 = -Math.PI / 2 + this.rotation + i * slice
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.arc(c, c, r, a0, a0 + slice)
      ctx.closePath()
      ctx.fillStyle = sliceColour(i, count)
      ctx.fill()
      if (this.winner !== null && this.winner !== i) {
        ctx.fillStyle = 'rgba(20, 24, 32, 0.55)'
        ctx.fill()
      }
      if (count > 1) {
        ctx.strokeStyle = 'rgba(27, 35, 48, 0.35)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      ctx.save()
      ctx.translate(c, c)
      ctx.rotate(a0 + slice / 2)
      ctx.fillStyle = this.winner !== null && this.winner !== i ? 'rgba(27, 35, 48, 0.55)' : SLICE_TEXT
      // Long names get smaller text first (down to just over half size), and are shortened only after that.
      const room = r * 0.68
      ctx.font = `700 ${font}px ${family}`
      const width = ctx.measureText(this.labels[i]).width
      if (width > room) ctx.font = `700 ${Math.max(9, font * 0.55, (font * room) / width)}px ${family}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(fit(ctx, this.labels[i], room), r - Math.max(10, r * 0.05), 0)
      ctx.restore()
    }

    // Rim and hub.
    ctx.beginPath()
    ctx.arc(c, c, r, 0, TAU)
    ctx.lineWidth = Math.max(3, size * 0.012)
    ctx.strokeStyle = edge
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c, c, r * 0.12, 0, TAU)
    ctx.fillStyle = token('--surface', '#ffffff')
    ctx.fill()
    ctx.lineWidth = Math.max(2, size * 0.008)
    ctx.stroke()
  }

  private drawTicker(ctx: CanvasRenderingContext2D): void {
    const count = this.labels.length
    const size = this.size
    const rowH = size / TICKER_ROWS
    const middle = size / 2
    const base = Math.round(this.position)
    const font = Math.min(rowH * 0.55, 44)
    const text = token('--text', '#1b2330')

    ctx.save()
    ctx.beginPath()
    ctx.roundRect(0, 0, size, size, 16)
    ctx.fillStyle = token('--surface', '#ffffff')
    ctx.fill()
    ctx.clip()

    // The middle row, where the winner stops.
    ctx.fillStyle = sliceColour(this.winner ?? tickerAt(this.position, count), count)
    ctx.fillRect(0, middle - rowH / 2, size, rowH)

    ctx.font = `700 ${font}px ${token('--font-body', 'sans-serif')}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const half = Math.ceil(TICKER_ROWS / 2)
    for (let d = -half; d <= half; d++) {
      const p = base + d
      const y = middle + (p - this.position) * rowH
      const index = ((p % count) + count) % count
      const away = Math.abs(y - middle) / (size / 2)
      const inMiddle = Math.abs(y - middle) < rowH / 2
      ctx.globalAlpha = Math.max(0.15, 1 - away * 1.1)
      ctx.fillStyle = inMiddle ? SLICE_TEXT : text
      ctx.fillText(fit(ctx, this.labels[index], size * 0.86), size / 2, y)
    }
    ctx.globalAlpha = 1
    ctx.restore()

    ctx.strokeStyle = token('--red', '#d3212d')
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, middle - rowH / 2)
    ctx.lineTo(size, middle - rowH / 2)
    ctx.moveTo(0, middle + rowH / 2)
    ctx.lineTo(size, middle + rowH / 2)
    ctx.stroke()
  }
}
