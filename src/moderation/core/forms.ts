// The wording of the Gauteng moderation tools (Annexures J1, J2 and J3), and the keys under which
// a filled-in form keeps what the teacher typed. Text between **double asterisks** prints bold.

/** Everything typed into one form, by field key. Dates are kept as yyyy-mm-dd. */
export type Values = Record<string, string>

export type FormId = 'j1' | 'j2' | 'j3'

export interface FormInfo {
  id: FormId
  /** The label printed at the top right of the form. */
  annexure: string
  title: string
  /** The start of the download's file name. */
  fileStem: string
}

export const FORMS: Record<FormId, FormInfo> = {
  j1: { id: 'j1', annexure: 'Annexure J 1', title: 'Pre-assessment moderation tool', fileStem: 'J1 Pre-moderation' },
  j2: { id: 'j2', annexure: 'Annexure J 2', title: 'Post assessment moderation tool', fileStem: 'J2 Post-moderation' },
  j3: {
    id: 'j3',
    annexure: 'Annexure J 3',
    title: 'Evidence of school moderation',
    fileStem: 'J3 Evidence of moderation',
  },
}

export interface Criterion {
  /** The number printed beside it. Some J1 criteria have none on the official form. */
  no: string
  text: string
}

export interface Section {
  title: string
  rows: Criterion[]
}

const plain = (texts: string[]): Criterion[] => texts.map((text) => ({ no: '', text }))
const numbered = (texts: string[]): Criterion[] => texts.map((text, i) => ({ no: `${i + 1}.`, text }))

export const J1_SECTIONS: readonly Section[] = [
  {
    title: '1. TECHNICAL CRITERIA',
    rows: [
      {
        no: '1.1',
        text: 'Cover page: Name of school, subject, time allocation, grade, task description, mark allocation, examiner, moderator, number of pages',
      },
      { no: '1.2', text: 'Clearly specified and unambiguous instructions' },
      { no: '1.3', text: 'Correct numbering of questions' },
      { no: '1.4', text: 'Appropriate font size and type throughout the task' },
      {
        no: '',
        text: 'Mark allocations (marks per question / instruction, after each sub section, marks additions and correct totals)',
      },
      { no: '', text: 'The quality of illustrations, graphs, tables, drawings, pictures etc.' },
    ],
  },
  {
    title: '2. CONTENT COVERAGE AND COGNITIVE DEMANDS',
    rows: plain([
      'Content coverage of the task as prescribed in the CAPS',
      'The weighting of the content as prescribed by the CAPS',
      'Appropriate distribution of cognitive levels as prescribed by CAPS.',
      'The task allows for creative responses from students',
      'Choice questions: (equal level of difficulty where relevant)',
      'Scaffolding of questions from simple to complex',
      'Correlation between mark allocation, level of difficulty and time',
    ]),
  },
  {
    title: '3. MARKING GUIDELINE',
    rows: plain([
      'Efficiency of marking guideline in terms of sufficient alternatives, allowance of consistent marking.',
      'Correlation of mark allocation on the question paper and on the marking guideline.',
    ]),
  },
  {
    title: '4. LANGUAGE',
    rows: plain([
      'The use of subject terminology (jargon)',
      'Appropriateness of the language to the level of learners',
      'Evidence of bias in terms of gender issues, race, cultural issues, and provincial and regional bias',
    ]),
  },
]

export const J1_NOTE =
  'N.B: This tool must be used by the DH/Subject Specialist to moderate tasks prior to their administration'
export const J1_LEAD =
  'Comment on the quality of each of the following criteria for determining the quality of standards applied on the task.'
export const J1_QUESTION = 'Does the task meet all the requirements to declare it fair, reliable and valid?'
export const J1_DECISIONS = [
  { id: 'approved', word: 'Approved' },
  { id: 'conditional', word: 'conditionally approved' },
  { id: 'disapproved', word: 'disapproved' },
] as const

