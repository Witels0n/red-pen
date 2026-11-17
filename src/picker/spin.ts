// The maths of the spin: where the wheel (or ticker) must stop so that the chosen entry is under the pointer.
//
// Wheel convention: at rotation 0, slice i covers the angles [i * s, (i + 1) * s) measured clockwise from the
// pointer at the top, where s = 2 pi / n. Turning the wheel clockwise by r brings wheel angle (-r mod 2 pi)
// under the pointer.

export const TAU = Math.PI * 2

/** An angle in [0, 2 pi). */
export function normaliseAngle(angle: number): number {
  const a = angle % TAU
  return a < 0 ? a + TAU : a + 0
}

/** The slice under the pointer when the wheel is turned by `rotation`. */
export function sliceAt(rotation: number, count: number): number {
  const slice = TAU / count
  return Math.min(count - 1, Math.floor(normaliseAngle(-rotation) / slice))
}

export interface LandingOptions {
  /** Whole extra turns before stopping, for a satisfying spin. */
  turns: number
  /** Where in the slice the pointer stops, from 0 (its leading edge) to 1. 0.5 is the middle. */
  offset: number
}

/**
 * The rotation to stop at so `index` is under the pointer, at least `turns` whole turns past `current`
 * (always clockwise, always forward).
 */
export function landingRotation(current: number, index: number, count: number, options: LandingOptions): number {
  const slice = TAU / count
  const offset = Math.min(0.999, Math.max(0.001, options.offset))
  const target = normaliseAngle(-(index + offset) * slice)
  const extra = normaliseAngle(target - current)
  return current + options.turns * TAU + extra
}

/** Fast start, long slow finish (quartic ease out). t from 0 to 1. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 4
}

/** The value at time t (0 to 1) of an eased move from `from` to `to`. */
export function spinAt(from: number, to: number, t: number): number {
  return from + (to - from) * easeOut(t)
}

/** How many slice edges pass the pointer between two rotations (one tick each). */
export function edgesBetween(from: number, to: number, count: number): number {
  const slice = TAU / count
  return Math.abs(Math.floor(to / slice) - Math.floor(from / slice))
}

// Ticker convention: position p (in rows) puts entry round(p) mod n in the middle row.

/** The entry in the middle row at ticker position p. */
export function tickerAt(position: number, count: number): number {
  const i = Math.round(position) % count
  return i < 0 ? i + count : i
}

/** The ticker position to stop at so `index` is in the middle, at least `loops` whole loops past `current`. */
export function tickerLanding(current: number, index: number, count: number, loops: number): number {
  const minimum = Math.round(current) + loops * count
  const k = Math.ceil((minimum - index) / count)
  return k * count + index
}

/** Font size for a wheel slice label: as large as fits the slice width at its middle, between min and max. */
export function sliceFontSize(radius: number, count: number, min: number, max: number): number {
  if (count <= 1) return max
  const width = (TAU / count) * radius * 0.62
  return Math.max(min, Math.min(max, width * 0.62))
}

/** The wheel stays legible up to this many slices on a big screen; beyond it the ticker reads better. */
export const WHEEL_LIMIT = 30
