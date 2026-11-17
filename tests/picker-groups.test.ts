import { describe, expect, it } from 'vitest'
import {
  brokenRules,
  groupCount,
  groupName,
  groupsAsText,
  makeGroups,
  type GroupMember,
  type GroupRule,
} from '../src/picker/groups'
import { seededRng } from '../src/picker/random'

const NAMES = [
  'Thandi Mokoena',
  'Sipho Dlamini',
  'Ayesha Patel',
  'Lerato Nkosi',
  'Pieter van Wyk',
  'Zanele Khumalo',
  'Johan Botha',
  'Naledi Mahlangu',
  'Ravi Naidoo',
  'Kagiso Molefe',
  'Emma Smith',
  'Bongani Zulu',
  'Fatima Adams',
  'Liam Jacobs',
  'Nomsa Sithole',
  'Anika Pillay',
  'Tshepo Mabaso',
  'Chloe Daniels',
  'Musa Ndlovu',
  'Grace Mthembu',
  'Xolani Cele',
  'Megan Fourie',
  'Lwazi Shabalala',
  'Priya Govender',
  'Sello Radebe',
  'Hannah Meyer',
  'Mpho Tau',
  'Jessica Brown',
  'Ayanda Mkhize',
  'David Nel',
]

const members = (n: number, tags?: string[]): GroupMember[] =>
  NAMES.slice(0, n).map((name, i) => ({ key: `k${i}`, name, ...(tags ? { tag: tags[i % tags.length] } : {}) }))

function ok(result: ReturnType<typeof makeGroups>): string[][] {
  if (!result.ok) throw new Error(result.message)
  return result.groups
}

