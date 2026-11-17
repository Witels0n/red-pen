// Turns each activity, as the teacher typed it, into the puzzle that prints: grids, shuffles, numbering,
// marks and any problems to show. Pure and seeded; both the PDF and the editor use it.
import { blankAnswers, distinctWords, parseBlanks, type BlankSegment } from './blanks'
import { generateCrossword, type Crossword } from './crossword'
import { ACTIVITY_NAMES, type Activity, type DiagramPicture, type Worksheet } from './model'
import { derangement, seededRng, shuffled } from './random'
import { scramble } from './scramble'
import { lines, splitPair } from './text'
import { generateWordSearch, type WordSearch } from './wordsearch'

export type ActivityBody =
  | { type: 'wordsearch'; puzzle: WordSearch; lowerCase: boolean }
  | { type: 'crossword'; puzzle: Crossword; showLengths: boolean }
  | {
      type: 'match'
      left: string[]
      /** Column B in its printed (shuffled) order. */
      right: string[]
      /** The correct letter for each item in column A. */
      answers: string[]
    }
  | { type: 'blanks'; segments: BlankSegment[]; bank: string[] | null }
  | { type: 'truefalse'; items: { text: string; answer: boolean; correction: string }[]; corrections: boolean }
  | { type: 'unscramble'; items: { scrambled: string; answer: string; hint: string }[] }
  | { type: 'vocabulary'; items: { word: string; meaning: string }[]; bank: string[] | null }
  | {
      type: 'labelling'
      picture: DiagramPicture | null
      labels: { x: number; y: number; answer: string; number: number }[]
      bank: string[] | null
    }

export interface GeneratedActivity {
  id: string
  heading: string
  instructions: string
  marks: number
  /** Things the teacher should know: words that did not fit, lines that were not understood. */
  warnings: string[]
  body: ActivityBody
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** "A" ... "Z", then "AA", "AB" ... */
export function columnLetter(i: number): string {
  return i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26]
}

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function unread(nums: number[], example: string): string[] {
  if (nums.length === 0) return []
  const which = nums.length === 1 ? `Line ${nums[0]} was` : `Lines ${listWords(nums.map(String))} were`
  return [`${which} left out: write each one like "${example}".`]
}

function pairs(text: string): { pairs: [string, string][]; bad: number[] } {
  const out: [string, string][] = []
  const bad: number[] = []
  for (const l of lines(text)) {
    const p = splitPair(l.text)
    if (p) out.push(p)
    else bad.push(l.line)
  }
  return { pairs: out, bad }
}

/** The default instructions for an activity, used when the teacher leaves them empty. */
export function defaultInstructions(a: Activity): string {
  switch (a.type) {
    case 'wordsearch': {
      const ways = [a.across && 'across', a.down && 'down', a.diagonal && 'diagonally'].filter((w): w is string => !!w)
      const how = listWords(ways.length ? ways : ['across'])
      return `Find the words in the grid. They read ${how}${a.backwards ? ', and some are backwards' : ''}.`
    }
    case 'crossword':
      return 'Use the clues to fill in the crossword.'
    case 'match':
      return 'Match each item in Column A with one in Column B. Write the letter in the box.'
    case 'blanks':
      return a.wordBank ? 'Fill in the missing words. Choose them from the word bank.' : 'Fill in the missing words.'
    case 'truefalse':
      return a.corrections
        ? 'Circle True or False for each statement. If it is false, correct it on the line below.'
        : 'Circle True or False for each statement.'
    case 'unscramble':
      return 'Unscramble the letters to make the words.'
    case 'vocabulary':
      return a.wordBank
        ? 'Write the word that matches each meaning. Choose the words from the word bank.'
        : 'Write the word that matches each meaning.'
    case 'labelling':
      return a.wordBank
        ? 'Label the diagram. Write each label on its numbered line, choosing from the word bank.'
        : 'Label the diagram. Write each label on its numbered line.'
  }
}

