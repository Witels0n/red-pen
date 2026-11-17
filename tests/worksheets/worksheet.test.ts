import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { columnLetter, generateActivity, generateWorksheet } from '../../src/worksheets/core/generate'
import {
  ACTIVITY_TYPES,
  duplicateWorksheet,
  newActivity,
  newWorksheet,
  sanitiseWorksheet,
  type Activity,
  type Worksheet,
} from '../../src/worksheets/core/model'
import { renderWorksheetPdf } from '../../src/worksheets/pdf/render'
import { loadOpenId, loadWorksheets, saveOpenId, saveWorksheets, upsert } from '../../src/worksheets/storage'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

function activity<T extends Activity['type']>(type: T, patch: Partial<Extract<Activity, { type: T }>> = {}) {
  return { ...newActivity(type, 1234, `id-${type}`), ...patch } as Extract<Activity, { type: T }>
}

// A 2 x 2 red PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

function everything(): Worksheet {
  const w = newWorksheet(1, 'w1')
  w.activities = ACTIVITY_TYPES.map((t) =>
    t === 'labelling'
      ? activity('labelling', {
          picture: { dataUrl: PNG, width: 2, height: 2 },
          labels: [
            { x: 0.2, y: 0.3, answer: 'Root' },
            { x: 0.7, y: 0.6, answer: 'Stem' },
          ],
        })
      : activity(t),
  )
  return w
}

describe('generateActivity', () => {
  it('works out marks per item', () => {
    expect(generateActivity(activity('wordsearch')).marks).toBe(8)
    expect(generateActivity(activity('wordsearch', { marksEach: 2 })).marks).toBe(16)
    expect(generateActivity(activity('match')).marks).toBe(5)
    expect(generateActivity(activity('blanks')).marks).toBe(4)
    expect(generateActivity(activity('unscramble')).marks).toBe(4)
    expect(generateActivity(activity('vocabulary')).marks).toBe(3)
  })

  it('gives a mark more for each false statement when learners correct them', () => {
    expect(generateActivity(activity('truefalse')).marks).toBe(4)
    expect(generateActivity(activity('truefalse', { corrections: true })).marks).toBe(6)
  })

  it('reads true or false statements and their corrections, and flags lines it cannot read', () => {
    const g = generateActivity(
      activity('truefalse', { statements: 'T: Bats are mammals\nfalse. Fish fly | Fish swim\nWhales are fish' }),
    )
    expect(g.body).toEqual({
      type: 'truefalse',
      corrections: false,
      items: [
        { text: 'Bats are mammals', answer: true, correction: '' },
        { text: 'Fish fly', answer: false, correction: 'Fish swim' },
      ],
    })
    expect(g.warnings).toEqual(['Line 3 was left out: write each one like "T: Bats are mammals".'])
  })

  it('shuffles Column B so no pair lines up, and the memo letters point at the right answers', () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = activity('match', { seed })
      const g = generateActivity(a)
      if (g.body.type !== 'match') throw new Error()
      const { left, right, answers } = g.body
      const pairs = a.pairs.split('\n').map((l) => l.split(': '))
      left.forEach((l, i) => {
        const at = answers[i].charCodeAt(0) - 65
        expect(right[at]).toBe(pairs[i][1])
        expect(at).not.toBe(i)
        expect(l).toBe(pairs[i][0])
      })
    }
  })

  it('uses the default heading and instructions when left empty', () => {
    const g = generateActivity(activity('wordsearch', { backwards: true }))
    expect(g.heading).toBe('Word search')
    expect(g.instructions).toBe(
      'Find the words in the grid. They read across, down and diagonally, and some are backwards.',
    )
    expect(generateActivity(activity('crossword', { heading: ' Space ', instructions: 'Go' })).heading).toBe('Space')
  })

  it('warns about words that did not fit and unreadable lines', () => {
    expect(generateActivity(activity('wordsearch', { words: 'Photosynthesis', size: 8 })).warnings[0]).toMatch(
      /^Did not fit: Photosynthesis\./,
    )
    expect(generateActivity(activity('crossword', { clues: 'Sun: star\nno clue here' })).warnings).toEqual([
      'Line 2 was left out: write each one like "Sun: The star at the centre of our solar system".',
    ])
    expect(generateActivity(activity('blanks', { text: 'No blanks' })).warnings).toEqual([
      'Put each missing word in [square brackets].',
    ])
    expect(generateActivity(activity('labelling')).warnings).toEqual([
      'Add a picture, then tap it to place each label.',
    ])
  })

  it('regenerates identically from the same activity', () => {
    for (const t of ACTIVITY_TYPES) expect(generateActivity(activity(t))).toEqual(generateActivity(activity(t)))
  })

  it('adds up the total', () => {
    const g = generateWorksheet(everything())
    expect(g.total).toBe(g.activities.reduce((s, a) => s + a.marks, 0))
    expect(g.total).toBeGreaterThan(30)
  })
})

