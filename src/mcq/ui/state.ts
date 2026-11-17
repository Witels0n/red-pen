// The open Assessment and everything derived from it (collation, marks, names), kept in step.
// Every change goes through `update`, which re-marks from the stored reads and saves shortly after.
import { getClass, type ClassList } from '../../shared/classes'
import { rosterFor } from '../core/learners'
import { collate, markAll, type Collation, type LearnerMark } from '../core/marking'
import { upgradeAssessment, type Assessment } from '../core/model'
import { refreshVersions } from '../core/versions'
import { saveAssessment } from '../storage'

export interface Workspace {
  assessment: Assessment
  /**
   * The learners in use, whatever their source: the linked Class list (when it is on this device)
   * or the Assessment's own Learner list, as a Class list. Null when there are none.
   */
  classList: ClassList | null
  /** The saved Class list linked in Print, when it is on this device (even while another source is chosen). */
  savedClass: ClassList | null
  collation: Collation
  marks: LearnerMark[]
  /** Learner ID to name, from the Class list. */
  names: Map<string, string>
}

export type SaveState = 'saved' | 'saving' | 'error'

/** What changed, so a screen can skip re-drawing itself for its own edits. */
export interface ChangeInfo {
  origin?: string
  /** True when only text fields changed (no marking, counts or structure). */
  textOnly?: boolean
}

type Listener = (w: Workspace, info: ChangeInfo) => void

let current: Workspace | null = null
const listeners = new Set<Listener>()
const saveListeners = new Set<(s: SaveState, message?: string) => void>()
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<void> = Promise.resolve()

function derive(assessment: Assessment, savedClass: ClassList | null): Workspace {
  const classList = rosterFor(assessment, savedClass)
  const roster = classList ? new Set(classList.learners.map((l) => l.id)) : undefined
  const collation = collate(assessment, roster)
  const names = new Map(classList?.learners.flatMap((l) => (l.name ? [[l.id, l.name] as const] : [])) ?? [])
  return { assessment, classList, savedClass, collation, marks: markAll(assessment, collation.learners), names }
}

export function workspace(): Workspace {
  if (!current) throw new Error('No assessment is open.')
  return current
}

export function hasWorkspace(): boolean {
  return current !== null
}

export async function openWorkspace(a: Assessment): Promise<Workspace> {
  await flushSave()
  let classList: ClassList | null = null
  if (a.print.classId) classList = (await getClass(a.print.classId).catch(() => undefined)) ?? null
  current = derive(refreshVersions(upgradeAssessment(a)), classList)
  return current
}

export function closeWorkspace(): void {
  current = null
}

export function onChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onSaveState(listener: (s: SaveState, message?: string) => void): void {
  saveListeners.add(listener)
}

function notify(info: ChangeInfo): void {
  for (const l of listeners) l(current!, info)
}

/** Changes the open Assessment, re-marks it, tells every screen and saves it shortly after. */
export function update(change: (a: Assessment) => Assessment, info: ChangeInfo = {}): void {
  const w = workspace()
  current = derive(refreshVersions(change(w.assessment)), w.savedClass)
  notify(info)
  // Typing is saved after a pause; decisions, reads and settings straight away.
  scheduleSave(info.textOnly ? 400 : 0)
}

/** Links a saved Class list (or none) as the learners and re-marks against it. */
export function setClassList(classList: ClassList | null): void {
  const w = workspace()
  const assessment = {
    ...w.assessment,
    print: { ...w.assessment.print, learnerSource: 'class' as const, classId: classList?.id ?? null },
  }
  current = derive(assessment, classList)
  notify({})
  scheduleSave()
}

function scheduleSave(delay = 0): void {
  clearTimeout(saveTimer)
  for (const l of saveListeners) l('saving')
  saveTimer = setTimeout(() => void save(), delay)
}

async function save(): Promise<void> {
  saveTimer = undefined
  const a = current?.assessment
  if (!a) return
  saving = saving.then(async () => {
    try {
      const stored = await saveAssessment(a)
      if (current?.assessment === a) current.assessment.updatedAt = stored.updatedAt
      for (const l of saveListeners) l('saved')
    } catch (error) {
      for (const l of saveListeners) l('error', error instanceof Error ? error.message : String(error))
    }
  })
  return saving
}

/** Saves now if a save is waiting. */
export async function flushSave(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    await save()
  }
  await saving
}

addEventListener('pagehide', () => void flushSave())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushSave()
})
