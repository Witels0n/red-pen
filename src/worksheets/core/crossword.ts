// Crossword layout: greedy placement where each word crosses a word already in the grid, with
// several seeded tries kept by the most words placed and then the most compact grid.
import { seededRng, shuffled, type Rng } from './random'
import { gridLetters } from './text'

export interface CrosswordEntry {
  answer: string
  clue: string
}

export type Direction = 'across' | 'down'

export interface CrosswordWord {
  answer: string
  clue: string
  /** The letters in the grid. */
  letters: string
  row: number
  col: number
  direction: Direction
  number: number
}

export interface Crossword {
  rows: number
  cols: number
  /** cells[row][col]: a letter, or '' for a black (unused) square. */
  cells: string[][]
  /** Cell numbers, 0 where none is printed. */
  numbers: number[][]
  words: CrosswordWord[]
  /** Entries that could not be crossed with the rest, as typed. */
  unplaced: string[]
}

interface Placement {
  entry: number
  letters: string
  row: number
  col: number
  direction: Direction
}

const key = (r: number, c: number) => `${r},${c}`

/** A sparse grid that knows which cells are used across and which down. */
class Board {
  letters = new Map<string, string>()
  across = new Set<string>()
  down = new Set<string>()
  placements: Placement[] = []
  minR = 0
  maxR = 0
  minC = 0
  maxC = 0

  at(r: number, c: number): string {
    return this.letters.get(key(r, c)) ?? ''
  }

  /** How many crossings the placement would make, or -1 when it is not allowed. */
  check(letters: string, row: number, col: number, direction: Direction): number {
    const dr = direction === 'down' ? 1 : 0
    const dc = direction === 'across' ? 1 : 0
    // The squares just before the first letter and just after the last must stay empty.
    if (this.at(row - dr, col - dc) !== '') return -1
    if (this.at(row + dr * letters.length, col + dc * letters.length) !== '') return -1
    const sameWay = direction === 'across' ? this.across : this.down
    let crossings = 0
    for (let i = 0; i < letters.length; i++) {
      const r = row + dr * i
      const c = col + dc * i
      const here = this.at(r, c)
      if (here !== '') {
        if (here !== letters[i] || sameWay.has(key(r, c))) return -1
        crossings++
      } else {
        // A new letter may not touch another word side-on, or it would spell a word nobody asked for.
        if (this.at(r + dc, c + dr) !== '' || this.at(r - dc, c - dr) !== '') return -1
      }
    }
    return crossings
  }

  place(p: Placement): void {
    const dr = p.direction === 'down' ? 1 : 0
    const dc = p.direction === 'across' ? 1 : 0
    const sameWay = p.direction === 'across' ? this.across : this.down
    for (let i = 0; i < p.letters.length; i++) {
      const r = p.row + dr * i
      const c = p.col + dc * i
      this.letters.set(key(r, c), p.letters[i])
      sameWay.add(key(r, c))
    }
    if (this.placements.length === 0) {
      this.minR = this.maxR = p.row
      this.minC = this.maxC = p.col
    }
    this.minR = Math.min(this.minR, p.row)
    this.minC = Math.min(this.minC, p.col)
    this.maxR = Math.max(this.maxR, p.row + dr * (p.letters.length - 1))
    this.maxC = Math.max(this.maxC, p.col + dc * (p.letters.length - 1))
    this.placements.push(p)
  }

  /** Width and height if a word were added. */
  areaWith(letters: string, row: number, col: number, direction: Direction): number {
    const endR = row + (direction === 'down' ? letters.length - 1 : 0)
    const endC = col + (direction === 'across' ? letters.length - 1 : 0)
    const h = Math.max(this.maxR, endR) - Math.min(this.minR, row) + 1
    const w = Math.max(this.maxC, endC) - Math.min(this.minC, col) + 1
    // Prefer square-ish grids a little: they fit the page better.
    return h * w + Math.abs(h - w) * 2
  }
}

