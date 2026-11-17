// Random groups with keep-apart and keep-together rules, an optional balance by tag, and locked groups.
import { shuffle, type Rng } from './random'

export interface GroupMember {
  key: string
  name: string
  tag?: string
}

/** A Group rule: these learners must all be in different groups, or all in the same one. */
export interface GroupRule {
  kind: 'apart' | 'together'
  keys: string[]
}

export interface GroupOptions {
  /** Make groups of about `value` learners, or exactly `value` groups. */
  by: 'size' | 'count'
  value: number
  rules?: readonly GroupRule[]
  /** Spread each tag (for example each level) evenly across the groups. */
  balanceTag?: boolean
  /** Groups kept exactly as they are, at their position in the result. */
  locked?: readonly { index: number; keys: readonly string[] }[]
}

export type GroupResult = { ok: true; groups: string[][]; notes: string[] } | { ok: false; message: string }

const ATTEMPTS = 400

/** How many groups the options ask for, for this many learners. */
export function groupCount(learners: number, by: GroupOptions['by'], value: number): number {
  if (learners === 0) return 0
  return by === 'size' ? Math.ceil(learners / value) : Math.min(value, learners)
}

/** Joins keys that must be together into clusters (union find). */
function clusters(keys: readonly string[], together: readonly string[][]): string[][] {
  const parent = new Map(keys.map((k) => [k, k]))
  const find = (k: string): string => {
    let root = k
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(k, root)
    return root
  }
  for (const rule of together) for (let i = 1; i < rule.length; i++) parent.set(find(rule[i]), find(rule[0]))
  const out = new Map<string, string[]>()
  for (const k of keys) {
    const root = find(k)
    out.set(root, [...(out.get(root) ?? []), k])
  }
  return [...out.values()]
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * Makes random groups. Rules are always kept; if they cannot be, the result says why instead.
 * Learners in locked groups stay put; only the others are shuffled into the remaining groups.
 */
export function makeGroups(members: readonly GroupMember[], options: GroupOptions, rng: Rng): GroupResult {
  const { by, value } = options
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, message: by === 'size' ? 'Choose a group size of 1 or more.' : 'Choose 1 or more groups.' }
  }
  if (members.length === 0) return { ok: false, message: 'There are no learners here today to put in groups.' }

  const byKey = new Map(members.map((m) => [m.key, m]))
  const name = (k: string) => byKey.get(k)?.name ?? k
  const notes: string[] = []
  const total = groupCount(members.length, by, value)

  // Locked groups keep the learners who are still here; they never move.
  const lockedKeys = new Set<string>()
  const locked = new Map<number, string[]>()
  for (const g of options.locked ?? []) {
    if (g.index < 0 || g.index >= total) continue
    const keys = g.keys.filter((k) => byKey.has(k) && !lockedKeys.has(k))
    keys.forEach((k) => lockedKeys.add(k))
    locked.set(g.index, keys)
  }
  const free = members.filter((m) => !lockedKeys.has(m.key)).map((m) => m.key)
  const freeSlots = Array.from({ length: total }, (_, i) => i).filter((i) => !locked.has(i))
  if (free.length > 0 && freeSlots.length === 0) {
    return {
      ok: false,
      message: 'Every group is locked, so there is nowhere to put the other learners. Unlock a group.',
    }
  }

  // Rules only count for learners who are here; a rule with one learner left does nothing.
  const freeSet = new Set(free)
  const apart: string[][] = []
  const together: string[][] = []
  for (const rule of options.rules ?? []) {
    const here = [...new Set(rule.keys)].filter((k) => byKey.has(k))
    if (here.length < 2) continue
    const inLocked = here.filter((k) => lockedKeys.has(k))
    const loose = here.filter((k) => freeSet.has(k))
    if (rule.kind === 'together') {
      const lockedGroups = new Set([...locked].filter(([, keys]) => keys.some((k) => inLocked.includes(k))))
      if (inLocked.length > 0 && (loose.length > 0 || lockedGroups.size > 1)) {
        notes.push(`${list(here.map(name))} could not be kept together because some of them are in a locked group.`)
      }
      if (loose.length >= 2) together.push(loose)
    } else {
      for (const keys of locked.values()) {
        const clash = keys.filter((k) => here.includes(k))
        if (clash.length > 1) notes.push(`${list(clash.map(name))} are in the same locked group.`)
      }
      if (loose.length >= 2) apart.push(loose)
    }
  }

  const slots = freeSlots.length
  for (const rule of apart) {
    if (rule.length > slots) {
      return {
        ok: false,
        message: `${list(rule.map(name))} must be kept apart, which needs at least ${rule.length} groups, but there ${slots === 1 ? 'is only 1' : `are only ${slots}`}. Make more groups or change the rule.`,
      }
    }
  }

  const units = clusters(free, together)
  const apartOf = new Map<string, Set<string>>()
  for (const rule of apart) {
    for (const k of rule) {
      const set = apartOf.get(k) ?? new Set<string>()
      for (const other of rule) if (other !== k) set.add(other)
      apartOf.set(k, set)
    }
  }
  for (const unit of units) {
    for (const k of unit) {
      const clash = unit.find((other) => apartOf.get(k)?.has(other))
      if (clash) {
        return {
          ok: false,
          message: `${name(k)} and ${name(clash)} are in a keep-together rule and a keep-apart rule. Remove one of the rules.`,
        }
      }
    }
  }

  const capacity = Math.ceil(free.length / Math.max(1, slots))
  const biggest = units.reduce((a, u) => (u.length > a.length ? u : a), [] as string[])
  if (biggest.length > capacity + 1) {
    return {
      ok: false,
      message: `${list(biggest.map(name))} must be kept together, which is ${biggest.length} learners, but the groups hold about ${capacity}. Make bigger groups or change the rule.`,
    }
  }

  const tagCount = new Map<string, number>()
  for (const k of free) {
    const tag = byKey.get(k)?.tag
    if (tag) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  }
  const balance = options.balanceTag === true && tagCount.size > 0

  const attempt = (cap: number): string[][] | null => {
    // Bigger clusters first (they are hardest to fit); then learners grouped by tag so each tag is dealt round.
    const order = shuffle(units, rng).sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length
      if (!balance) return 0
      const ta = byKey.get(a[0])?.tag ?? ''
      const tb = byKey.get(b[0])?.tag ?? ''
      return (tagCount.get(tb) ?? 0) - (tagCount.get(ta) ?? 0) || ta.localeCompare(tb)
    })
    const groups: string[][] = Array.from({ length: slots }, () => [])
    // A random tie-break order of groups for this attempt, so equal choices are not always the first group.
    const tieBreak = shuffle(
      groups.map((_, i) => i),
      rng,
    )
    for (const unit of order) {
      let best = -1
      let bestScore: number[] = []
      for (const g of tieBreak) {
        const group = groups[g]
        if (group.length + unit.length > cap) continue
        if (unit.some((k) => group.some((other) => apartOf.get(k)?.has(other)))) continue
        const tags = unit.map((k) => byKey.get(k)?.tag).filter((t): t is string => !!t)
        const sameTag = balance ? group.filter((o) => tags.includes(byKey.get(o)?.tag ?? '\u0000')).length : 0
        const score = [sameTag, group.length]
        if (best < 0 || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
          best = g
          bestScore = score
        }
      }
      if (best < 0) return null
      groups[best].push(...unit)
    }
    return groups
  }

  let made: string[][] | null = null
  for (let i = 0; i < ATTEMPTS && !made; i++) made = attempt(capacity)
  if (!made && units.some((u) => u.length > 1)) {
    for (let i = 0; i < ATTEMPTS && !made; i++) made = attempt(capacity + 1)
    if (made) notes.push('Some groups have one extra learner so the keep-together rules fit.')
  }
  if (!made) {
    return {
      ok: false,
      message: 'These rules cannot all be kept with this many groups. Try a different group size or fewer rules.',
    }
  }

  // Each group lists its learners in class order, which is easier to read out.
  const position = new Map(members.map((m, i) => [m.key, i]))
  const result: string[][] = []
  let next = 0
  for (let i = 0; i < total; i++) {
    const group = locked.get(i) ?? made[next++]
    result.push([...group].sort((a, b) => position.get(a)! - position.get(b)!))
  }
  return { ok: true, groups: result, notes }
}

