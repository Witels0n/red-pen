import { describe, expect, it } from 'vitest'
import { gridSheets } from '../../src/grid/xlsx'
import {
  duplicateGrid,
  emptyRow,
  gridFileName,
  gridTitle,
  newGrid,
  type Grid,
  type QuestionRow,
} from '../../src/grid/core/model'
import { analyseNumbering, nextNumber, numberKey, numberParts } from '../../src/grid/core/numbering'
import { applyPaste, looksLikeCells, rowsFromCells, splitCells } from '../../src/grid/core/paste'
import { flagFor, flagText, summarise, topicNames } from '../../src/grid/core/summary'
import { defaultTaxonomy, mapLevelsByPosition, matchLevel, targetSum } from '../../src/grid/core/taxonomy'
import { savedTaxonomy, rememberTaxonomy, lastTaxonomyId } from '../../src/grid/settings'

function row(number: string, marks: number | null, level = '', topic = ''): QuestionRow {
  return { ...emptyRow(number), marks, level, topic }
}

function grid(rows: QuestionRow[], extra: Partial<Grid> = {}): Grid {
  return { ...newGrid(defaultTaxonomy('caps'), 0), rows, ...extra }
}

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(k: string) {
    return this.items.get(k) ?? null
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.items.delete(k)
  }
  setItem(k: string, v: string) {
    this.items.set(k, v)
  }
}

describe('taxonomies', () => {
  it('every built-in taxonomy has targets adding up to 100', () => {
    for (const id of ['caps', 'bloom', 'barrett', 'custom'] as const)
      expect(targetSum(defaultTaxonomy(id).levels)).toBe(100)
  })

  it('CAPS defaults to 30/40/20/10', () => {
    expect(defaultTaxonomy('caps').levels.map((l) => l.target)).toEqual([30, 40, 20, 10])
    expect(defaultTaxonomy('bloom').levels).toHaveLength(6)
  })

  it('matches typed levels by number or name', () => {
    const levels = defaultTaxonomy('caps').levels
    expect(matchLevel(levels, '2')).toBe('L2')
    expect(matchLevel(levels, 'L3')).toBe('L3')
    expect(matchLevel(levels, 'Level 4')).toBe('L4')
    expect(matchLevel(levels, 'knowledge')).toBe('L1')
    expect(matchLevel(levels, 'Routine')).toBe('L2')
    expect(matchLevel(levels, '9')).toBe('')
    expect(matchLevel(levels, 'nonsense')).toBe('')
  })

  it('maps levels by position when the taxonomy changes', () => {
    const map = mapLevelsByPosition(defaultTaxonomy('bloom').levels, defaultTaxonomy('caps').levels)
    expect(map.get('L2')).toBe('L2')
    expect(map.get('L6')).toBe('')
  })

  it('remembers the teacher targets per taxonomy, keeping built-in names', () => {
    const s = new MemoryStorage()
    const caps = defaultTaxonomy('caps')
    caps.levels[0].target = 25
    caps.levels[0].name = 'Changed'
    rememberTaxonomy(caps, s)
    const back = savedTaxonomy('caps', s)
    expect(back.levels[0]).toMatchObject({ name: 'Knowledge', target: 25 })
    expect(savedTaxonomy('bloom', s).levels[0].target).toBe(15)
    expect(lastTaxonomyId(s)).toBe('caps')

    const custom = { id: 'custom' as const, levels: [{ id: 'x', name: 'Mine', target: 100 }] }
    rememberTaxonomy(custom, s)
    expect(savedTaxonomy('custom', s).levels).toEqual(custom.levels)
    expect(lastTaxonomyId(s)).toBe('custom')
  })

  it('falls back to defaults when storage holds rubbish', () => {
    const s = new MemoryStorage()
    s.setItem('red-pen.grid.taxonomies', '{not json')
    expect(savedTaxonomy('caps', s).levels[1].target).toBe(40)
  })
})

