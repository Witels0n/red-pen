// Text fitting: shrink a long name to fit its line, and wrap body text into a box.
// Pure; a font is anything that can measure text. See tests/certificates/fit.test.ts.

export interface Measure {
  widthOf(text: string, size: number): number
}

/** The largest size from `max` down to `min` (in steps of 0.5 pt) at which text fits `width`. */
export function fitSize(font: Measure, text: string, max: number, width: number, min = Math.min(6, max)): number {
  const natural = font.widthOf(text, max)
  if (natural <= width || natural === 0) return max
  // Width grows in proportion to size, so one division gets close; round down to a half point.
  const size = Math.floor(((max * width) / natural) * 2) / 2
  return Math.max(min, size)
}

/**
 * A name on one line, or on two when that lets it be much larger: a long name such as
 * "Bartholomew Montgomery-Featherstonehaugh" breaks at the space that balances the lines best.
 * Two lines are used only when one line would shrink below 55% of `max`, `height` has room for
 * them, and the text comes out at least 25% larger.
 */
export function fitName(
  font: Measure,
  text: string,
  max: number,
  width: number,
  height = Infinity,
  leading = 1.1,
): { lines: string[]; size: number } {
  const one = Math.min(fitSize(font, text, max, width), height / leading)
  const words = text.trim().split(/\s+/)
  // A name that is still a good size on one line stays on one line.
  if (words.length < 2 || one >= max * 0.55) return { lines: [text.trim()], size: one }
  let best = { lines: [text.trim()], size: one }
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const size = Math.min(...lines.map((l) => fitSize(font, l, max, width)), height / (2 * leading))
    if (size > best.size) best = { lines, size }
  }
  return best.size >= one * 1.25 ? best : { lines: [text.trim()], size: one }
}

/** Cuts text to fit `width` at `size`, ending in "..." when anything was cut. */
export function truncate(font: Measure, text: string, size: number, width: number): string {
  if (font.widthOf(text, size) <= width) return text
  let s = text
  while (s.length > 1 && font.widthOf(`${s.trimEnd()}...`, size) > width) s = s.slice(0, -1)
  return `${s.trimEnd()}...`
}

/**
 * Breaks text into lines no wider than `width`, at spaces. Line breaks in the text are kept.
 * A single word wider than the line is cut with "...".
 */
export function wrapLines(font: Measure, text: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOf(next, size) <= width || !line) line = next
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out.map((l) => truncate(font, l, size, width))
}

export interface FittedBlock {
  size: number
  lines: string[]
  /** Distance between baselines. */
  lineHeight: number
}

/**
 * Wraps text into a box, shrinking it from `max` (down to `min`) until the lines fit the height.
 * At `min`, lines that still do not fit are dropped and the last one ends in "...".
 */
export function fitBlock(
  font: Measure,
  text: string,
  box: { width: number; height: number },
  max: number,
  min = Math.min(7, max),
  leading = 1.3,
): FittedBlock {
  for (let size = max; size >= min; size -= 0.5) {
    const lines = wrapLines(font, text, size, box.width)
    if (lines.length * size * leading <= box.height + 0.01) return { size, lines, lineHeight: size * leading }
  }
  const lines = wrapLines(font, text, min, box.width)
  const room = Math.max(1, Math.floor(box.height / (min * leading)))
  if (lines.length > room) {
    lines.length = room
    lines[room - 1] = truncate(font, `${lines[room - 1]}...`, min, box.width)
  }
  return { size: min, lines, lineHeight: min * leading }
}
