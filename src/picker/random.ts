/**
 * A source of fair random whole numbers: rng(n) returns 0, 1, ... or n - 1, each equally likely.
 * The page uses cryptoRng; tests pass a seeded one so results repeat.
 */
export type Rng = (n: number) => number

const LIMIT = 2 ** 32

/** Uniform whole numbers from crypto.getRandomValues, with rejection sampling so no number is favoured. */
export const cryptoRng: Rng = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > LIMIT) throw new RangeError(`Cannot pick from ${n} options.`)
  if (n === 1) return 0
  const buffer = new Uint32Array(1)
  // The largest multiple of n below 2^32: values at or above it would make low numbers more likely.
  const ceiling = LIMIT - (LIMIT % n)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < ceiling) return buffer[0] % n
  }
}

/** A small seeded generator (mulberry32), for tests and repeatable shuffles. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const x = ((t ^ (t >>> 14)) >>> 0) / LIMIT
    return Math.floor(x * n)
  }
}

/** A new array with the same items in a random order (Fisher-Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A random fraction from `min` to `max`, in steps of a millionth. */
export function randomBetween(min: number, max: number, rng: Rng): number {
  return min + (rng(1_000_001) / 1_000_000) * (max - min)
}
