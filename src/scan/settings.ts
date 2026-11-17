// The teacher's choices, remembered in this browser under red-pen.scan.settings.
import { isScanFilter, type ScanFilter } from './filters'
import { isPageSize, MARGINS, type PageSize } from './layout'

export interface ScanSettings {
  pageSize: PageSize
  marginMm: number
  /** JPEG quality, 30 to 95. */
  quality: number
  /** The look given to each new page. */
  filter: ScanFilter
}

export const DEFAULT_SETTINGS: ScanSettings = { pageSize: 'a4', marginMm: 0, quality: 75, filter: 'colour' }

const KEY = 'red-pen.scan.settings'

/** Settings from stored JSON, falling back to the default for anything missing or odd. */
export function parseSettings(text: string | null): ScanSettings {
  let raw: Record<string, unknown> = {}
  try {
    const v: unknown = text ? JSON.parse(text) : {}
    if (v && typeof v === 'object') raw = v as Record<string, unknown>
  } catch {
    // Damaged settings: start again from the defaults.
  }
  const q = Number(raw.quality)
  return {
    pageSize: isPageSize(raw.pageSize) ? raw.pageSize : DEFAULT_SETTINGS.pageSize,
    marginMm: MARGINS.some((m) => m.value === raw.marginMm) ? (raw.marginMm as number) : DEFAULT_SETTINGS.marginMm,
    quality: Number.isFinite(q) ? Math.max(30, Math.min(95, Math.round(q / 5) * 5)) : DEFAULT_SETTINGS.quality,
    filter: isScanFilter(raw.filter) ? raw.filter : DEFAULT_SETTINGS.filter,
  }
}

export function loadSettings(): ScanSettings {
  try {
    return parseSettings(localStorage.getItem(KEY))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: ScanSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Storage blocked (private browsing): the choices last for this visit only.
  }
}