describe('columnLetter', () => {
  it('goes A to Z and then AA', () => {
    expect([0, 1, 25, 26, 27].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })
})

describe('worksheets in storage', () => {
  it('saves and loads worksheets, newest first, through a JSON round trip', () => {
    const s = memoryStorage()
    const a = { ...everything(), id: 'a', updatedAt: 1 }
    const b = { ...newWorksheet(2, 'b'), updatedAt: 5 }
    expect(saveWorksheets([a, b], s)).toBe('saved')
    const loaded = loadWorksheets(s)
    expect(loaded.map((w) => w.id)).toEqual(['b', 'a'])
    expect(loaded[1]).toEqual(a)
    // A reloaded worksheet prints the same puzzles.
    expect(generateWorksheet(loaded[1])).toEqual(generateWorksheet(a))
    saveOpenId('a', s)
    expect(loadOpenId(s)).toBe('a')
  })

  it('survives broken storage', () => {
    const s = memoryStorage()
    s.setItem('red-pen.worksheets.saved', '{not json')
    expect(loadWorksheets(s)).toEqual([])
    s.setItem(
      'red-pen.worksheets.saved',
      JSON.stringify([null, { id: '' }, { id: 'x', activities: [{ type: 'nope' }, { type: 'match', marksEach: 99 }] }]),
    )
    const [w] = loadWorksheets(s)
    expect(w.id).toBe('x')
    expect(w.activities).toHaveLength(1)
    expect(w.activities[0].marksEach).toBe(20)
  })

  it('says when storage is full', () => {
    const full: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }
    expect(saveWorksheets([newWorksheet()], full)).toBe('full')
  })

  it('refuses a picture that is not an image data URL', () => {
    const w = sanitiseWorksheet({
      id: 'x',
      activities: [{ type: 'labelling', picture: { dataUrl: 'https://example.com/a.png', width: 1, height: 1 } }],
    })
    expect(w?.activities[0]).toMatchObject({ type: 'labelling', picture: null })
  })

  it('duplicates with new ids but the same seeds', () => {
    const w = everything()
    const copy = duplicateWorksheet(w, 9)
    expect(copy.id).not.toBe(w.id)
    expect(copy.title).toBe(`${w.title} (copy)`)
    expect(copy.activities.map((a) => a.seed)).toEqual(w.activities.map((a) => a.seed))
    expect(copy.activities.every((a, i) => a.id !== w.activities[i].id)).toBe(true)
    expect(upsert([w], copy).map((x) => x.id)).toEqual([copy.id, w.id])
    expect(upsert([w, copy], { ...w, title: 'New' })[0].title).toBe('New')
  })
})

describe('renderWorksheetPdf', () => {
  it('prints every activity type, worksheet then memo', async () => {
    const g = generateWorksheet(everything())
    const both = await PDFDocument.load(await renderWorksheetPdf(g, 'both'))
    const sheet = await PDFDocument.load(await renderWorksheetPdf(g, 'worksheet'))
    const memo = await PDFDocument.load(await renderWorksheetPdf(g, 'memo'))
    expect(sheet.getPageCount()).toBeGreaterThan(1)
    expect(both.getPageCount()).toBe(sheet.getPageCount() + memo.getPageCount())
    expect(both.getTitle()).toBe('Our solar system')
    expect(memo.getTitle()).toBe('Our solar system (memo)')
  }, 20_000)

  it('copes with an empty worksheet and with text the fonts cannot print', async () => {
    const w = newWorksheet(1, 'e')
    w.activities = []
    w.title = 'Ελληνικά ✓'
    expect((await PDFDocument.load(await renderWorksheetPdf(generateWorksheet(w)))).getPageCount()).toBe(2)
    w.activities = [activity('blanks', { text: '[日本] and [ok] 🙂' })]
    expect((await PDFDocument.load(await renderWorksheetPdf(generateWorksheet(w)))).getPageCount()).toBe(2)
  })

  it('runs a long activity onto more pages', async () => {
    const w = newWorksheet(1, 'long')
    w.activities = [
      activity('truefalse', {
        statements: Array.from({ length: 60 }, (_, i) => `T: Statement number ${i + 1} is true.`).join('\n'),
        corrections: true,
      }),
    ]
    expect(
      (await PDFDocument.load(await renderWorksheetPdf(generateWorksheet(w), 'worksheet'))).getPageCount(),
    ).toBeGreaterThan(2)
  })
})