/** Every allowed way to cross `letters` with the board, best first. */
function options(board: Board, letters: string, rng: Rng): { row: number; col: number; direction: Direction }[] {
  const found: { row: number; col: number; direction: Direction; crossings: number; area: number; tie: number }[] = []
  for (const [k, ch] of board.letters) {
    const [r, c] = k.split(',').map(Number)
    for (let i = 0; i < letters.length; i++) {
      if (letters[i] !== ch) continue
      for (const direction of ['across', 'down'] as const) {
        const row = direction === 'down' ? r - i : r
        const col = direction === 'across' ? c - i : c
        const crossings = board.check(letters, row, col, direction)
        if (crossings > 0)
          found.push({ row, col, direction, crossings, area: board.areaWith(letters, row, col, direction), tie: rng() })
      }
    }
  }
  found.sort((a, b) => b.crossings - a.crossings || a.area - b.area || a.tie - b.tie)
  return found
}

function layoutOnce(entries: { index: number; letters: string }[], rng: Rng): Board {
  const board = new Board()
  const waiting = [...entries]
  const first = waiting.shift()
  if (!first) return board
  board.place({
    entry: first.index,
    letters: first.letters,
    row: 0,
    col: 0,
    direction: rng() < 0.5 ? 'across' : 'down',
  })
  // Keep passing over the words that did not fit: a later word can give them something to cross.
  let progress = true
  while (waiting.length > 0 && progress) {
    progress = false
    for (let i = 0; i < waiting.length; i++) {
      const w = waiting[i]
      const best = options(board, w.letters, rng)[0]
      if (!best) continue
      board.place({ entry: w.index, letters: w.letters, ...best })
      waiting.splice(i, 1)
      i--
      progress = true
    }
  }
  return board
}

function score(board: Board): [number, number] {
  const h = board.maxR - board.minR + 1
  const w = board.maxC - board.minC + 1
  return [board.placements.length, -(h * w + Math.abs(h - w) * 2)]
}

export const CROSSWORD_TRIES = 30

/** Lays out a crossword. Every entry is either in the grid or listed in `unplaced`. */
export function generateCrossword(entries: readonly CrosswordEntry[], seed: number): Crossword {
  const rng = seededRng(seed)
  const seen = new Set<string>()
  const usable: { index: number; letters: string }[] = []
  const unplaced: string[] = []
  entries.forEach((e, index) => {
    const letters = gridLetters(e.answer)
    if (letters.length < 2 || seen.has(letters)) {
      unplaced.push(e.answer)
      return
    }
    seen.add(letters)
    usable.push({ index, letters })
  })

  let best: Board | undefined
  for (let t = 0; t < CROSSWORD_TRIES; t++) {
    // The first try is longest first; later tries mix the order to find a tighter grid.
    const order =
      t === 0
        ? [...usable].sort((a, b) => b.letters.length - a.letters.length)
        : shuffled(usable, rng)
            .map((u) => ({ u, k: u.letters.length + rng() * 4 }))
            .sort((a, b) => b.k - a.k)
            .map((x) => x.u)
    const board = layoutOnce(order, rng)
    if (!best) best = board
    else {
      const [p, a] = score(board)
      const [bp, ba] = score(best)
      if (p > bp || (p === bp && a > ba)) best = board
    }
  }

  const board = best ?? new Board()
  const placedEntries = new Set(board.placements.map((p) => p.entry))
  for (const u of usable) if (!placedEntries.has(u.index)) unplaced.push(entries[u.index].answer)

  if (board.placements.length === 0) return { rows: 0, cols: 0, cells: [], numbers: [], words: [], unplaced }

  const rows = board.maxR - board.minR + 1
  const cols = board.maxC - board.minC + 1
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => board.at(r + board.minR, c + board.minC)),
  )
  const numbers = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  const starts = new Map<string, number>()
  let next = 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const starts1 = board.placements.some((p) => p.row - board.minR === r && p.col - board.minC === c)
      if (starts1) {
        numbers[r][c] = next
        starts.set(key(r, c), next++)
      }
    }
  }
  const words: CrosswordWord[] = board.placements
    .map((p) => {
      const row = p.row - board.minR
      const col = p.col - board.minC
      return {
        answer: entries[p.entry].answer,
        clue: entries[p.entry].clue,
        letters: p.letters,
        row,
        col,
        direction: p.direction,
        number: starts.get(key(row, col))!,
      }
    })
    .sort((a, b) => a.number - b.number || (a.direction === 'across' ? -1 : 1))
  return { rows, cols, cells, numbers, words, unplaced }
}