describe('numbering', () => {
  it('reads nested numbers', () => {
    expect(numberParts('1.2.3')).toEqual(['1', '2', '3'])
    expect(numberParts(' Q1.2. ')).toEqual(['1', '2'])
    expect(numberParts('Question 3 (a)')).toEqual(['3', 'a'])
    expect(numberKey('')).toBe('')
  })

  it('subtotals every section and level of nesting', () => {
    const n = analyseNumbering([row('1.1', 2), row('1.2.1', 3), row('1.2.2', 4), row('2', 10), row('3.1', 5)])
    expect(n.sections.map((s) => [s.key, s.marks, s.depth])).toEqual([
      ['1', 9, 0],
      ['1.2', 7, 1],
      ['3', 5, 0],
    ])
    expect(n.questions).toEqual([
      { key: '1', marks: 9 },
      { key: '2', marks: 10 },
      { key: '3', marks: 5 },
    ])
    expect(n.counted).toHaveLength(5)
  })

  it('does not count a heading row twice and flags a heading whose marks differ', () => {
    const rows = [row('1', 12), row('1.1', 5), row('1.2', 5), row('2', 3)]
    const n = analyseNumbering(rows)
    expect(n.counted.map((r) => r.number)).toEqual(['1.1', '1.2', '2'])
    expect(n.sections[0]).toMatchObject({ key: '1', marks: 10, headingRowId: rows[0].id, lastRowId: rows[2].id })
    expect(n.mismatches).toEqual([{ label: '1', typed: 12, subtotal: 10 }])
  })

  it('finds duplicate numbers', () => {
    expect(analyseNumbering([row('1.1', 1), row('1.1', 2)]).duplicates).toEqual(['1.1'])
  })
})

describe('summarise', () => {
  const rows = [
    row('1', null),
    row('1.1', 15, 'L1', 'Algebra'),
    row('1.2', 15, 'L2', 'Algebra'),
    row('2.1', 25, 'L2', 'Geometry'),
    row('2.2', 20, 'L3', 'Geometry'),
    row('3', 25, 'L4', 'Geometry'),
  ]

  it('totals the paper and compares with the intended total', () => {
    const s = summarise(grid(rows, { intendedTotal: 150 }))
    expect(s.total).toBe(100)
    expect(s.difference).toBe(-50)
    expect(s.warnings[0]).toContain('50 short of the paper total of 150')
    expect(summarise(grid(rows, { intendedTotal: 100 })).difference).toBe(0)
  })

  it('gives marks and percentages per level against targets with flags', () => {
    const s = summarise(grid(rows))
    expect(s.levels.map((l) => [l.key, l.marks, l.percent, l.target, l.flag])).toEqual([
      ['L1', 15, 15, 30, 'under'],
      ['L2', 40, 40, 40, 'ok'],
      ['L3', 20, 20, 20, 'ok'],
      ['L4', 25, 25, 10, 'over'],
    ])
  })

  it('gives topics with optional targets and a level by topic matrix', () => {
    const s = summarise(
      grid(rows, {
        topics: [
          { name: 'Algebra', target: 40 },
          { name: 'Geometry', target: null },
          { name: 'Calculus', target: null },
        ],
      }),
    )
    expect(s.topics.map((t) => [t.name, t.marks, t.percent, t.flag])).toEqual([
      ['Algebra', 30, 30, 'under'],
      ['Geometry', 70, 70, 'none'],
      ['Calculus', 0, 0, 'none'],
    ])
    expect(s.matrix.topics).toEqual(['Algebra', 'Geometry', 'Calculus'])
    expect(s.matrix.levels).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(s.matrix.cells).toEqual([
      [15, 0, 0],
      [15, 25, 0],
      [0, 20, 0],
      [0, 25, 0],
    ])
    expect(s.matrix.levelTotals).toEqual([15, 40, 20, 25])
    expect(s.matrix.topicTotals).toEqual([30, 70, 0])
  })

  it('puts marks with no level or topic in their own bucket and warns', () => {
    const s = summarise(grid([row('1', 4, 'L1', 'A'), row('2', 6)]))
    expect(s.levels.at(-1)).toMatchObject({ key: '', name: 'No level', marks: 6, percent: 60, flag: 'none' })
    expect(s.topics.at(-1)).toMatchObject({ key: '', name: 'No topic', marks: 6 })
    expect(s.matrix.levels.at(-1)).toBe('')
    expect(s.matrix.topics).toEqual(['A', ''])
    expect(s.warnings).toContain('6 marks have no cognitive level.')
  })

  it('counts questions with no marks yet', () => {
    const s = summarise(grid([row('1', null, 'L1'), row('2', 3)]))
    expect(s.missingMarks).toBe(1)
    expect(s.warnings).toContain('1 question has no marks yet.')
  })

  it('warns when targets do not add up to 100', () => {
    const g = grid([row('1', 1, 'L1')])
    g.taxonomy.levels[0].target = 50
    expect(summarise(g).warnings).toContain('The level targets add up to 120%, not 100%.')
  })

  it('takes topic names from questions too, once each', () => {
    expect(
      topicNames({
        topics: [{ name: 'Algebra', target: null }],
        rows: [row('1', 1, '', 'algebra '), row('2', 1, '', 'Data')],
      }),
    ).toEqual(['Algebra', 'Data'])
  })
})

