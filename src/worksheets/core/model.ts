// A Worksheet: a header and a list of Activities (sections), each kept as the teacher typed it plus a
// seed, so the puzzles regenerate identically from storage. See GLOSSARY.md ("Worksheets").
import { newSeed } from './random'

export type ActivityType =
  'wordsearch' | 'crossword' | 'match' | 'blanks' | 'truefalse' | 'unscramble' | 'vocabulary' | 'labelling'

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'wordsearch',
  'crossword',
  'match',
  'blanks',
  'truefalse',
  'unscramble',
  'vocabulary',
  'labelling',
]

export const ACTIVITY_NAMES: Record<ActivityType, string> = {
  wordsearch: 'Word search',
  crossword: 'Crossword',
  match: 'Match the columns',
  blanks: 'Fill in the blanks',
  truefalse: 'True or false',
  unscramble: 'Unscramble the words',
  vocabulary: 'Vocabulary',
  labelling: 'Label the diagram',
}

interface ActivityBase {
  id: string
  /** Printed heading; the activity's name when empty. */
  heading: string
  /** Printed instructions; sensible defaults when empty. */
  instructions: string
  /** Marks for each item (word, pair, blank, statement or label). */
  marksEach: number
  /** Seeds every shuffle and layout in the activity. Shuffle picks a new one. */
  seed: number
}

export interface WordSearchActivity extends ActivityBase {
  type: 'wordsearch'
  /** One word per line. */
  words: string
  size: number
  across: boolean
  down: boolean
  diagonal: boolean
  backwards: boolean
  lowerCase: boolean
}

export interface CrosswordActivity extends ActivityBase {
  type: 'crossword'
  /** "answer: clue" per line. */
  clues: string
  /** Print the number of letters after each clue. */
  showLengths: boolean
}

export interface MatchActivity extends ActivityBase {
  type: 'match'
  /** "left: right" per line. */
  pairs: string
}

export interface BlanksActivity extends ActivityBase {
  type: 'blanks'
  /** Text with each blank in [square brackets]. */
  text: string
  wordBank: boolean
}

export interface TrueFalseActivity extends ActivityBase {
  type: 'truefalse'
  /** "T: statement" or "F: statement | correction" per line. */
  statements: string
  /** Learners correct each false statement on a line underneath, for an extra mark each. */
  corrections: boolean
}

export interface UnscrambleActivity extends ActivityBase {
  type: 'unscramble'
  /** "word" or "word: hint" per line. */
  words: string
}

export interface VocabularyActivity extends ActivityBase {
  type: 'vocabulary'
  /** "word: meaning" per line. */
  terms: string
  wordBank: boolean
}

export interface DiagramPicture {
  /** A downscaled JPEG or PNG as a data: URL. */
  dataUrl: string
  width: number
  height: number
}

export interface DiagramLabel {
  /** Where the label points, as fractions of the picture's width and height. */
  x: number
  y: number
  answer: string
}

export interface LabellingActivity extends ActivityBase {
  type: 'labelling'
  picture: DiagramPicture | null
  labels: DiagramLabel[]
  wordBank: boolean
}

export type Activity =
  | WordSearchActivity
  | CrosswordActivity
  | MatchActivity
  | BlanksActivity
  | TrueFalseActivity
  | UnscrambleActivity
  | VocabularyActivity
  | LabellingActivity

