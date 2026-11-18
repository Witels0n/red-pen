import { describe, expect, it } from 'vitest'
import { COGNITIVE } from '../../src/rubric/core/cognitive'
import {
  STYLES,
  TARGET,
  bandLabel,
  checkRubric,
  cognitiveShares,
  criterionMarks,
  criterionShares,
  levelBands,
  levelsFromScale,
  newRubric,
  parseRubric,
  parseSavedRubrics,
  rubricTotal,
  scaleToTotal,
  shareEvenly,
  upsertSaved,
} from '../../src/rubric/core/model'
import { SCALES } from '../../src/rubric/core/scales'

describe('newRubric', () => {
  it('starts every style with an example that has nothing wrong with it', () => {
    for (const { id } of STYLES) {
      const check = checkRubric(newRubric(id))
      expect(check.errors, id).toEqual([])
      expect(check.warnings, id).toEqual([])
    }
  })

  it('gives levels only to the styles that have them', () => {
    expect(newRubric('analytic').levels.map((l) => l.name)).toEqual([
      'Advanced',
      'Proficient',
      'Developing',
      'Beginning',
    ])
    expect(newRubric('holistic').criteria).toHaveLength(1)
    expect(newRubric('single-point').levels).toEqual([])
    expect(newRubric('single-point').criteria[0]!.descriptors[TARGET]).toContain('clear position')
    expect(newRubric('checklist').levels).toEqual([])
  })

  it('starts from any scale, with bands of marks where the scale has them', () => {
    const caps = newRubric('analytic', 'caps7')
    expect(caps.levels).toHaveLength(7)
    expect(caps.showRanges).toBe(true)
    expect(newRubric('analytic', 'solo').levels.map((l) => l.name)).toEqual([
      'Extended abstract',
      'Relational',
      'Multistructural',
      'Unistructural',
      'Prestructural',
    ])
    expect(newRubric('analytic', 'marzano').levels[1]!.name).toBe('3.0 Target')
  })
})

describe('scales and taxonomies', () => {
  it('run from the highest level to the lowest, each worth 0 to 100%', () => {
    for (const scale of SCALES) {
      const worth = scale.levels.map((l) => l.percent)
      expect(worth[0], scale.id).toBe(100)
      expect(
        [...worth].sort((a, b) => b - a),
        scale.id,
      ).toEqual(worth)
      expect(new Set(scale.levels.map((l) => l.name)).size, scale.id).toBe(scale.levels.length)
      expect(levelsFromScale(scale.id)).toHaveLength(scale.levels.length)
    }
  })

  it('have no em dashes in any text', () => {
    expect(JSON.stringify([SCALES, COGNITIVE, STYLES])).not.toContain('—')
  })
})

describe('weights', () => {
  it('reads weights as marks or as percentages of the total', () => {
    const r = newRubric('analytic')
    expect(criterionMarks(r)).toEqual([8, 4, 4, 4])
    expect(rubricTotal(r)).toBe(20)
    expect(criterionShares(r)).toEqual([40, 20, 20, 20])
    r.weightMode = 'percent'
    r.total = 50
    r.criteria.forEach((c, i) => (c.weight = [40, 30, 20, 10][i]!))
    expect(criterionMarks(r)).toEqual([20, 15, 10, 5])
    expect(rubricTotal(r)).toBe(50)
  })

  it('counts criteria when a single-point rubric gives no marks', () => {
    const r = newRubric('single-point')
    r.scored = false
    expect(rubricTotal(r)).toBe(3)
  })

  it('shares a total evenly in whole marks', () => {
    expect(shareEvenly(3, 10)).toEqual([4, 3, 3])
    expect(shareEvenly(4, 100)).toEqual([25, 25, 25, 25])
    expect(shareEvenly(0, 10)).toEqual([])
  })

  it('scales weights in proportion to exactly the total asked for', () => {
    expect(scaleToTotal([8, 4, 4, 4], 50)).toEqual([20, 10, 10, 10])
    const odd = scaleToTotal([3, 3, 3], 20)
    expect(odd).toEqual([7, 7, 6])
    expect(odd.reduce((t, v) => t + v, 0)).toBe(20)
    expect(scaleToTotal([1, 2], 7.5)).toEqual([2.5, 5])
    expect(scaleToTotal([0, 0], 10)).toEqual([5, 5])
  })

  it('spreads the marks across the cognitive levels in use', () => {
    const r = newRubric('analytic')
    r.taxonomy = 'bloom'
    r.criteria[0]!.cognitive = 'Analyse'
    r.criteria[1]!.cognitive = 'Apply'
    expect(cognitiveShares(r)).toEqual([
      { level: 'Apply', marks: 4, percent: 20 },
      { level: 'Analyse', marks: 8, percent: 40 },
      { level: 'No level', marks: 8, percent: 40 },
    ])
  })
})

