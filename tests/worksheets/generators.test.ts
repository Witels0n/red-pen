import { describe, expect, it } from 'vitest'
import { blankAnswers, distinctWords, parseBlanks } from '../../src/worksheets/core/blanks'
import { generateCrossword, type Crossword } from '../../src/worksheets/core/crossword'
import { derangement, seededRng, shuffled } from '../../src/worksheets/core/random'
import { scramble } from '../../src/worksheets/core/scramble'
import { gridLetters, lengthHint, lines, splitPair } from '../../src/worksheets/core/text'
import {
  allowedSteps,
  generateWordSearch,
  suggestedGridSize,
  type WordSearch,
  type WordSearchDirections,
} from '../../src/worksheets/core/wordsearch'

const ALL: WordSearchDirections = { across: true, down: true, diagonal: true, backwards: true }
const PLANETS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']

describe('seeded randomness', () => {
  it('repeats exactly for the same seed and differs for another', () => {
    const a = Array.from({ length: 5 }, seededRng(42))
    expect(Array.from({ length: 5 }, seededRng(42))).toEqual(a)
    expect(Array.from({ length: 5 }, seededRng(43))).not.toEqual(a)
    for (const x of a) expect(x >= 0 && x < 1).toBe(true)
  })

  it('shuffles without losing or adding items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    expect([...shuffled(items, seededRng(1))].sort()).toEqual(items)
  })

  it('a derangement never leaves an index in place, for every seed and size from 2', () => {
    for (let n = 2; n <= 12; n++) {
      for (let seed = 0; seed < 200; seed++) {
        const p = derangement(n, seededRng(seed))
        expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
        p.forEach((v, i) => expect(v).not.toBe(i))
      }
    }
  })

  it('a derangement of 0 or 1 items is just the items', () => {
    expect(derangement(0, seededRng(1))).toEqual([])
    expect(derangement(1, seededRng(1))).toEqual([0])
  })
})

describe('reading typed lines', () => {
  it('splits pairs at |, then a colon, then =, then a spaced dash', () => {
    expect(splitPair('Sun: our star')).toEqual(['Sun', 'our star'])
    expect(splitPair('Time | 10:30 in the morning')).toEqual(['Time', '10:30 in the morning'])
    expect(splitPair('H2O = water')).toEqual(['H2O', 'water'])
    expect(splitPair('Cat - a small pet')).toEqual(['Cat', 'a small pet'])
    expect(splitPair('No separator here')).toBeUndefined()
    expect(splitPair('Empty:')).toBeUndefined()
  })

  it('keeps only non-empty lines with their line numbers', () => {
    expect(lines('a\n\n  b  \r\nc')).toEqual([
      { line: 1, text: 'a' },
      { line: 3, text: 'b' },
      { line: 4, text: 'c' },
    ])
  })

  it('turns words into grid letters', () => {
    expect(gridLetters("South Africa's 9")).toBe('SOUTHAFRICAS')
    expect(gridLetters('Môre')).toBe('MÔRE')
    expect(lengthHint('South Africa')).toBe('(5, 6)')
    expect(lengthHint('Sun')).toBe('(3)')
  })
})

function readWord(ws: WordSearch, w: WordSearch['placed'][number]): string {
  return [...w.letters].map((_, i) => ws.grid[w.row + w.dr * i][w.col + w.dc * i]).join('')
}

