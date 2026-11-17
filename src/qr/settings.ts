// The teacher's last style choices, remembered in this browser. Content and logo are never stored.
import { parseHex } from './contrast'
import type { ErrorCorrection } from './matrix'
import { MAX_LOGO_SIZE, MIN_LOGO_SIZE, type EyeStyle, type ModuleShape } from './render'

export const STORAGE_KEY = 'red-pen.qr.style'

export interface StyleSettings {
  foreground: string
  background: string
  moduleShape: ModuleShape
  eyeStyle: EyeStyle
  margin: number
  errorCorrection: ErrorCorrection
  /** Export width and height in pixels. */
  exportSize: number
  logoSize: number
  logoPadding: boolean
}

export const EXPORT_SIZES = [256, 512, 1024, 2048] as const

export const DEFAULT_SETTINGS: StyleSettings = {
  foreground: '#1b2330',
  background: '#ffffff',
  moduleShape: 'square',
  eyeStyle: 'square',
  margin: 4,
  errorCorrection: 'M',
  exportSize: 1024,
  logoSize: 0.2,
  logoPadding: true,
}

const oneOf = <T>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** Fills anything missing or invalid in stored settings with the defaults. */
export function sanitiseSettings(raw: unknown): StyleSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const colour = (v: unknown, fallback: string) =>
    typeof v === 'string' && parseHex(v) && v.startsWith('#') ? v : fallback
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  return {
    foreground: colour(s.foreground, d.foreground),
    background: colour(s.background, d.background),
    moduleShape: oneOf(s.moduleShape, ['square', 'rounded', 'dots'] as const, d.moduleShape),
    eyeStyle: oneOf(s.eyeStyle, ['square', 'rounded'] as const, d.eyeStyle),
    margin: Math.round(num(s.margin, 0, 10, d.margin)),
    errorCorrection: oneOf(s.errorCorrection, ['L', 'M', 'Q', 'H'] as const, d.errorCorrection),
    exportSize: oneOf(s.exportSize, EXPORT_SIZES, d.exportSize),
    logoSize: num(s.logoSize, MIN_LOGO_SIZE, MAX_LOGO_SIZE, d.logoSize),
    logoPadding: typeof s.logoPadding === 'boolean' ? s.logoPadding : d.logoPadding,
  }
}

export function loadSettings(storage?: Pick<Storage, 'getItem'>): StyleSettings {
  try {
    // Reading localStorage itself can throw when site data is blocked, so it stays inside the try.
    const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)
    return sanitiseSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: StyleSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or full storage: the settings just are not remembered.
  }
}
