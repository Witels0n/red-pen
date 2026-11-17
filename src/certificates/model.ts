// What the teacher chooses: the Product, its wording with merge fields, and the look.
// Pure; settings are saved in this browser between visits (not the names).
import { LABEL_PRESETS, presetLayout, type LabelLayout } from './layouts'

/** What is being printed. */
export type Product = 'certificate' | 'desk' | 'labels' | 'book' | 'slips'

export const PRODUCTS: readonly { id: Product; name: string; hint: string }[] = [
  { id: 'certificate', name: 'Certificates', hint: 'One A4 page per learner.' },
  { id: 'desk', name: 'Desk name cards', hint: 'Folded tent cards, two per A4 sheet.' },
  { id: 'labels', name: 'Name labels', hint: 'Sticker sheets, such as 3 × 7.' },
  { id: 'book', name: 'Book labels', hint: 'Name, subject and class for exercise books.' },
  { id: 'slips', name: 'Award slips', hint: 'Four small awards per A4 page.' },
]

export type Design = 'classic' | 'modern' | 'playful' | 'minimal'

export const DESIGNS: readonly { id: Design; name: string }[] = [
  { id: 'classic', name: 'Classic border' },
  { id: 'modern', name: 'Modern' },
  { id: 'playful', name: 'Playful' },
  { id: 'minimal', name: 'Minimalist' },
]

export type Orientation = 'landscape' | 'portrait'

/** The typeface for names and headings on labels, cards and slips. */
export type Lettering = 'clear' | 'display' | 'script' | 'serif'

export const LETTERINGS: readonly { id: Lettering; name: string }[] = [
  { id: 'clear', name: 'Clear (Atkinson Hyperlegible)' },
  { id: 'display', name: 'Bold (Bricolage Grotesque)' },
  { id: 'script', name: 'Script (Great Vibes)' },
  { id: 'serif', name: 'Classic serif (Times)' },
]

export interface Theme {
  id: string
  name: string
  /** Headings, borders and bands. */
  main: string
  /** Ornaments and second lines. */
  accent: string
}

export const THEMES: readonly Theme[] = [
  { id: 'navy', name: 'Navy and gold', main: '#1f3a68', accent: '#b8892b' },
  { id: 'red', name: 'Red Pen red', main: '#b3202a', accent: '#d9a13b' },
  { id: 'green', name: 'Forest green', main: '#1e5a3c', accent: '#a88a2e' },
  { id: 'purple', name: 'Royal purple', main: '#4b2a7a', accent: '#c19a3e' },
  { id: 'teal', name: 'Teal and coral', main: '#0f6b73', accent: '#e0674f' },
  { id: 'black', name: 'Charcoal', main: '#222831', accent: '#8a8f98' },
]

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export interface Signatory {
  name: string
  role: string
}

export interface CertificateSettings {
  design: Design
  orientation: Orientation
  school: string
  title: string
  intro: string
  name: string
  body: string
  date: string
  /** Name in Great Vibes script, or in the design's heading font. */
  scriptName: boolean
  signatories: [Signatory, Signatory]
}

export interface DeskSettings {
  line1: string
  line2: string
  /** Print on both panels, so the class and the teacher both see the name. */
  bothSides: boolean
}

export interface LabelSettings {
  preset: string
  layout: LabelLayout
  line1: string
  line2: string
  /** Labels on the first sheet already used. */
  skip: number
  copies: number
  /** Print the outline of each label, for plain paper or checking alignment. */
  outlines: boolean
}

export interface BookRow {
  label: string
  value: string
}

export interface BookSettings {
  preset: string
  layout: LabelLayout
  heading: string
  rows: [BookRow, BookRow, BookRow]
  skip: number
  copies: number
  outlines: boolean
}

export interface SlipSettings {
  title: string
  body: string
  /** Under the signature line, for example "Class teacher". */
  signedBy: string
  footer: string
}