describe('word search', () => {
  it('places every word so it reads correctly along an allowed direction, inside the grid', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ws = generateWordSearch({ words: PLANETS, size: 12, directions: ALL, seed })
      expect(ws.unplaced).toEqual([])
      expect(ws.placed.map((p) => p.word)).toEqual(PLANETS)
      const steps = allowedSteps(ALL).map((s) => s.join())
      for (const p of ws.placed) {
        expect(steps).toContain(`${p.dr},${p.dc}`)
        expect(readWord(ws, p)).toBe(p.letters)
      }
      expect(ws.grid.flat().every((c) => /^[A-Z]$/.test(c))).toBe(true)
    }
  })

  it('only uses the chosen directions', () => {
    const ws = generateWordSearch({
      words: PLANETS,
      size: 12,
      directions: { across: true, down: false, diagonal: false, backwards: false },
      seed: 3,
    })
    for (const p of ws.placed) expect([p.dr, p.dc]).toEqual([0, 1])
    const back = generateWordSearch({
      words: PLANETS,
      size: 12,
      directions: { across: false, down: true, diagonal: false, backwards: true },
      seed: 3,
    })
    for (const p of back.placed) expect(p.dc).toBe(0)
    expect(new Set(back.placed.map((p) => p.dr))).toEqual(new Set([1, -1]))
  })

  it('never lays one word entirely on top of another', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ws = generateWordSearch({ words: ['CATS', 'CAT', 'AT', 'SCAT'], size: 6, directions: ALL, seed })
      const cells = ws.placed.map(
        (p) => new Set([...p.letters].map((_, i) => `${p.row + p.dr * i},${p.col + p.dc * i}`)),
      )
      cells.forEach((a, i) =>
        cells.forEach((b, j) => {
          if (i !== j) expect([...a].every((c) => b.has(c))).toBe(false)
        }),
      )
    }
  })

  it('reports words that do not fit instead of dropping them silently', () => {
    const ws = generateWordSearch({ words: ['Photosynthesis', 'Leaf'], size: 8, directions: ALL, seed: 1 })
    expect(ws.unplaced).toEqual(['Photosynthesis'])
    expect(ws.placed.map((p) => p.word)).toEqual(['Leaf'])
  })

  it('is the same grid for the same seed, and drops repeats and empty words', () => {
    const a = generateWordSearch({ words: [...PLANETS, 'mars', '123'], size: 12, directions: ALL, seed: 9 })
    const b = generateWordSearch({ words: [...PLANETS, 'mars', '123'], size: 12, directions: ALL, seed: 9 })
    expect(a).toEqual(b)
    expect(a.placed).toHaveLength(8)
    expect(generateWordSearch({ words: PLANETS, size: 12, directions: ALL, seed: 10 }).grid).not.toEqual(a.grid)
  })

  it('suggests a grid size that holds the longest word', () => {
    expect(suggestedGridSize(['Photosynthesis'])).toBe(16)
    expect(suggestedGridSize(['Sun'])).toBe(6)
  })
})

/** Every run of two or more letters, across and down, must be exactly one placed word. */
function expectValidCrossword(cw: Crossword): void {
  const runs: string[] = []
  for (let r = 0; r < cw.rows; r++) {
    let c = 0
    while (c < cw.cols) {
      if (cw.cells[r][c] === '') {
        c++
        continue
      }
      const start = c
      while (c < cw.cols && cw.cells[r][c] !== '') c++
      if (c - start > 1) runs.push(`across ${r},${start} ${cw.cells[r].slice(start, c).join('')}`)
    }
  }
  for (let c = 0; c < cw.cols; c++) {
    let r = 0
    while (r < cw.rows) {
      if (cw.cells[r][c] === '') {
        r++
        continue
      }
      const start = r
      while (r < cw.rows && cw.cells[r][c] !== '') r++
      if (r - start > 1)
        runs.push(
          `down ${start},${c} ${cw.cells
            .slice(start, r)
            .map((row) => row[c])
            .join('')}`,
        )
    }
  }
  const words = cw.words.map((w) => `${w.direction} ${w.row},${w.col} ${w.letters}`)
  expect(runs.sort()).toEqual(words.sort())
  // Every letter belongs to a word, and every word starts on its own number.
  for (const w of cw.words) expect(cw.numbers[w.row][w.col]).toBe(w.number)
  // The grid is connected: every word crosses another (when there is more than one).
  if (cw.words.length > 1) {
    for (const w of cw.words) {
      const crossings = [...w.letters].filter((_, i) => {
        const r = w.row + (w.direction === 'down' ? i : 0)
        const c = w.col + (w.direction === 'across' ? i : 0)
        return cw.words.some(
          (o) =>
            o !== w &&
            o.direction !== w.direction &&
            (o.direction === 'down'
              ? o.col === c && r >= o.row && r < o.row + o.letters.length
              : o.row === r && c >= o.col && c < o.col + o.letters.length),
        )
      })
      expect(crossings.length).toBeGreaterThan(0)
    }
  }
}

