// What the Class picker remembers. Settings and custom wheels stay in this browser (localStorage);
// learners, attendance, picks and groups last only for this session (sessionStorage), so names
// are gone when the tab closes.
import type { AfterPick, DrawState } from './draw'
import type { GroupNameStyle, GroupRule } from './groups'
import type { PickerLearner } from './roster'

export const SETTINGS_KEY = 'red-pen.picker.settings'
export const WHEELS_KEY = 'red-pen.picker.wheels'
export const SESSION_KEY = 'red-pen.picker.session'

export type WheelStyle = 'auto' | 'wheel' | 'ticker'
export type LearnerSource = 'class' | 'paste' | 'numbers'

export interface PickerSettings {
  muted: boolean
  defaultAfter: AfterPick
  style: WheelStyle
  groupBy: 'size' | 'count'
  groupValue: number
  nameStyle: GroupNameStyle
  balance: boolean
  tab: 'wheel' | 'groups'
  source: LearnerSource
  classId: string
  numbers: number
}

export const DEFAULT_SETTINGS: PickerSettings = {
  muted: false,
  defaultAfter: 'remove',
  style: 'auto',
  groupBy: 'size',
  groupValue: 4,
  nameStyle: 'numbers',
  balance: false,
  tab: 'wheel',
  source: 'paste',
  classId: '',
  numbers: 30,
}

/** A wheel of options that are not learners, such as topics or Yes and No. */
export interface CustomWheel {
  id: string
  name: string
  options: string[]
}

export interface PickerSession {
  learners: PickerLearner[]
  /** Where the learners came from, for example "Grade 8A" or "Pasted names". */
  label: string
  tagTitle?: string
  pasteText: string
  absent: string[]
  after: Record<string, AfterPick>
  /** One draw per wheel: "learners" or a custom wheel's id. */
  draws: Record<string, DrawState>
  wheel: string
  rules: GroupRule[]
  groups: { keys: string[][]; locked: number[] } | null
}

export function emptySession(): PickerSession {
  return {
    learners: [],
    label: '',
    pasteText: '',
    absent: [],
    after: {},
    draws: {},
    wheel: 'learners',
    rules: [],
    groups: null,
  }
}

function read(store: () => Storage, key: string): unknown {
  try {
    const raw = store().getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(store: () => Storage, key: string, value: unknown): void {
  try {
    store().setItem(key, JSON.stringify(value))
  } catch {
    // Storage is full or blocked: the picker still works, it just forgets on reload.
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const oneOf = <T>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function loadSettings(): PickerSettings {
  const s = read(() => localStorage, SETTINGS_KEY)
  if (!isObject(s)) return { ...DEFAULT_SETTINGS }
  const d = DEFAULT_SETTINGS
  const whole = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : d.muted,
    defaultAfter: oneOf(s.defaultAfter, ['remove', 'keep'] as const, d.defaultAfter),
    style: oneOf(s.style, ['auto', 'wheel', 'ticker'] as const, d.style),
    groupBy: oneOf(s.groupBy, ['size', 'count'] as const, d.groupBy),
    groupValue: whole(s.groupValue, 1, 99, d.groupValue),
    nameStyle: oneOf(s.nameStyle, ['numbers', 'colours', 'fun'] as const, d.nameStyle),
    balance: typeof s.balance === 'boolean' ? s.balance : d.balance,
    tab: oneOf(s.tab, ['wheel', 'groups'] as const, d.tab),
    source: oneOf(s.source, ['class', 'paste', 'numbers'] as const, d.source),
    classId: typeof s.classId === 'string' ? s.classId : d.classId,
    numbers: whole(s.numbers, 1, 99, d.numbers),
  }
}

export function saveSettings(settings: PickerSettings): void {
  write(() => localStorage, SETTINGS_KEY, settings)
}

export function loadWheels(): CustomWheel[] {
  const raw = read(() => localStorage, WHEELS_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isObject)
    .map((w) => ({ id: String(w.id ?? ''), name: String(w.name ?? ''), options: strings(w.options) }))
    .filter((w) => w.id !== '' && w.options.length > 0)
}

export function saveWheels(wheels: readonly CustomWheel[]): void {
  write(() => localStorage, WHEELS_KEY, wheels)
}

function draw(v: unknown): DrawState | null {
  if (!isObject(v) || !Array.isArray(v.history)) return null
  return {
    removed: strings(v.removed),
    history: v.history
      .filter(isObject)
      .map((p) => ({ id: String(p.id ?? ''), label: String(p.label ?? ''), removed: p.removed === true })),
  }
}

export function loadSession(): PickerSession {
  const s = read(() => sessionStorage, SESSION_KEY)
  const out = emptySession()
  if (!isObject(s)) return out
  if (Array.isArray(s.learners)) {
    out.learners = s.learners
      .filter(isObject)
      .filter((l) => typeof l.key === 'string' && typeof l.name === 'string')
      .map((l) =>
        typeof l.tag === 'string' && l.tag
          ? { key: l.key as string, name: l.name as string, tag: l.tag }
          : { key: l.key as string, name: l.name as string },
      )
  }
  out.label = typeof s.label === 'string' ? s.label : ''
  if (typeof s.tagTitle === 'string') out.tagTitle = s.tagTitle
  out.pasteText = typeof s.pasteText === 'string' ? s.pasteText : ''
  out.absent = strings(s.absent)
  if (isObject(s.after)) {
    for (const [k, v] of Object.entries(s.after)) if (v === 'remove' || v === 'keep') out.after[k] = v
  }
  if (isObject(s.draws)) {
    for (const [k, v] of Object.entries(s.draws)) {
      const d = draw(v)
      if (d) out.draws[k] = d
    }
  }
  out.wheel = typeof s.wheel === 'string' ? s.wheel : 'learners'
  if (Array.isArray(s.rules)) {
    out.rules = s.rules
      .filter(isObject)
      .filter((r) => r.kind === 'apart' || r.kind === 'together')
      .map((r) => ({ kind: r.kind as GroupRule['kind'], keys: strings(r.keys) }))
  }
  if (isObject(s.groups) && Array.isArray(s.groups.keys)) {
    out.groups = {
      keys: s.groups.keys.map(strings),
      locked: Array.isArray(s.groups.locked) ? s.groups.locked.filter((n): n is number => typeof n === 'number') : [],
    }
  }
  return out
}

export function saveSession(session: PickerSession): void {
  write(() => sessionStorage, SESSION_KEY, session)
}
