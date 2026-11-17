// Settings, size formatting and the target-size search for Compress a PDF. Pure: no DOM.

export type PresetName = 'small' | 'balanced' | 'sharp'

export const PRESETS: Record<PresetName, { label: string; dpi: number }> = {
  small: { label: 'Small', dpi: 100 },
  balanced: { label: 'Balanced', dpi: 150 },
  sharp: { label: 'Sharp', dpi: 200 },
}

export type SizeUnit = 'KB' | 'MB'

export interface CompressSettings {
  preset: PresetName
  /** JPEG quality, 0.3 to 0.95. */
  quality: number
  greyscale: boolean
  /** Keep trying lower settings until the file is under the target size. */
  useTarget: boolean
  targetValue: number
  targetUnit: SizeUnit
}

export const DEFAULT_SETTINGS: CompressSettings = {
  preset: 'balanced',
  quality: 0.7,
  greyscale: false,
  useTarget: false,
  targetValue: 2,
  targetUnit: 'MB',
}

export const MIN_QUALITY = 0.3
export const MAX_QUALITY = 0.95
/** Below this the text of a typical scan is no longer readable. */
export const MIN_DPI = 72
/** The most attempts a target-size search makes, including the first. */
export const MAX_ATTEMPTS = 6

/** One way of compressing: the resolution pages are drawn at and the JPEG quality. */
export interface Attempt {
  dpi: number
  quality: number
}

const KB = 1024
const MB = 1024 * 1024

/** "850 KB", "1.4 MB", "12 MB". Uses 1024, as file managers and email limits do. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < KB) return `${Math.round(bytes)} bytes`
  if (bytes < MB) {
    const kb = Math.max(1, Math.round(bytes / KB))
    return kb >= 1000 ? `${(bytes / MB).toFixed(1)} MB` : `${kb} KB`
  }
  const mb = bytes / MB
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

/** "64% smaller", "2% larger", "About the same size". */
export function describeChange(before: number, after: number): string {
  if (before <= 0) return ''
  const change = Math.round(((before - after) / before) * 100)
  if (change > 0) return `${change}% smaller`
  if (change < 0) return `${-change}% larger`
  return 'About the same size'
}

/** The target size in bytes, or null when the value is not a positive number. */
export function targetBytes(value: number, unit: SizeUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.floor(value * (unit === 'MB' ? MB : KB))
}

export function firstAttempt(s: CompressSettings): Attempt {
  return { dpi: PRESETS[s.preset].dpi, quality: clampQuality(s.quality) }
}

export function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return DEFAULT_SETTINGS.quality
  return Math.round(Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, q)) * 100) / 100
}

/**
 * The next, smaller settings to try after `previous` gave a file of `size` bytes, or null when
 * the file already fits or nothing smaller is worth trying. A small overshoot lowers the JPEG
 * quality first (sharper text); a large one lowers the resolution, by the square root of how
 * far off it is, since the number of pixels goes with the square of the resolution.
 */
export function nextAttempt(previous: Attempt, size: number, target: number): Attempt | null {
  if (size <= target) return null
  const ratio = target / size
  const q = previous.quality
  if (ratio >= 0.75 && q > 0.5 + 1e-9) {
    return { dpi: previous.dpi, quality: clampQuality(Math.max(0.5, q - 0.15)) }
  }
  if (previous.dpi > MIN_DPI) {
    const dpi = Math.max(MIN_DPI, Math.floor(previous.dpi * Math.sqrt(ratio) * 0.95))
    return { dpi: Math.min(dpi, previous.dpi - 1), quality: q }
  }
  if (q > MIN_QUALITY + 1e-9) return { dpi: previous.dpi, quality: clampQuality(Math.max(MIN_QUALITY, q - 0.15)) }
  return null
}

/** One run of the search: the settings tried and the size they gave. */
export interface Tried extends Attempt {
  size: number
}

/**
 * Try settings until the result fits under `target` (or, without a target, once). `run` compresses
 * with the given settings and returns the size. Gives up after MAX_ATTEMPTS. Returns every attempt;
 * the last one is the result to use.
 */
export async function searchSettings(
  start: Attempt,
  target: number | null,
  run: (attempt: Attempt, index: number) => Promise<number>,
): Promise<Tried[]> {
  const tried: Tried[] = []
  let attempt: Attempt | null = start
  while (attempt) {
    const size = await run(attempt, tried.length)
    tried.push({ ...attempt, size })
    if (target === null || tried.length >= MAX_ATTEMPTS) break
    attempt = nextAttempt(attempt, size, target)
  }
  return tried
}

/** Which file to hand back: the compressed one, unless it is no smaller than the original. */
export function preferredChoice(originalSize: number, compressedSize: number): 'compressed' | 'original' {
  return compressedSize < originalSize ? 'compressed' : 'original'
}

/** The scale to draw a page at for `dpi`, lowered if needed so the canvas stays under `maxPixels`. */
export function renderScale(widthPt: number, heightPt: number, dpi: number, maxPixels = 16_000_000): number {
  const scale = dpi / 72
  const pixels = widthPt * scale * heightPt * scale
  return pixels <= maxPixels ? scale : scale * Math.sqrt(maxPixels / pixels)
}

export function sanitiseSettings(raw: unknown): CompressSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const preset = (['small', 'balanced', 'sharp'] as const).includes(s.preset as PresetName)
    ? (s.preset as PresetName)
    : d.preset
  return {
    preset,
    quality: typeof s.quality === 'number' ? clampQuality(s.quality) : d.quality,
    greyscale: typeof s.greyscale === 'boolean' ? s.greyscale : d.greyscale,
    useTarget: typeof s.useTarget === 'boolean' ? s.useTarget : d.useTarget,
    targetValue:
      typeof s.targetValue === 'number' && Number.isFinite(s.targetValue) && s.targetValue > 0
        ? s.targetValue
        : d.targetValue,
    targetUnit: s.targetUnit === 'KB' || s.targetUnit === 'MB' ? s.targetUnit : d.targetUnit,
  }
}

export const STORAGE_KEY = 'red-pen.compress.settings'

export function loadSettings(storage?: Pick<Storage, 'getItem'>): CompressSettings {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)
    return sanitiseSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: CompressSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    ;(storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or full storage: the settings just are not remembered.
  }
}

/** Make file names unique for a zip: "a.pdf", "a.pdf" -> "a.pdf", "a (2).pdf". */
export function uniqueFileNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    let candidate = name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
    seen.add(candidate.toLowerCase())
    return candidate
  })
}