describe('flagFor', () => {
  it('allows the tolerance either way, inclusive', () => {
    expect(flagFor(35, 30, 5, 100)).toBe('ok')
    expect(flagFor(25, 30, 5, 100)).toBe('ok')
    expect(flagFor(35.1, 30, 5, 100)).toBe('over')
    expect(flagFor(24.9, 30, 5, 100)).toBe('under')
    expect(flagFor(31, 30, 0, 100)).toBe('over')
  })

  it('gives no flag without a target or marks', () => {
    expect(flagFor(10, null, 5, 100)).toBe('none')
    expect(flagFor(0, 30, 5, 0)).toBe('none')
  })

  it('describes the difference in points', () => {
    expect(flagText({ flag: 'over', percent: 25, target: 10 })).toBe('Over by 15 pts')
    expect(flagText({ flag: 'under', percent: 29, target: 30 })).toBe('Under by 1 pt')
    expect(flagText({ flag: 'ok', percent: 30, target: 30 })).toBe('On target')
    expect(flagText({ flag: 'none', percent: 30, target: null })).toBe('')
  })
})

describe('paste', () => {
  const levels = defaultTaxonomy('caps').levels

  it('reads spreadsheet rows, skipping a header row', () => {
    const cells = splitCells('No.\tMarks\tLevel\tTopic\r\n1.1\t3\tL1\tAlgebra\n1.2\t4,5\tRoutine\tGeometry\n\n')
    expect(looksLikeCells('1.1\t3')).toBe(true)
    expect(looksLikeCells('3')).toBe(false)
    const { rows, skippedHeader } = rowsFromCells(cells, levels)
    expect(skippedHeader).toBe(true)
    expect(rows).toEqual([
      { number: '1.1', marks: 3, level: 'L1', topic: 'Algebra' },
      { number: '1.2', marks: 4.5, level: 'L2', topic: 'Geometry' },
    ])
  })

  it('pastes a single column into the column it lands in', () => {
    const { rows } = rowsFromCells(splitCells('2\n3\n4'), levels, 1)
    expect(rows).toEqual([{ marks: 2 }, { marks: 3 }, { marks: 4 }])
    const existing = [row('1', null), row('2', null)]
    const after = applyPaste(existing, rows, 0)
    expect(after.map((r) => [r.number, r.marks])).toEqual([
      ['1', 2],
      ['2', 3],
      ['', 4],
    ])
    expect(after[0].id).toBe(existing[0].id)
  })
})

describe('grids', () => {
  it('names a grid after its subject, grade and paper', () => {
    const g = newGrid()
    expect(gridTitle(g)).toBe('Untitled grid')
    g.details = { ...g.details, subject: 'Mathematics', grade: '10', paper: 'Paper 1' }
    expect(gridTitle(g)).toBe('Mathematics Grade 10 Paper 1')
    expect(gridFileName(g, 'pdf')).toBe('Mathematics Grade 10 Paper 1 grid.pdf')
  })

  it('duplicates with new ids', () => {
    const g = newGrid()
    const copy = duplicateGrid(g, 5)
    expect(copy.id).not.toBe(g.id)
    expect(copy.rows[0].id).not.toBe(g.rows[0].id)
    expect(copy.rows.map((r) => r.number)).toEqual(g.rows.map((r) => r.number))
    expect(copy.details.paper).toBe('(copy)')
  })
})

describe('nextNumber', () => {
  it('counts on from the row above', () => {
    expect(nextNumber('')).toBe('1')
    expect(nextNumber('1.2')).toBe('1.3')
    expect(nextNumber('1.2.9')).toBe('1.2.10')
    expect(nextNumber('Q4')).toBe('Q5')
    expect(nextNumber('3(a)')).toBe('3(b)')
    expect(nextNumber('2.z')).toBe('')
  })
})

describe('gridSheets', () => {
  it('writes questions with heading subtotals, the summary and the matrix', () => {
    const g = grid([row('1', null), row('1.1', 2, 'L1', 'A'), row('1.2', 3, 'L2', 'B')])
    const [questions, summary, matrix] = gridSheets(g)
    const head = questions.rows.findIndex((r) => r[0] === 'Number')
    expect(questions.rows[head + 1]).toEqual(['1', null, '', '', '', '', '', 5])
    expect(questions.rows[head + 2].slice(0, 4)).toEqual(['1.1', 2, '1: Knowledge', 'A'])
    expect(summary.rows.find((r) => r[0] === '1: Knowledge')).toEqual(['1: Knowledge', 2, 40, 30, 'Over by 10 pts'])
    expect(matrix.rows.at(-1)).toEqual(['Total', 2, 3, 5])
  })
})
