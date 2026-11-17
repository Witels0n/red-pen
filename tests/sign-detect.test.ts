import { describe, expect, it } from 'vitest'
import { binarise, detectBoxes, otsuThreshold, withoutCovered, type DetectedBox } from '../src/sign/detect'

// Synthetic binary "scans" (1 = ink) of an A4 page at 2 pixels per point.
const SCALE = 2
const W = 595 * SCALE
const H = 842 * SCALE

class Page {
  bin = new Uint8Array(W * H)
  /** Filled rectangle in points. */
  fill(x: number, y: number, w: number, h: number): this {
    for (let yy = Math.round(y * SCALE); yy < Math.round((y + h) * SCALE); yy++)
      for (let xx = Math.round(x * SCALE); xx < Math.round((x + w) * SCALE); xx++) this.bin[yy * W + xx] = 1
    return this
  }
  hline(x: number, y: number, len: number, thickness = 1): this {
    return this.fill(x, y, len, thickness)
  }
  rect(x: number, y: number, w: number, h: number, t = 1): this {
    return this.fill(x, y, w, t).fill(x, y + h - t, w, t).fill(x, y, t, h).fill(x + w - t, y, t, h)
  }
  /** A word of text-like strokes: short verticals, bowls and bars, about 12 pt high. */
  word(x: number, y: number, letters: number): this {
    for (let i = 0; i < letters; i++) {
      const lx = x + i * 7
      this.fill(lx, y, 1, 9) // stem
      this.fill(lx + 1, y + 4, 3, 1) // bar
      if (i % 2) this.fill(lx + 4, y + 4, 1, 5) // second stem, like an "n"
    }
    return this
  }
  /** A ring like the letter "O": centre, radii and stroke in points. */
  ring(cx: number, cy: number, rx: number, ry: number, stroke: number): this {
    for (let y = Math.floor((cy - ry - stroke) * SCALE); y <= (cy + ry + stroke) * SCALE; y++)
      for (let x = Math.floor((cx - rx - stroke) * SCALE); x <= (cx + rx + stroke) * SCALE; x++) {
        const d = Math.hypot((x / SCALE - cx) / rx, (y / SCALE - cy) / ry)
        if (Math.abs(d - 1) * Math.min(rx, ry) <= stroke / 2) this.bin[y * W + x] = 1
      }
    return this
  }
  noise(count: number, seed = 1): this {
    let s = seed
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count; i++) this.bin[Math.floor(rand() * W * H)] = 1
    return this
  }
}

const detect = (p: Page) => detectBoxes(p.bin, W, H, SCALE)
const of = (boxes: DetectedBox[], kind: DetectedBox['kind']) => boxes.filter((b) => b.kind === kind)
const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol

