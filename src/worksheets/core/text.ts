// Reading what the teacher types: one item per line, pairs split at a separator, and the letters a
// puzzle grid can hold.

/** Non-empty, trimmed lines, each with its 1-based line number for messages. */
export function lines(text: string): { line: number; text: string }[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((l) => l.text !== '')
}

/**
 * Splits "left: right" (or "left | right", "left = right", "left - right") at the first separator.
 * A "|" wins over the others, so text that itself holds a colon can still be split. Returns
 * undefined when there is no separator or either side is empty.
 */
export function splitPair(line: string): [string, string] | undefined {
  const tryAt = (re: RegExp): [string, string] | undefined => {
    const m = re.exec(line)
    if (!m) return undefined
    const left = line.slice(0, m.index).trim()
    const right = line.slice(m.index + m[0].length).trim()
    return left && right ? [left, right] : undefined
  }
  if (line.includes('|')) return tryAt(/\|/)
  return tryAt(/:/) ?? tryAt(/\s=\s|=/) ?? tryAt(/\s[-–]\s/)
}

/**
 * The letters of a word as they go into a grid: upper case, Latin letters only (including accented
 * ones like E with a circumflex, which the PDF fonts can print), with spaces, digits and punctuation removed.
 */
export function gridLetters(word: string): string {
  const upper = word.normalize('NFC').toLocaleUpperCase('en-ZA')
  return [...upper].filter((ch) => /[A-ZÀ-ÖØ-Þ]/.test(ch)).join('')
}

/** "(5)" or, for an answer of several words, "(5, 6)". */
export function lengthHint(answer: string): string {
  const parts = answer
    .split(/[\s-]+/)
    .map((w) => gridLetters(w).length)
    .filter((n) => n > 0)
  return `(${parts.join(', ')})`
}

/** "1 mark", "3 marks". */
export function marksText(n: number): string {
  return `${n} ${n === 1 ? 'mark' : 'marks'}`
}
