import { describe, expect, it } from 'vitest'
import {
  classLearners,
  numberedLearners,
  parseOptions,
  parsePastedNames,
  presentLearners,
  tagsInUse,
} from '../src/picker/roster'

describe('parsePastedNames', () => {
  it('reads one name per line and skips blank lines', () => {
    const { learners } = parsePastedNames('Thandi Mokoena\n\n  Sipho   Dlamini \r\nAyesha Patel')
    expect(learners.map((l) => l.name)).toEqual(['Thandi Mokoena', 'Sipho Dlamini', 'Ayesha Patel'])
    expect(new Set(learners.map((l) => l.key)).size).toBe(3)
  })

  it('reads a second column as a tag and skips a header row', () => {
    const { learners, tagTitle } = parsePastedNames('Name\tLevel\nThandi Mokoena\t3\nSipho Dlamini\t5\nAyesha Patel')
    expect(tagTitle).toBe('Level')
    expect(learners).toEqual([
      { key: 'p2', name: 'Thandi Mokoena', tag: '3' },
      { key: 'p3', name: 'Sipho Dlamini', tag: '5' },
      { key: 'p4', name: 'Ayesha Patel' },
    ])
  })

  it('accepts commas or semicolons too', () => {
    expect(parsePastedNames('Lerato Nkosi, A\nPieter van Wyk; B').learners.map((l) => l.tag)).toEqual(['A', 'B'])
  })
})

describe('other sources', () => {
  it('numbers 1 to N', () => {
    expect(numberedLearners(3).map((l) => l.name)).toEqual(['1', '2', '3'])
    expect(numberedLearners(500)).toHaveLength(99)
  })

  it('uses Class list names, or the Learner ID when there is no name', () => {
    const list = {
      id: 'x',
      name: 'Grade 8A',
      idDigits: 2,
      learners: [{ id: '01', name: 'Zanele Khumalo' }, { id: '02' }],
      createdAt: 0,
      updatedAt: 0,
    }
    expect(classLearners(list)).toEqual([
      { key: 'c01', name: 'Zanele Khumalo' },
      { key: 'c02', name: 'Learner 02' },
    ])
  })

  it('leaves out absent learners and lists tags by how common they are', () => {
    const learners = parsePastedNames('A\tx\nB\ty\nC\ty').learners
    expect(presentLearners(learners, new Set(['p1'])).map((l) => l.name)).toEqual(['B', 'C'])
    expect(tagsInUse(learners)).toEqual(['y', 'x'])
  })

  it('reads custom wheel options, dropping blanks and repeats', () => {
    expect(parseOptions('Yes\n\nNo\nyes\n Maybe ')).toEqual(['Yes', 'No', 'Maybe'])
  })
})