describe('detectBoxes', () => {
  it('finds write-on-the-line fields and where they sit', () => {
    const p = new Page().word(60, 100, 5).hline(110, 108, 200).word(60, 140, 4).hline(100, 148, 120, 1.5)
    const lines = of(detect(p), 'line')
    expect(lines).toHaveLength(2)
    expect(near(lines[0].x, 110) && near(lines[0].y, 108) && near(lines[0].width, 200)).toBe(true)
    expect(near(lines[1].x, 100) && near(lines[1].width, 120)).toBe(true)
  })

  it('ignores underlined words, short dashes and full-width rules', () => {
    const p = new Page()
      .word(100, 200, 12).hline(98, 211, 90) // underlined words
      .hline(100, 260, 20) // a short dash
      .hline(20, 300, 560) // a rule across the page
    expect(of(detect(p), 'line')).toEqual([])
  })

  it('finds a text box and gives its blank interior', () => {
    const p = new Page().rect(100, 300, 250, 30).word(110, 310, 6)
    const boxes = of(detect(p), 'box')
    expect(boxes).toHaveLength(1)
    const [b] = boxes
    expect(near(b.x, 101) && near(b.y, 301) && near(b.width, 248) && near(b.height, 28)).toBe(true)
    // Its top and bottom edges are not reported as lines.
    expect(of(detect(p), 'line')).toEqual([])
  })

  it('finds every cell of a table, not the table or its row lines', () => {
    const p = new Page()
    const cols = [60, 200, 350, 500]
    const rows = [400, 425, 450, 475]
    for (const y of rows) p.hline(60, y, 441)
    for (const x of cols) p.fill(x, 400, 1, 76)
    p.word(70, 408, 4).word(210, 433, 6)
    const found = detect(p)
    expect(of(found, 'box')).toHaveLength(9)
    expect(of(found, 'line')).toEqual([])
  })

  it('finds small tick boxes, including one with a tick already in it', () => {
    const p = new Page().rect(60, 520, 10, 10).rect(160, 520, 12, 12, 1.5).rect(260, 520, 10, 10)
    p.fill(263, 524, 1, 3).fill(264, 526, 4, 1) // a rough tick inside the third box
    const ticks = of(detect(p), 'tick')
    expect(ticks).toHaveLength(3)
    expect(ticks.map((t) => Math.round(t.x)).sort((a, b) => a - b)).toEqual([61, 162, 261])
  })

  it('does not mistake round letters such as O, D or 0 for tick boxes', () => {
    const p = new Page()
    for (const [i, size] of [10, 14, 18, 24, 36].entries()) p.ring(80 + i * 80, 200, size * 0.36, size * 0.36, size * 0.09)
    p.ring(80, 300, 5, 6.5, 1.4) // a zero
    expect(detect(p)).toEqual([])
  })

  it('ignores the page border, a big frame, filled bars, text and noise', () => {
    const p = new Page()
      .rect(10, 10, 575, 822, 2) // page border
      .rect(40, 40, 515, 400) // frame around half the page
      .fill(60, 600, 300, 12) // solid black bar
      .word(60, 700, 30)
      .noise(4000)
    expect(detect(p)).toEqual([])
  })

  it('finds boxes and lines inside a bordered page, despite noise', () => {
    const p = new Page().rect(10, 10, 575, 822, 2).noise(3000, 7).rect(100, 650, 200, 24).hline(100, 750, 180).rect(400, 652, 10, 10)
    const found = detect(p)
    expect(found.map((b) => b.kind).sort()).toEqual(['box', 'line', 'tick'])
  })

  it('merges a doubled box edge into one box', () => {
    const p = new Page().rect(100, 300, 200, 30).rect(101.5, 301.5, 197, 27)
    expect(of(detect(p), 'box')).toHaveLength(1)
  })

  it('bridges small gaps in a scanned line', () => {
    const p = new Page()
    for (let x = 100; x < 300; x += 10) p.hline(x, 200, 9.5)
    expect(of(detect(p), 'line')).toHaveLength(1)
  })

  it('runs well under half a second on a busy A4 page at 2 px per point', () => {
    const p = new Page().rect(10, 10, 575, 822, 2).noise(20000)
    for (let i = 0; i < 25; i++) p.word(40, 40 + i * 30, 40).hline(330, 50 + i * 30, 200)
    const t = performance.now()
    detect(p)
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe('binarise', () => {
  it('separates ink from paper, treating transparent pixels as paper', () => {
    const rgba = new Uint8ClampedArray([250, 250, 250, 255, 20, 20, 20, 255, 0, 0, 0, 0, 60, 60, 60, 255])
    expect([...binarise(rgba, 4, 1)]).toEqual([0, 1, 0, 1])
  })

  it('Otsu picks a threshold between two populations', () => {
    const h = new Array(256).fill(0)
    h[30] = 100
    h[220] = 900
    const t = otsuThreshold(h, 1000)
    expect(t).toBeGreaterThanOrEqual(30)
    expect(t).toBeLessThan(220)
  })
})

describe('withoutCovered', () => {
  it('drops detected boxes that a real form field covers', () => {
    const boxes: DetectedBox[] = [
      { kind: 'box', x: 100, y: 100, width: 200, height: 20 },
      { kind: 'box', x: 100, y: 300, width: 200, height: 20 },
    ]
    expect(withoutCovered(boxes, [{ x: 101, y: 101, width: 198, height: 18 }])).toEqual([boxes[1]])
  })
})