function body(a: Activity): { body: ActivityBody; items: number; extraMarks: number; warnings: string[] } {
  const rng = seededRng(a.seed)
  switch (a.type) {
    case 'wordsearch': {
      const words = lines(a.words).map((l) => l.text)
      const puzzle = generateWordSearch({ words, size: a.size, directions: a, seed: a.seed })
      const warnings: string[] = []
      if (puzzle.placed.length === 0 && puzzle.unplaced.length === 0) warnings.push('Type the words, one per line.')
      if (puzzle.unplaced.length)
        warnings.push(
          `Did not fit: ${listWords(puzzle.unplaced)}. Make the grid bigger, allow more directions or press Shuffle.`,
        )
      return {
        body: { type: 'wordsearch', puzzle, lowerCase: a.lowerCase },
        items: puzzle.placed.length,
        extraMarks: 0,
        warnings,
      }
    }
    case 'crossword': {
      const p = pairs(a.clues)
      const puzzle = generateCrossword(
        p.pairs.map(([answer, clue]) => ({ answer, clue })),
        a.seed,
      )
      const warnings = unread(p.bad, 'Sun: The star at the centre of our solar system')
      if (p.pairs.length === 0 && p.bad.length === 0) warnings.push('Type an answer and its clue on each line.')
      if (puzzle.unplaced.length)
        warnings.push(`Left out, because they do not cross the other words: ${listWords(puzzle.unplaced)}.`)
      return {
        body: { type: 'crossword', puzzle, showLengths: a.showLengths },
        items: puzzle.words.length,
        extraMarks: 0,
        warnings,
      }
    }
    case 'match': {
      const p = pairs(a.pairs)
      const order = derangement(p.pairs.length, rng)
      // order[i] is the pair printed in place i of column B.
      const right = order.map((k) => p.pairs[k][1])
      const answers = p.pairs.map((_, k) => columnLetter(order.indexOf(k)))
      const warnings = unread(p.bad, 'Herbivore: Eats only plants')
      if (p.pairs.length === 1) warnings.push('Add at least two pairs to match.')
      return {
        body: { type: 'match', left: p.pairs.map((x) => x[0]), right, answers },
        items: p.pairs.length,
        extraMarks: 0,
        warnings,
      }
    }
    case 'blanks': {
      const segments = parseBlanks(a.text)
      const answers = blankAnswers(segments)
      const warnings = answers.length === 0 ? ['Put each missing word in [square brackets].'] : []
      const bank = a.wordBank ? shuffled(distinctWords(answers), rng) : null
      return { body: { type: 'blanks', segments, bank }, items: answers.length, extraMarks: 0, warnings }
    }
    case 'truefalse': {
      const items: { text: string; answer: boolean; correction: string }[] = []
      const bad: number[] = []
      for (const l of lines(a.statements)) {
        const m = /^(t|f|true|false)\s*[:.)\-]\s*(.+)$/i.exec(l.text)
        if (!m) {
          bad.push(l.line)
          continue
        }
        const [statement, correction = ''] = m[2].split('|').map((s) => s.trim())
        items.push({ text: statement, answer: m[1][0].toLowerCase() === 't', correction })
      }
      const falseCount = items.filter((i) => !i.answer).length
      return {
        body: { type: 'truefalse', items, corrections: a.corrections },
        items: items.length,
        extraMarks: a.corrections ? falseCount : 0,
        warnings: unread(bad, 'T: Bats are mammals'),
      }
    }
    case 'unscramble': {
      const items = lines(a.words).map((l) => {
        const p = splitPair(l.text)
        const answer = p ? p[0] : l.text
        return { answer, hint: p ? p[1] : '', scrambled: scramble(answer, rng) }
      })
      return { body: { type: 'unscramble', items }, items: items.length, extraMarks: 0, warnings: [] }
    }
    case 'vocabulary': {
      const p = pairs(a.terms)
      const items = p.pairs.map(([word, meaning]) => ({ word, meaning }))
      const bank = a.wordBank ? shuffled(distinctWords(items.map((i) => i.word)), rng) : null
      return {
        body: { type: 'vocabulary', items, bank },
        items: items.length,
        extraMarks: 0,
        warnings: unread(p.bad, 'Evaporation: When a liquid turns into a gas'),
      }
    }
    case 'labelling': {
      const labels = a.labels.map((l, i) => ({ ...l, answer: l.answer.trim(), number: i + 1 }))
      const warnings: string[] = []
      if (!a.picture) warnings.push('Add a picture, then tap it to place each label.')
      else if (labels.length === 0) warnings.push('Tap the picture to place a numbered label.')
      if (labels.some((l) => l.answer === '')) warnings.push('Type the answer for every label, for the memo.')
      const bank = a.wordBank ? shuffled(distinctWords(labels.map((l) => l.answer)), rng) : null
      return {
        body: { type: 'labelling', picture: a.picture, labels, bank },
        items: labels.length,
        extraMarks: 0,
        warnings,
      }
    }
  }
}

export function generateActivity(a: Activity): GeneratedActivity {
  const g = body(a)
  return {
    id: a.id,
    heading: a.heading.trim() || ACTIVITY_NAMES[a.type],
    instructions: a.instructions.trim() || defaultInstructions(a),
    marks: (g.items + g.extraMarks) * a.marksEach,
    warnings: g.warnings,
    body: g.body,
  }
}

export interface GeneratedWorksheet {
  worksheet: Worksheet
  activities: GeneratedActivity[]
  total: number
}

export function generateWorksheet(w: Worksheet): GeneratedWorksheet {
  const activities = w.activities.map(generateActivity)
  return { worksheet: w, activities, total: activities.reduce((s, a) => s + a.marks, 0) }
}
