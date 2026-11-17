// Perspective transforms (homographies) as 3x3 row-major matrices with h[8] = 1.

export type Homography = number[]

export interface Point {
  x: number
  y: number
}

/** Solves the 8x8 system for the homography taking each src point to its dst point. */
export function homographyFrom(src: Point[], dst: Point[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error('A homography needs four point pairs.')
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const h = solve(a, b)
  return [...h, 1]
}

/** Gaussian elimination with partial pivoting. Throws when the points are degenerate. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('The corner points are degenerate.')
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

export function applyHomography(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, hh, i] = h
  const A = e * i - f * hh
  const B = -(d * i - f * g)
  const C = d * hh - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) throw new Error('The transform cannot be inverted.')
  const inv = [
    A,
    -(b * i - c * hh),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * hh - b * g),
    a * e - b * d,
  ].map((v) => v / det)
  return inv.map((v) => v / inv[8])
}

/** Approximate pixels per layout unit near a point (square root of the local area scale). */
export function localScale(h: Homography, x: number, y: number): number {
  const p = applyHomography(h, x, y)
  const px = applyHomography(h, x + 1, y)
  const py = applyHomography(h, x, y + 1)
  const ax = px.x - p.x
  const ay = px.y - p.y
  const bx = py.x - p.x
  const by = py.y - p.y
  return Math.sqrt(Math.abs(ax * by - ay * bx))
}
