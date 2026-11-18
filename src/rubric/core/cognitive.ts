// Taxonomies for tagging each criterion of a Rubric with the kind of thinking it asks for.
// The Rubric builder then shows how the marks are spread across the levels.

export type CognitiveId = 'none' | 'bloom' | 'marzano' | 'webb' | 'solo' | 'caps'

export interface CognitiveTaxonomy {
  id: CognitiveId
  name: string
  /** From the least to the most demanding. */
  levels: readonly string[]
}

export const COGNITIVE: readonly CognitiveTaxonomy[] = [
  { id: 'none', name: 'No cognitive levels', levels: [] },
  {
    id: 'bloom',
    name: "Bloom's revised taxonomy",
    levels: ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'],
  },
  {
    id: 'marzano',
    name: "Marzano's New Taxonomy",
    levels: [
      'Retrieval',
      'Comprehension',
      'Analysis',
      'Knowledge utilisation',
      'Metacognition',
      'Self-system thinking',
    ],
  },
  {
    id: 'webb',
    name: "Webb's Depth of Knowledge",
    levels: [
      'DOK 1: Recall and reproduction',
      'DOK 2: Skills and concepts',
      'DOK 3: Strategic thinking',
      'DOK 4: Extended thinking',
    ],
  },
  {
    id: 'solo',
    name: 'SOLO taxonomy',
    levels: ['Unistructural', 'Multistructural', 'Relational', 'Extended abstract'],
  },
  {
    id: 'caps',
    name: 'CAPS cognitive levels',
    levels: ['Knowledge', 'Routine procedures', 'Complex procedures', 'Problem solving'],
  },
]

export function cognitiveById(id: CognitiveId): CognitiveTaxonomy {
  return COGNITIVE.find((t) => t.id === id) ?? COGNITIVE[0]!
}

export function isCognitiveId(value: unknown): value is CognitiveId {
  return COGNITIVE.some((t) => t.id === value)
}