export interface Settings {
  product: Product
  theme: string
  lettering: Lettering
  certificate: CertificateSettings
  desk: DeskSettings
  labels: LabelSettings
  book: BookSettings
  slips: SlipSettings
}

export function defaultSettings(): Settings {
  return {
    product: 'certificate',
    theme: 'navy',
    lettering: 'clear',
    certificate: {
      design: 'classic',
      orientation: 'landscape',
      school: '',
      title: 'Certificate of Achievement',
      intro: 'This certificate is proudly presented to',
      name: '{Name}',
      body: 'for outstanding effort and achievement.',
      date: '{Date}',
      scriptName: true,
      signatories: [
        { name: '', role: 'Class teacher' },
        { name: '', role: 'Principal' },
      ],
    },
    desk: { line1: '{Name}', line2: '', bothSides: true },
    labels: {
      preset: '3x7',
      layout: presetLayout('3x7')!,
      line1: '{Name}',
      line2: '{Class}',
      skip: 0,
      copies: 1,
      outlines: false,
    },
    book: {
      preset: '2x4',
      layout: presetLayout('2x4')!,
      heading: 'This book belongs to',
      rows: [
        { label: 'Name', value: '{Name}' },
        { label: 'Subject', value: '' },
        { label: 'Class', value: '{Class}' },
      ],
      skip: 0,
      copies: 1,
      outlines: false,
    },
    slips: {
      title: 'Well done!',
      body: '{Name} worked really hard this week.',
      signedBy: 'Class teacher',
      footer: '{Date}',
    },
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Fills what a saved copy lacks (or got wrong) from the defaults, so an old save never breaks the page. */
function merge<T>(base: T, saved: unknown): T {
  if (Array.isArray(base)) {
    if (!Array.isArray(saved)) return base
    return base.map((b, i) => merge(b, saved[i])) as T
  }
  if (isObject(base)) {
    if (!isObject(saved)) return base
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(base)) out[k] = merge(v, saved[k])
    return out as T
  }
  return typeof saved === typeof base && (typeof saved !== 'number' || Number.isFinite(saved)) ? (saved as T) : base
}

/** Settings read back from storage, checked against the defaults. */
export function readSettings(json: string | null): Settings {
  const base = defaultSettings()
  if (!json) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return base
  }
  const s = merge(base, parsed)
  if (!PRODUCTS.some((p) => p.id === s.product)) s.product = base.product
  if (!DESIGNS.some((d) => d.id === s.certificate.design)) s.certificate.design = base.certificate.design
  if (s.certificate.orientation !== 'portrait') s.certificate.orientation = 'landscape'
  if (!LETTERINGS.some((l) => l.id === s.lettering)) s.lettering = base.lettering
  s.theme = themeById(s.theme).id
  for (const k of ['labels', 'book'] as const)
    if (s[k].preset !== 'custom' && !LABEL_PRESETS.some((p) => p.id === s[k].preset)) {
      s[k].preset = base[k].preset
      s[k].layout = base[k].layout
    }
  return s
}

/** Every text the Product prints, for checking merge fields. */
export function productTemplates(s: Settings): string[] {
  switch (s.product) {
    case 'certificate': {
      const c = s.certificate
      return [c.school, c.title, c.intro, c.name, c.body, c.date, ...c.signatories.flatMap((g) => [g.name, g.role])]
    }
    case 'desk':
      return [s.desk.line1, s.desk.line2]
    case 'labels':
      return [s.labels.line1, s.labels.line2]
    case 'book':
      return [s.book.heading, ...s.book.rows.flatMap((r) => [r.label, r.value])]
    case 'slips':
      return [s.slips.title, s.slips.body, s.slips.signedBy, s.slips.footer]
  }
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

/** "2026-11-17" -> "17 November 2026", as South African schools write a date in full. Empty if not a date. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return ''
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${day} ${MONTHS[month - 1]} ${m[1]}`
}

/** Today in the browser's time zone, as "2026-11-17" for a date input. */
export function todayIso(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}
