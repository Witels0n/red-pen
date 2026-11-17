// Word search generation: places words in a square grid along the allowed directions, then fills the
// rest with random letters. Seeded, so the same settings always give the same grid.
import { randomInt, seededRng, shuffled, type Rng } from './random'
import { gridLetters } from './text'

export interface WordSearchDirections {
  across: boolean
  down: boolean
  diagonal: boolean
  backwards: boolean
}

export interface WordSearchOptions {
  words: readonly string[]
  size: number
  directions: WordSearchDirections
  seed: number
}

export interface WordPlacement {
  /** The word as the teacher typed it, for the word list. */
  word: string
  /** The letters placed in the grid. */
  letters: string
  row: number
  col: number
  /** Step per letter: -1, 0 or 1 in each axis. */
  dr: number
  dc: number
}

export interface WordSearch {
  size: number
  /** grid[row][col], upper case. */
  grid: string[][]
  placed: WordPlacement[]
  /** Words that did not fit, as typed. */
  unplaced: string[]
}

export const MIN_GRID = 6
export const MAX_GRID = 20

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The steps a word may take through the grid, given the teacher's choices. Across is used when none is chosen. */
export function allowedSteps(d: WordSearchDirections): [number, number][] {
  const forward: [number, number][] = []
  if (d.across) forward.push([0, 1])
  if (d.down) forward.push([1, 0])
  if (d.diagonal) forward.push([1, 1], [-1, 1])
  if (forward.length === 0) forward.push([0, 1])
  return d.backwards ? [...forward, ...forward.map(([r, c]): [number, number] => [-r || 0, -c || 0])] : forward
}

interface Candidate {
  row: number
  col: number
  dr: number
  dc: number
}

function candidates(grid: string[][], letters: string, steps: [number, number][]): Candidate[] {
  const n = grid.length
  const out: Candidate[] = []
  const len = letters.length
  for (const [dr, dc] of steps) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const endR = row + dr * (len - 1)
        const endC = col + dc * (len - 1)
        if (endR < 0 || endR >= n || endC < 0 || endC >= n) continue
        let ok = true
        let overlaps = 0
        for (let i = 0; i < len && ok; i++) {
          const cell = grid[row + dr * i][col + dc * i]
          if (cell === '') continue
          if (cell === letters[i]) overlaps++
          else ok = false
        }
        // A word lying wholly on top of another would be found inside it: not a real placement.
        if (ok && overlaps < len) out.push({ row, col, dr, dc })
      }
    }
  }
  return out
}

function attempt(words: { word: string; letters: string }[], size: number, steps: [number, number][], rng: Rng) {
  const grid = Array.from({ length: size }, () => Array<string>(size).fill(''))
  const placed: WordPlacement[] = []
  const unplaced: string[] = []
  for (const w of words) {
    const options = candidates(grid, w.letters, steps)
    if (options.length === 0) {
      unplaced.push(w.word)
      continue
    }
    const c = options[randomInt(rng, options.length)]
    for (let i = 0; i < w.letters.length; i++) grid[c.row + c.dr * i][c.col + c.dc * i] = w.letters[i]
    placed.push({ word: w.word, letters: w.letters, ...c })
  }
  return { grid, placed, unplaced }
}

/** Cleans the word list: drops words with no letters and repeats, keeping the teacher's order. */
export function wordSearchWords(words: readonly string[]): { word: string; letters: string }[] {
  const seen = new Set<string>()
  const out: { word: string; letters: string }[] = []
  for (const raw of words) {
    const word = raw.trim()
    const letters = gridLetters(word)
    if (letters.length < 2 || seen.has(letters)) continue
    seen.add(letters)
    out.push({ word, letters })
  }
  return out
}

export function generateWordSearch(o: WordSearchOptions): WordSearch {
  const size = Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(o.size)))
  const rng = seededRng(o.seed)
  const steps = allowedSteps(o.directions)
  const words = wordSearchWords(o.words)
  // Longest first fits best; ties keep a shuffled order so Shuffle changes more than the filler.
  const order = shuffled(words, rng).sort((a, b) => b.letters.length - a.letters.length)
  let best = attempt(order, size, steps, rng)
  for (let i = 0; i < 12 && best.unplaced.length > 0; i++) {
    const next = attempt(order, size, steps, rng)
    if (next.unplaced.length < best.unplaced.length) best = next
  }
  const grid = best.grid.map((row) => row.map((cell) => cell || ALPHABET[randomInt(rng, ALPHABET.length)]))
  // Report the word list in the teacher's order.
  const rank = new Map(words.map((w, i) => [w.letters, i]))
  const placed = best.placed.sort((a, b) => rank.get(a.letters)! - rank.get(b.letters)!)
  const unplaced = words.filter((w) => best.unplaced.includes(w.word)).map((w) => w.word)
  return { size, grid, placed, unplaced }
}

/** The smallest grid that can hold the longest word. */
export function suggestedGridSize(words: readonly string[]): number {
  const longest = Math.max(0, ...wordSearchWords(words).map((w) => w.letters.length))
  return Math.max(MIN_GRID, Math.min(MAX_GRID, longest + 2))
}