/** The rules a set of groups breaks, as messages. Empty when every rule is kept. */
export function brokenRules(groups: readonly (readonly string[])[], rules: readonly GroupRule[]): string[] {
  const groupOf = new Map<string, number>()
  groups.forEach((g, i) => g.forEach((k) => groupOf.set(k, i)))
  const broken: string[] = []
  for (const rule of rules) {
    const placed = rule.keys.filter((k) => groupOf.has(k))
    const where = placed.map((k) => groupOf.get(k)!)
    if (rule.kind === 'together' && new Set(where).size > 1) broken.push(`together: ${placed.join(', ')}`)
    if (rule.kind === 'apart' && new Set(where).size < where.length) broken.push(`apart: ${placed.join(', ')}`)
  }
  return broken
}

export type GroupNameStyle = 'numbers' | 'colours' | 'fun'

/** Group colours with a swatch, in an order where neighbours look different. */
export const GROUP_COLOURS: readonly { name: string; hex: string }[] = [
  { name: 'Red', hex: '#d3212d' },
  { name: 'Blue', hex: '#2a6fd6' },
  { name: 'Green', hex: '#2f9e44' },
  { name: 'Yellow', hex: '#f2c418' },
  { name: 'Purple', hex: '#8a4fd1' },
  { name: 'Orange', hex: '#f07c1b' },
  { name: 'Pink', hex: '#e35d9c' },
  { name: 'Teal', hex: '#139c9c' },
  { name: 'Brown', hex: '#8b5a2b' },
  { name: 'Grey', hex: '#7b8494' },
  { name: 'Navy', hex: '#24346b' },
  { name: 'Lime', hex: '#8bc34a' },
]

export const FUN_NAMES: readonly string[] = [
  'Cheetahs',
  'Springboks',
  'Rhinos',
  'Elephants',
  'Lions',
  'Leopards',
  'Zebras',
  'Giraffes',
  'Meerkats',
  'Penguins',
  'Hippos',
  'Kudus',
  'Buffaloes',
  'Fish eagles',
  'Hornbills',
  'Pangolins',
  'Honey badgers',
  'Dassies',
  'Impalas',
  'Sunbirds',
]

/** The name of group `index` (from 0), with a colour swatch when the style is colours. */
export function groupName(style: GroupNameStyle, index: number): { name: string; colour?: string } {
  if (style === 'colours' && index < GROUP_COLOURS.length) {
    return { name: GROUP_COLOURS[index].name, colour: GROUP_COLOURS[index].hex }
  }
  if (style === 'fun' && index < FUN_NAMES.length) return { name: FUN_NAMES[index] }
  return { name: `Group ${index + 1}` }
}

/** The groups as plain text to paste into a message or document, one group per line. */
export function groupsAsText(groups: readonly (readonly string[])[], names: readonly string[]): string {
  return groups.map((g, i) => `${names[i]}: ${g.join(', ')}`).join('\n')
}