export interface Worksheet {
  id: string
  title: string
  /** General instructions under the title. */
  instructions: string
  /** Print Name, Class and Date lines at the top. */
  learnerLines: boolean
  activities: Activity[]
  createdAt: number
  updatedAt: number
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** A new activity of a type, with example content so the preview shows something straight away. */
export function newActivity(type: ActivityType, seed = newSeed(), id = newId()): Activity {
  const base = { id, heading: '', instructions: '', marksEach: 1, seed }
  switch (type) {
    case 'wordsearch':
      return {
        ...base,
        type,
        words: 'Mercury\nVenus\nEarth\nMars\nJupiter\nSaturn\nUranus\nNeptune',
        size: 12,
        across: true,
        down: true,
        diagonal: true,
        backwards: false,
        lowerCase: false,
      }
    case 'crossword':
      return {
        ...base,
        type,
        clues:
          'Sun: The star at the centre of our solar system\nMoon: It orbits the Earth\nMars: The red planet\nSaturn: The planet with the biggest rings\nComet: An icy body with a glowing tail\nOrbit: The path one body takes around another',
        showLengths: true,
      }
    case 'match':
      return {
        ...base,
        type,
        pairs:
          'Herbivore: Eats only plants\nCarnivore: Eats only meat\nOmnivore: Eats plants and meat\nProducer: Makes its own food\nDecomposer: Breaks down dead matter',
      }
    case 'blanks':
      return {
        ...base,
        type,
        text: 'Plants make their own food through [photosynthesis]. They take in [carbon dioxide] from the air and water from the [soil], and give off [oxygen].',
        wordBank: true,
      }
    case 'truefalse':
      return {
        ...base,
        type,
        statements:
          'T: Water boils at 100 °C at sea level.\nF: The Sun goes around the Earth. | The Earth goes around the Sun.\nT: Bats are mammals.\nF: Sound travels faster than light. | Light travels faster than sound.',
        corrections: false,
      }
    case 'unscramble':
      return { ...base, type, words: 'Volcano: It can erupt\nEarthquake\nGlacier: A river of ice\nDesert' }
    case 'vocabulary':
      return {
        ...base,
        type,
        terms:
          'Evaporation: When a liquid turns into a gas\nCondensation: When a gas turns into a liquid\nPrecipitation: Water falling from clouds',
        wordBank: true,
      }
    case 'labelling':
      return { ...base, type, picture: null, labels: [], wordBank: true }
  }
}

export function newWorksheet(now = Date.now(), id = newId()): Worksheet {
  return {
    id,
    title: 'Our solar system',
    instructions: 'Answer all the questions. Write neatly in pen.',
    learnerLines: true,
    activities: [newActivity('wordsearch'), newActivity('blanks')],
    createdAt: now,
    updatedAt: now,
  }
}

/** A copy with new ids, named "(copy)". The seeds stay, so the copy prints the same puzzles. */
export function duplicateWorksheet(w: Worksheet, now = Date.now()): Worksheet {
  return {
    ...structuredClone(w),
    id: newId(),
    title: `${w.title || 'Worksheet'} (copy)`,
    activities: w.activities.map((a) => ({ ...structuredClone(a), id: newId() })),
    createdAt: now,
    updatedAt: now,
  }
}

// ---------- Reading stored worksheets safely ----------

type Raw = Record<string, unknown>

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

function sanitiseActivity(raw: unknown): Activity | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Raw
  const type = r.type as ActivityType
  if (!ACTIVITY_TYPES.includes(type)) return undefined
  const d = newActivity(type, 0, str(r.id) || newId())
  const base = {
    id: d.id,
    heading: str(r.heading),
    instructions: str(r.instructions),
    marksEach: Math.round(num(r.marksEach, 0, 20, 1)),
    seed: Math.round(num(r.seed, 0, 4294967295, 1)),
  }
  switch (d.type) {
    case 'wordsearch':
      return {
        ...d,
        ...base,
        words: str(r.words),
        size: Math.round(num(r.size, 6, 20, d.size)),
        across: bool(r.across, d.across),
        down: bool(r.down, d.down),
        diagonal: bool(r.diagonal, d.diagonal),
        backwards: bool(r.backwards, d.backwards),
        lowerCase: bool(r.lowerCase, d.lowerCase),
      }
    case 'crossword':
      return { ...d, ...base, clues: str(r.clues), showLengths: bool(r.showLengths, d.showLengths) }
    case 'match':
      return { ...d, ...base, pairs: str(r.pairs) }
    case 'blanks':
      return { ...d, ...base, text: str(r.text), wordBank: bool(r.wordBank, d.wordBank) }
    case 'truefalse':
      return { ...d, ...base, statements: str(r.statements), corrections: bool(r.corrections, d.corrections) }
    case 'unscramble':
      return { ...d, ...base, words: str(r.words) }
    case 'vocabulary':
      return { ...d, ...base, terms: str(r.terms), wordBank: bool(r.wordBank, d.wordBank) }
    case 'labelling': {
      const p = r.picture as Raw | null | undefined
      const picture =
        p && typeof p === 'object' && /^data:image\/(png|jpeg);base64,/.test(str(p.dataUrl))
          ? { dataUrl: str(p.dataUrl), width: num(p.width, 1, 10000, 1), height: num(p.height, 1, 10000, 1) }
          : null
      const labels = (Array.isArray(r.labels) ? r.labels : []).flatMap((l: unknown) => {
        if (!l || typeof l !== 'object') return []
        const x = l as Raw
        return [{ x: num(x.x, 0, 1, 0.5), y: num(x.y, 0, 1, 0.5), answer: str(x.answer) }]
      })
      return { ...d, ...base, picture, labels, wordBank: bool(r.wordBank, d.wordBank) }
    }
  }
}

/** Reads a stored worksheet, filling anything missing or broken. Undefined if it is not a worksheet at all. */
export function sanitiseWorksheet(raw: unknown): Worksheet | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Raw
  const id = str(r.id)
  if (!id) return undefined
  const activities = (Array.isArray(r.activities) ? r.activities : []).flatMap((a) => {
    const s = sanitiseActivity(a)
    return s ? [s] : []
  })
  return {
    id,
    title: str(r.title),
    instructions: str(r.instructions),
    learnerLines: bool(r.learnerLines, true),
    activities,
    createdAt: num(r.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: num(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}
