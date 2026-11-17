// Pure pixel helpers for signature images (RGBA, 4 bytes per pixel).

/**
 * Make white and near-white paper transparent, in place, so an uploaded photo or scan of a
 * signature sits on the page without a white rectangle. Pixels lighter than `clear` vanish;
 * between `keep` and `clear` they fade, which keeps the edges of the ink smooth.
 */
export function whiteToTransparent(data: Uint8ClampedArray, keep = 190, clear = 235): void {
  for (let i = 0; i < data.length; i += 4) {
    const light = Math.min(data[i], data[i + 1], data[i + 2])
    if (light >= clear) data[i + 3] = 0
    else if (light > keep) data[i + 3] = Math.round((data[i + 3] * (clear - light)) / (clear - keep))
  }
}

/** The bounding box of pixels that are not (nearly) transparent, or null if there are none. */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minAlpha = 16,
): { x: number; y: number; width: number; height: number } | null {
  let x1 = width
  let y1 = height
  let x2 = -1
  let y2 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < minAlpha) continue
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

/**
 * Smooth a freehand stroke: each point moves part of the way towards the running average,
 * which takes out the jitter of a finger or mouse without rounding off the shape.
 */
export function smoothStroke(points: readonly { x: number; y: number }[], amount = 0.5): { x: number; y: number }[] {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const out = [{ ...points[0] }]
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1]
    out.push({ x: prev.x + (points[i].x - prev.x) * (1 - amount), y: prev.y + (points[i].y - prev.y) * (1 - amount) })
  }
  out[out.length - 1] = { ...points[points.length - 1] } // the stroke still ends where the pen lifted
  return out
}