describe('makeGroups', () => {
  it('makes groups of a size, no group bigger than asked, and uses everyone once', () => {
    const groups = ok(makeGroups(members(30), { by: 'size', value: 4 }, seededRng(1)))
    expect(groups).toHaveLength(8)
    expect(groups.map((g) => g.length).sort()).toEqual([3, 3, 4, 4, 4, 4, 4, 4])
    expect(groups.flat().sort()).toEqual(
      members(30)
        .map((m) => m.key)
        .sort(),
    )
  })

  it('makes a number of groups with sizes at most one apart', () => {
    const groups = ok(makeGroups(members(10), { by: 'count', value: 3 }, seededRng(2)))
    expect(groups.map((g) => g.length).sort()).toEqual([3, 3, 4])
    expect(ok(makeGroups(members(2), { by: 'count', value: 5 }, seededRng(2)))).toHaveLength(2)
    expect(groupCount(25, 'size', 5)).toBe(5)
  })

  it('shuffles: different seeds give different groups', () => {
    const a = ok(makeGroups(members(20), { by: 'size', value: 4 }, seededRng(1)))
    const b = ok(makeGroups(members(20), { by: 'size', value: 4 }, seededRng(99)))
    expect(a).not.toEqual(b)
  })

  it('keeps every rule over many shuffles', () => {
    const rules: GroupRule[] = [
      { kind: 'apart', keys: ['k0', 'k1', 'k2'] },
      { kind: 'apart', keys: ['k3', 'k4'] },
      { kind: 'together', keys: ['k5', 'k6'] },
      { kind: 'together', keys: ['k6', 'k7'] },
      { kind: 'together', keys: ['k0', 'k8'] },
    ]
    for (let seed = 0; seed < 50; seed++) {
      const groups = ok(makeGroups(members(24), { by: 'size', value: 4, rules }, seededRng(seed)))
      expect(brokenRules(groups, rules)).toEqual([])
      expect(groups.flat()).toHaveLength(24)
    }
  })

  it('balances a tag across the groups', () => {
    const levels = ['A', 'A', 'B', 'B', 'C', 'C']
    for (let seed = 0; seed < 20; seed++) {
      const list = members(24, levels)
      const tagOf = new Map(list.map((m) => [m.key, m.tag]))
      const groups = ok(makeGroups(list, { by: 'count', value: 4, balanceTag: true }, seededRng(seed)))
      for (const g of groups) {
        for (const level of ['A', 'B', 'C']) expect(g.filter((k) => tagOf.get(k) === level)).toHaveLength(2)
      }
    }
  })

  it('keeps locked groups as they are and shuffles the rest', () => {
    const locked = [{ index: 1, keys: ['k0', 'k1', 'k2'] }]
    for (let seed = 0; seed < 10; seed++) {
      const groups = ok(makeGroups(members(12), { by: 'size', value: 3, locked }, seededRng(seed)))
      expect(groups[1]).toEqual(['k0', 'k1', 'k2'])
      expect(groups).toHaveLength(4)
      expect(groups.flat().sort()).toEqual(
        members(12)
          .map((m) => m.key)
          .sort(),
      )
    }
  })

  it('drops absent learners from a locked group', () => {
    const groups = ok(
      makeGroups(
        members(6),
        { by: 'count', value: 2, locked: [{ index: 0, keys: ['k0', 'gone', 'k1'] }] },
        seededRng(1),
      ),
    )
    expect(groups[0]).toEqual(['k0', 'k1'])
  })

  it('says clearly when keep-apart needs more groups than there are', () => {
    const result = makeGroups(
      members(6),
      { by: 'count', value: 2, rules: [{ kind: 'apart', keys: ['k0', 'k1', 'k2'] }] },
      seededRng(1),
    )
    expect(result).toEqual({
      ok: false,
      message:
        'Thandi Mokoena, Sipho Dlamini and Ayesha Patel must be kept apart, which needs at least 3 groups, but there are only 2. Make more groups or change the rule.',
    })
  })

  it('says clearly when a rule is both together and apart', () => {
    const result = makeGroups(
      members(6),
      {
        by: 'count',
        value: 2,
        rules: [
          { kind: 'together', keys: ['k0', 'k1'] },
          { kind: 'apart', keys: ['k1', 'k0'] },
        ],
      },
      seededRng(1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('keep-together rule and a keep-apart rule')
  })

  it('says clearly when a keep-together group is too big', () => {
    const result = makeGroups(
      members(12),
      { by: 'size', value: 3, rules: [{ kind: 'together', keys: ['k0', 'k1', 'k2', 'k3', 'k4'] }] },
      seededRng(1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('which is 5 learners, but the groups hold about 3')
  })

  it('lets a group take one extra learner when keep-together clusters do not fit exactly, and says so', () => {
    const rules: GroupRule[] = [
      { kind: 'together', keys: ['k0', 'k1'] },
      { kind: 'together', keys: ['k2', 'k3'] },
      { kind: 'together', keys: ['k4', 'k5'] },
    ]
    const result = makeGroups(members(6), { by: 'count', value: 2, rules }, seededRng(1))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(brokenRules(result.groups, rules)).toEqual([])
      expect(result.notes).toContain('Some groups have one extra learner so the keep-together rules fit.')
    }
  })

  it('ignores rules about learners who are not here', () => {
    const result = makeGroups(
      members(4),
      { by: 'count', value: 1, rules: [{ kind: 'apart', keys: ['k0', 'absent'] }] },
      seededRng(1),
    )
    expect(result.ok).toBe(true)
  })

  it('refuses nonsense', () => {
    expect(makeGroups(members(4), { by: 'size', value: 0 }, seededRng(1)).ok).toBe(false)
    expect(makeGroups([], { by: 'size', value: 3 }, seededRng(1))).toEqual({
      ok: false,
      message: 'There are no learners here today to put in groups.',
    })
    const allLocked = makeGroups(
      members(4),
      { by: 'count', value: 1, locked: [{ index: 0, keys: ['k0'] }] },
      seededRng(1),
    )
    expect(allLocked.ok).toBe(false)
  })
})

describe('group names and text', () => {
  it('names groups by number, colour or fun name, falling back to numbers', () => {
    expect(groupName('numbers', 0)).toEqual({ name: 'Group 1' })
    expect(groupName('colours', 1)).toEqual({ name: 'Blue', colour: '#2a6fd6' })
    expect(groupName('fun', 0)).toEqual({ name: 'Cheetahs' })
    expect(groupName('colours', 40)).toEqual({ name: 'Group 41' })
  })

  it('writes groups as text, one per line', () => {
    expect(groupsAsText([['Thandi', 'Sipho'], ['Ayesha']], ['Red', 'Blue'])).toBe('Red: Thandi, Sipho\nBlue: Ayesha')
  })
})