describe('levelBands', () => {
  const four = levelsFromScale('four')

  it('gives each level one mark without ranges', () => {
    expect(levelBands(8, four, false).map(bandLabel)).toEqual(['8', '6', '4', '2'])
    expect(levelBands(5, four, false).map(bandLabel)).toEqual(['5', '3.75', '2.5', '1.25'])
  })

  it('gives each level a band of whole marks with ranges, down to 0', () => {
    expect(levelBands(10, levelsFromScale('caps7'), true).map(bandLabel)).toEqual([
      '9-10',
      '8',
      '7',
      '6',
      '5',
      '4',
      '0-3',
    ])
    expect(levelBands(20, four, true).map(bandLabel)).toEqual(['16-20', '11-15', '6-10', '0-5'])
  })

  it('follows what each level is worth, not the order it is shown in', () => {
    const reversed = [...four].reverse()
    expect(levelBands(20, reversed, true).map(bandLabel)).toEqual(['0-5', '6-10', '11-15', '16-20'])
  })
})

describe('checkRubric', () => {
  it('stops a rubric with nothing to judge, or with unnamed or unweighted criteria', () => {
    const r = newRubric('analytic')
    r.criteria = []
    expect(checkRubric(r).errors).toContain('Add at least one criterion.')
    const named = newRubric('analytic')
    named.criteria[0]!.name = ' '
    named.criteria[1]!.weight = 0
    expect(checkRubric(named).errors).toEqual(['Criterion 1 needs a name.', 'Structure needs marks above 0.'])
  })

  it('checks the levels', () => {
    const r = newRubric('analytic')
    r.levels = r.levels.slice(0, 1)
    expect(checkRubric(r).errors).toContain('Add at least two levels.')
    const same = newRubric('analytic')
    same.levels[1]!.name = 'advanced'
    same.levels[2]!.percent = 140
    expect(checkRubric(same).errors).toEqual([
      'Developing must be worth from 0% to 100% of the marks.',
      'Two levels have the same name.',
    ])
    const low = newRubric('analytic')
    low.levels[0]!.percent = 90
    expect(checkRubric(low).warnings).toContain('No level is worth 100%, so nobody can get full marks.')
  })

  it('warns about percentages that do not add up and descriptors still to write', () => {
    const r = newRubric('analytic')
    r.weightMode = 'percent'
    r.criteria[0]!.descriptors = {}
    expect(checkRubric(r).warnings).toEqual([
      '4 descriptor boxes are still empty.',
      'The weights add up to 20%, not 100%.',
    ])
  })

  it('warns when a criterion has too few marks for bands of whole marks', () => {
    const r = newRubric('analytic', 'caps7')
    r.criteria.forEach((c) => (c.weight = 10))
    r.criteria[2]!.weight = 4
    expect(checkRubric(r).warnings.filter((w) => w.includes('band'))).toEqual([
      'Delivery has too few marks for every level to have its own band of whole marks.',
    ])
  })

  it('asks for no marks on a single-point rubric that gives none', () => {
    const r = newRubric('single-point')
    r.scored = false
    r.criteria.forEach((c) => (c.weight = 0))
    expect(checkRubric(r).errors).toEqual([])
  })
})

describe('saving', () => {
  it('reads a rubric back as it was', () => {
    for (const { id } of STYLES) {
      const r = newRubric(id)
      expect(parseRubric(JSON.parse(JSON.stringify(r))), id).toEqual(r)
    }
  })

  it('refuses what is not a rubric and drops what it does not know', () => {
    expect(parseRubric(null)).toBeNull()
    expect(parseRubric({ version: 2, style: 'analytic', criteria: [] })).toBeNull()
    expect(parseRubric({ version: 1, style: 'essay', criteria: [] })).toBeNull()
    const r = newRubric('analytic')
    r.taxonomy = 'bloom'
    const raw = JSON.parse(JSON.stringify(r)) as Record<string, any>
    raw.extra = 'x'
    raw.criteria[0].cognitive = 'Guess'
    raw.criteria[0].descriptors.nowhere = 'lost'
    raw.reportOutOf = 'ten'
    const back = parseRubric(raw)!
    expect(back).not.toHaveProperty('extra')
    expect(back.criteria[0]!.cognitive).toBeNull()
    expect(back.criteria[0]!.descriptors).not.toHaveProperty('nowhere')
    expect(back.reportOutOf).toBeNull()
  })

  it('keeps saved rubrics newest first, one per name', () => {
    const a = { name: 'Essay', savedAt: 1, rubric: newRubric('analytic') }
    const b = { name: 'Oral', savedAt: 2, rubric: newRubric('holistic') }
    const again = { name: ' essay ', savedAt: 3, rubric: newRubric('checklist') }
    expect(upsertSaved(upsertSaved([a], b), again).map((s) => s.name)).toEqual([' essay ', 'Oral'])
    expect(parseSavedRubrics([a, { name: 'Broken', rubric: {} }, 'nonsense'])).toHaveLength(1)
    expect(parseSavedRubrics('nothing')).toEqual([])
  })
})
