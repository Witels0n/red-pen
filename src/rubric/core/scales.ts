// Level scales for a Rubric: the columns of an analytic rubric, or the rows of a holistic one.
// Levels run from the highest to the lowest. Every scale is only a starting point: the teacher
// can rename levels, change what each is worth, and add or remove them.

export type ScaleId = 'four' | 'three' | 'caps7' | 'solo' | 'marzano' | 'custom'

export interface ScaleLevel {
  name: string
  /** The share of a criterion's marks earned at (the top of) this level, in percent. */
  percent: number
  /** What work at this level looks like in general, shown as a prompt in empty descriptor boxes. */
  hint: string
}

export interface Scale {
  id: ScaleId
  name: string
  description: string
  /** Whether this scale is normally shown with a range of marks per level. */
  ranges: boolean
  levels: readonly ScaleLevel[]
}

export const SCALES: readonly Scale[] = [
  {
    id: 'four',
    name: 'Four levels: Advanced to Beginning',
    description: 'The everyday classroom scale. Four levels keep a teacher from sitting on the fence.',
    ranges: false,
    levels: [
      { name: 'Advanced', percent: 100, hint: 'Goes beyond what was asked, with insight and polish.' },
      { name: 'Proficient', percent: 75, hint: 'Does what was asked, accurately and completely.' },
      { name: 'Developing', percent: 50, hint: 'Does part of what was asked, with some errors or gaps.' },
      { name: 'Beginning', percent: 25, hint: 'Only a start has been made. Needs support.' },
    ],
  },
  {
    id: 'three',
    name: 'Three levels: Exceeds, Meets, Not yet',
    description: 'A quick scale for short tasks and younger learners.',
    ranges: false,
    levels: [
      { name: 'Exceeds', percent: 100, hint: 'More than the task asked for.' },
      { name: 'Meets', percent: 70, hint: 'What the task asked for.' },
      { name: 'Not yet', percent: 35, hint: 'Not what the task asked for yet.' },
    ],
  },
  {
    id: 'caps7',
    name: 'CAPS achievement levels 7 to 1',
    description: 'The seven national codes, each with its band of marks (Level 7 is 80 to 100%).',
    ranges: true,
    levels: [
      { name: '7 Outstanding', percent: 100, hint: 'Outstanding achievement: 80 to 100%.' },
      { name: '6 Meritorious', percent: 79, hint: 'Meritorious achievement: 70 to 79%.' },
      { name: '5 Substantial', percent: 69, hint: 'Substantial achievement: 60 to 69%.' },
      { name: '4 Adequate', percent: 59, hint: 'Adequate achievement: 50 to 59%.' },
      { name: '3 Moderate', percent: 49, hint: 'Moderate achievement: 40 to 49%.' },
      { name: '2 Elementary', percent: 39, hint: 'Elementary achievement: 30 to 39%.' },
      { name: '1 Not achieved', percent: 29, hint: 'Not achieved: 0 to 29%.' },
    ],
  },
  {
    id: 'solo',
    name: 'SOLO taxonomy (Biggs and Collis)',
    description: 'Levels describe how well the ideas in the work are connected, from none to a new generalisation.',
    ranges: false,
    levels: [
      {
        name: 'Extended abstract',
        percent: 100,
        hint: 'Takes the connected ideas further: generalises or applies them to something new.',
      },
      { name: 'Relational', percent: 75, hint: 'Links the ideas into a coherent whole.' },
      { name: 'Multistructural', percent: 50, hint: 'Several relevant ideas, but they are not connected.' },
      { name: 'Unistructural', percent: 25, hint: 'One relevant idea.' },
      { name: 'Prestructural', percent: 0, hint: 'Misses the point.' },
    ],
  },
  {
    id: 'marzano',
    name: 'Marzano proficiency scale 4.0 to 0.0',
    description: 'Levels are set against a learning target: 3.0 is the target itself and 4.0 goes beyond it.',
    ranges: false,
    levels: [
      {
        name: '4.0 Beyond the target',
        percent: 100,
        hint: 'Goes beyond what was taught, with deeper inferences and applications.',
      },
      { name: '3.0 Target', percent: 75, hint: 'No major errors or omissions in what was taught.' },
      {
        name: '2.0 Simpler content',
        percent: 50,
        hint: 'No major errors in the simpler details and processes, but errors in the more complex ones.',
      },
      {
        name: '1.0 With help',
        percent: 25,
        hint: 'With help, a partial grasp of the simpler and the more complex content.',
      },
      { name: '0.0 Not yet', percent: 0, hint: 'Even with help, no understanding or skill shown.' },
    ],
  },
  {
    id: 'custom',
    name: 'My own levels',
    description: 'Three plain levels to rename and add to.',
    ranges: false,
    levels: [
      { name: 'Level 3', percent: 100, hint: '' },
      { name: 'Level 2', percent: 65, hint: '' },
      { name: 'Level 1', percent: 30, hint: '' },
    ],
  },
]

export function scaleById(id: ScaleId): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]!
}

export function isScaleId(value: unknown): value is ScaleId {
  return SCALES.some((s) => s.id === value)
}