/** The sections of J2 that are a list of quality indicators, each with a comment. */
export const J2_SECTIONS: readonly Section[] = [
  {
    title: 'TECHNICAL ASPECTS',
    rows: numbered([
      'The question paper is complete with the marking guideline and assessment grid analysis.',
      'The cover page has all the relevant details such as subject, grade, duration, date, marks allocation, and number of pages.',
      'Instructions to candidates are clearly specified and unambiguous',
      'Mark allocation is clearly indicated per question.',
      'The mark allocation on the question paper is the same as on the marking guideline.',
      'The quality of illustration, pictures, graphs, diagrams.',
      'The marking guideline is efficient in terms of sufficient alternatives and allows consistent marking.',
    ]),
  },
  {
    title: 'STANDARD OF THE TEST',
    rows: numbered([
      'The task assesses all specific core content and skills that should be covered in this term as per the ATP.',
      'The distribution of different cognitive levels as per policy. Indicate the distribution.',
      'Different types of questions used (Multiple choice, matching type, missing words, open-ended, etc.)',
      'The correct terminology of the subject was used to design the test',
      'The language used is appropriate for the level of learners.',
    ]),
  },
  {
    title: 'MARKING',
    rows: numbered([
      'Quality of marking by the teacher. (Consistency, accountability of ticks, relevance of marking tool)',
      'Marking of all sections of the task. Signature and dating of the tasks during marking',
      'Compliance to marking standards as outlined in the marking guideline (e.g., writing of subtotals)',
      'Evidence of extended opportunities to learners who did not submit tasks due to valid reason.',
      "Accuracy of calculation of marks on each learner's task.",
      'Incidence of lenient marking, global marking or unmarked questions but marks awarded to learners (be specific)',
      'Evidence of feedback (to teachers, learners, DH) and its possible impact on the improvement of SBA.',
      'Performance analysis of each task is done by the teacher',
      'Any other comment on Marking.',
    ]),
  },
  {
    title: 'RECORDING',
    rows: numbered([
      'The use of SA SAMS working marksheets and the patch',
      'Accuracy of transference of marks from learner evidence of work to the SA SAMS marksheet.',
      'Evidence of learners who missed SBA task is provided in the teacher file.',
    ]),
  },
  {
    title: 'LEARNER PERFORMANCE',
    rows: numbered([
      'The quality and standard of learner responses to each question type.',
      'The influence of standard of the test on the performance of the learners.',
      'Correlation between mark allocation by the teacher and learner responses',
      'Do you think the style of marking and recording may have had impact on the performance of learners? Elaborate',
      'The learner performance in the task is comparable to performance in other formal tasks (consult the **SASAMS** working marksheets)',
    ]),
  },
  {
    title: 'SCHOOL BASED MODERATION',
    rows: numbered([
      'Evidence of **pre- and post-assessment** moderation of the test? Elaborate',
      'Quality of moderation at each level.\n\nUse of different colour pens.',
      'Feedback provided to the teacher by the Departmental Head/Teacher Moderator/Subject Advisor?',
      'Implementation of recommendations suggested by the moderator at each level.',
      'Evidence of **HISTORY** of the task provided.',
      'Moderator signed off the SA SAMS working marksheet',
    ]),
  },
  {
    title: 'COMPUTER GENERATED MARKSHEETS (For last phase of moderation)',
    rows: numbered([
      'Transfer of marks from the **SA SAMS** working mark sheet to the copy of computerised marksheet',
      'Correct code awarded for blanks and "0" mark on the marksheet',
      'Copy of computerised marksheet signed off by DH and Principal.',
    ]),
  },
]

/** The table of poorly answered questions sits after this J2 section (by index). */
export const J2_POOR_AFTER = 4
export const J2_POOR_TITLE =
  'Questions which were not attempted/poorly answered by learners and possible causes. (FOR COMMON TASKS only)'
