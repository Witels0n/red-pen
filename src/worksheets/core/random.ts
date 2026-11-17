// Seeded randomness, so a saved worksheet regenerates exactly the same puzzle every time.

/** A random number generator returning floats in [0, 1). */
export type Rng = () => number

/** Mulberry32: tiny, fast and good enough for puzzles. The same seed always gives the same sequence. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A fresh seed for a new section or the Shuffle button. Not seeded itself, on purpose. */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0
}

/** An integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A shuffled order of 0..n-1 in which no index stays in its own place (a derangement), whenever
 * that is possible (n of 2 or more). Used so that no pair in Match the columns lines up.
 */
export function derangement(n: number, rng: Rng): number[] {
  const p = shuffled(
    Array.from({ length: n }, (_, i) => i),
    rng,
  )
  if (n < 2) return p
  for (let i = 0; i < n; i++) {
    if (p[i] !== i) continue
    // Swapping with the next place always fixes this one without breaking the next (see the tests).
    const j = (i + 1) % n
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  return p
}
