// Cognitive level taxonomies for a Question paper grid, each with a target share of the paper's marks.

export type TaxonomyId = 'caps' | 'bloom' | 'barrett' | 'custom'

export interface Level {
  /** Stable within a taxonomy: "L1", "L2"... for the built-in ones. */
  id: string
  name: string
  /** Target percentage of the paper's marks. */
  target: number
}

export interface Taxonomy {
  id: TaxonomyId
  levels: Level[]
}

export const TAXONOMY_NAMES: Record<TaxonomyId, string> = {
  caps: 'CAPS cognitive levels',
  bloom: "Bloom's revised taxonomy",
  barrett: "Barrett's taxonomy (comprehension)",
  custom: 'Custom levels',
}

export const TAXONOMY_IDS: readonly TaxonomyId[] = ['caps', 'bloom', 'barrett', 'custom']

const preset = (names: string[], targets: number[]): Level[] =>
  names.map((name, i) => ({ id: `L${i + 1}`, name, target: targets[i] }))

/** The built-in levels with sensible default targets (each set adds up to 100). */
export function defaultTaxonomy(id: TaxonomyId): Taxonomy {
  switch (id) {
    case 'caps':
      return {
        id,
        levels: preset(['Knowledge', 'Routine procedures', 'Complex procedures', 'Problem solving'], [30, 40, 20, 10]),
      }
    case 'bloom':
      return {
        id,
        levels: preset(['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'], [15, 20, 25, 20, 10, 10]),
      }
    case 'barrett':
      return {
        id,
        levels: preset(
          ['Literal comprehension', 'Reorganisation', 'Inferential comprehension', 'Evaluation', 'Appreciation'],
          [20, 20, 40, 10, 10],
        ),
      }
    case 'custom':
      return { id, levels: preset(['Lower order', 'Middle order', 'Higher order'], [30, 50, 20]) }
  }
}

/** "Level 2: Routine procedures". */
export function levelLabel(levels: readonly Level[], id: string): string {
  const i = levels.findIndex((l) => l.id === id)
  return i < 0 ? 'No level' : `Level ${i + 1}: ${levels[i].name}`
}

export function targetSum(levels: readonly Level[]): number {
  return Math.round(levels.reduce((sum, l) => sum + (Number.isFinite(l.target) ? l.target : 0), 0) * 100) / 100
}

/**
 * Finds the level a teacher typed or pasted: a number ("2", "L2", "Level 2") or a level's name
 * (or the start of it, ignoring case). Returns '' when nothing matches.
 */
export function matchLevel(levels: readonly Level[], typed: string): string {
  const s = typed.trim().toLowerCase()
  if (!s) return ''
  const n = /^(?:level|lvl|l)?\s*(\d+)$/.exec(s)
  if (n) return levels[Number(n[1]) - 1]?.id ?? ''
  const exact = levels.find((l) => l.name.toLowerCase() === s)
  if (exact) return exact.id
  return levels.find((l) => l.name.toLowerCase().startsWith(s) || s.startsWith(l.name.toLowerCase()))?.id ?? ''
}

/**
 * When a grid moves to another taxonomy, each question keeps its level by position (Level 2 stays
 * Level 2). Questions on a level the new taxonomy does not have lose their level.
 */
export function mapLevelsByPosition(from: readonly Level[], to: readonly Level[]): Map<string, string> {
  const map = new Map<string, string>()
  from.forEach((l, i) => map.set(l.id, to[i]?.id ?? ''))
  return map
}