export const J2_POOR_COLUMNS = [
  { key: 'q', head: 'Poorly answered questions' },
  { key: 'nature', head: 'Nature of the challenge/Type of question' },
  { key: 'reasons', head: 'Possible reasons' },
  { key: 'recs', head: 'Recommendations' },
] as const
export const J2_POOR_ROWS = 8
/** A blank form prints this many rows, as the official form has. */
export const J2_POOR_MIN = 5

export const J2_OVERALL = [
  { key: 'good', head: 'Areas of Good Practice' },
  { key: 'challenges', head: 'Challenges' },
  { key: 'recommendations', head: 'Recommendations' },
] as const

export const J2_LEVELS = ['circuit', 'district', 'provincial'] as const
export const J2_LEARNERS_LINE =
  'Name of learners whose files were moderated at circuit, district, and provincial moderation (circle whichever is applicable)'
export const J2_MODERATORS = [
  { key: 'mod', label: 'Moderator' },
  { key: 'senior', label: 'Senior Moderator' },
  { key: 'chief', label: 'Chief Moderator' },
] as const

export const J3_MODERATIONS = 6
export const J3_LEARNERS = 6
export const J3_FOOTNOTE =
  '** Please use another Annexure J if the subject has more than 6 SBA tasks (including tests and preliminary exams)'

export const ORDINALS = ['ST', 'ND', 'RD', 'TH', 'TH', 'TH'] as const

/** The key of a criterion's comment: section and row, both from 1. */
export function commentKey(section: number, row: number): string {
  return `c${section + 1}.${row + 1}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "2026-11-18" as "18 November 2026", or "18 Nov 2026" where space is tight. Anything else is shown as typed. */
export function showDate(value: string | undefined, short = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim())
  if (!m) return (value ?? '').trim()
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return value!.trim()
  return `${Number(m[3])} ${short ? month.slice(0, 3) : month} ${m[1]}`
}

/** A file name such as "J1 Pre-moderation - Mathematics - Term 2 test.pdf". */
export function formFileName(form: FormInfo, parts: (string | undefined)[]): string {
  const clean = parts
    .map((p) =>
      (p ?? '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((p) => p !== '')
  return `${[form.fileStem, ...clean].join(' - ').slice(0, 120)}.pdf`
}

const MAX_VALUE = 2000

/** Reads saved values back, keeping only short strings. */
export function parseValues(value: unknown): Values {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Values = {}
  for (const [key, body] of Object.entries(value as Record<string, unknown>)) {
    if (typeof body === 'string' && body !== '' && key.length <= 40) out[key] = body.slice(0, MAX_VALUE)
  }
  return out
}

/** A filled-in form saved by name in this browser. */
export interface SavedForm {
  name: string
  savedAt: number
  values: Values
}

export function parseSavedForms(value: unknown): SavedForm[] {
  if (!Array.isArray(value)) return []
  const out: SavedForm[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.name !== 'string' || r.name.trim() === '') continue
    out.push({
      name: r.name.slice(0, 80),
      savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
      values: parseValues(r.values),
    })
  }
  return out
}

/** Adds or replaces (by name, ignoring case) a saved form. Newest first. */
export function upsertForm(list: SavedForm[], entry: SavedForm): SavedForm[] {
  const key = entry.name.trim().toLowerCase()
  return [entry, ...list.filter((s) => s.name.trim().toLowerCase() !== key)]
}

/** The details that carry over from one form to the next, so a teacher types them once. */
export const SHARED_KEYS = [
  'school',
  'district',
  'subject',
  'grade',
  'teacher',
  'hod',
  'moderator',
  'specialist',
  'year',
]

/** A fresh form: the shared details from last time, and nothing else. */
export function freshValues(shared: Values): Values {
  const out: Values = {}
  for (const key of SHARED_KEYS) if (shared[key]) out[key] = shared[key]!
  return out
}
