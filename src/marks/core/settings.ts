// The band scheme and pass mark, remembered in this browser. Marks and names are never stored.
import { CAPS_CUTOFFS, type BandSchemeId } from './stats'

export const STORAGE_KEY = 'red-pen.marks.settings'

export interface MarksSettings {
  scheme: BandSchemeId
  customCutoffs: number[]
  /** Percentage, 1 to 100. */
  passMark: number
}

export const PASS_MARK_PICKS: readonly number[] = [30, 40, 50]

export const DEFAULT_SETTINGS: MarksSettings = { scheme: 'caps', customCutoffs: [...CAPS_CUTOFFS], passMark: 50 }

export function sanitiseSettings(raw: unknown): MarksSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const scheme = (['caps', 'tens', 'symbols', 'custom'] as const).find((id) => id === s.scheme) ?? 'caps'
  const cutoffs =
    Array.isArray(s.customCutoffs) &&
    s.customCutoffs.length > 0 &&
    s.customCutoffs.length <= 12 &&
    s.customCutoffs.every((v) => Number.isInteger(v) && v >= 1 && v <= 99)
      ? [...new Set(s.customCutoffs as number[])].sort((a, b) => a - b)
      : [...CAPS_CUTOFFS]
  const pass =
    typeof s.passMark === 'number' && Number.isFinite(s.passMark) && s.passMark > 0 && s.passMark <= 100
      ? s.passMark
      : DEFAULT_SETTINGS.passMark
  return { scheme, customCutoffs: cutoffs, passMark: pass }
}

export function loadSettings(storage?: Pick<Storage, 'getItem'>): MarksSettings {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)
    return sanitiseSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitiseSettings(null)
  }
}

export function saveSettings(settings: MarksSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or full storage: the settings just are not remembered.
  }
}