const SPACE = [
  ['Sun', 'Our star'],
  ['Moon', 'Orbits the Earth'],
  ['Mars', 'The red planet'],
  ['Saturn', 'Rings'],
  ['Comet', 'Icy body with a tail'],
  ['Orbit', 'A path around'],
  ['Galaxy', 'A huge group of stars'],
  ['Asteroid', 'A rocky body'],
  ['Telescope', 'For seeing far'],
  ['Gravity', 'Pulls things down'],
].map(([answer, clue]) => ({ answer, clue }))

describe('crossword', () => {
  it('has no illegal adjacencies and accounts for every entry, across many seeds', () => {
    for (let seed = 0; seed < 60; seed++) {
      const cw = generateCrossword(SPACE, seed)
      expectValidCrossword(cw)
      expect(cw.words.length + cw.unplaced.length).toBe(SPACE.length)
    }
  })

  it('places all of a friendly word list', () => {
    const cw = generateCrossword(SPACE, 7)
    expect(cw.unplaced).toEqual([])
    expect(cw.words).toHaveLength(SPACE.length)
  })

  it('reports a word that shares no letter with the rest', () => {
    const cw = generateCrossword(
      [
        { answer: 'Cat', clue: 'Pet' },
        { answer: 'Tame', clue: 'Not wild' },
        { answer: 'Buzz', clue: 'Bee sound' },
      ],
      1,
    )
    expect(cw.unplaced).toEqual(['Buzz'])
    expectValidCrossword(cw)
  })

  it('reports repeated and letterless answers', () => {
    const cw = generateCrossword(
      [
        { answer: 'Sun', clue: 'a' },
        { answer: 'sun', clue: 'b' },
        { answer: '42', clue: 'c' },
      ],
      1,
    )
    expect(cw.unplaced.sort()).toEqual(['42', 'sun'])
    expect(cw.words).toHaveLength(1)
  })

  it('numbers cells in reading order and lists across before down on a shared number', () => {
    const cw = generateCrossword(SPACE, 11)
    const numbers = cw.words.map((w) => w.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    const seen = cw.numbers.flat().filter((n) => n > 0)
    expect(seen).toEqual(Array.from({ length: seen.length }, (_, i) => i + 1))
  })

  it('is the same layout for the same seed', () => {
    expect(generateCrossword(SPACE, 5)).toEqual(generateCrossword(SPACE, 5))
  })

  it('handles an empty list', () => {
    expect(generateCrossword([], 1)).toEqual({ rows: 0, cols: 0, cells: [], numbers: [], words: [], unplaced: [] })
  })
})

describe('fill in the blanks', () => {
  it('finds each [blank] in order and keeps the text around it', () => {
    const s = parseBlanks('The [sun] is a [ star ].\nNew line')
    expect(s).toEqual([
      { kind: 'text', text: 'The ' },
      { kind: 'blank', answer: 'sun', number: 1 },
      { kind: 'text', text: ' is a ' },
      { kind: 'blank', answer: 'star', number: 2 },
      { kind: 'text', text: '.\nNew line' },
    ])
    expect(blankAnswers(s)).toEqual(['sun', 'star'])
  })

  it('leaves empty and unclosed brackets as text', () => {
    expect(parseBlanks('A [] and [open')).toEqual([{ kind: 'text', text: 'A [] and [open' }])
    expect(parseBlanks('[a] [b')).toEqual([
      { kind: 'blank', answer: 'a', number: 1 },
      { kind: 'text', text: ' [b' },
    ])
  })

  it('does not let a blank run over a line break', () => {
    expect(blankAnswers(parseBlanks('[one\ntwo] [three]'))).toEqual(['three'])
  })

  it('makes a word bank without repeats', () => {
    expect(distinctWords(['Sun', 'sun', ' Moon ', ''])).toEqual(['Sun', 'Moon'])
  })
})

describe('unscramble', () => {
  it('never gives back the word itself when its letters differ', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = seededRng(seed)
      for (const w of ['at', 'Volcano', 'aab', 'Table Mountain']) {
        const s = scramble(w, rng)
        const plain = w.toUpperCase().replace(/\s/g, '')
        expect(s).not.toBe(plain)
        expect([...s].sort()).toEqual([...plain].sort())
      }
    }
    expect(scramble('aaa', seededRng(1))).toBe('AAA')
  })
})
