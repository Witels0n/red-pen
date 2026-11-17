// Colour checks that warn when a foreground and background pair may not scan.

/** "#1b2330" or "#abc" -> [r, g, b] in 0..255, or null when it is not a hex colour. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Below this ratio many phone cameras struggle to tell the modules from the background. */
export const MIN_CONTRAST = 4

/** Plain-language warnings for a colour pair; empty when the pair should scan well. */
export function colourWarnings(foreground: string, background: string): string[] {
  const warnings: string[] = []
  const fg = luminance(foreground)
  const bg = luminance(background)
  if (fg > bg) {
    warnings.push(
      'The code colour is lighter than the background. Many scanner apps cannot read light-on-dark codes, so use a dark code on a light background.',
    )
  } else if (fg > 0.4) {
    warnings.push('The code colour is quite light. Darker codes scan more reliably.')
  }
  const ratio = contrastRatio(foreground, background)
  if (ratio < MIN_CONTRAST) {
    warnings.push(
      `Low contrast (${ratio.toFixed(1)} to 1). The code may not scan; aim for at least ${MIN_CONTRAST} to 1.`,
    )
  }
  return warnings
}
