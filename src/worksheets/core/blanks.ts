// Fill in the blanks: the teacher marks each blank in their text with [square brackets].

export type BlankSegment = { kind: 'text'; text: string } | { kind: 'blank'; answer: string; number: number }

/**
 * Splits text into plain text and numbered blanks. "The [sun] is a [star]." gives two blanks.
 * Brackets that do not close, or that hold nothing, stay as ordinary text.
 */
export function parseBlanks(text: string): BlankSegment[] {
  const out: BlankSegment[] = []
  const pushText = (t: string) => {
    if (t === '') return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += t
    else out.push({ kind: 'text', text: t })
  }
  let number = 0
  let i = 0
  const re = /\[([^[\]\n]*)\]/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const answer = m[1].trim()
    pushText(text.slice(i, m.index))
    if (answer === '') pushText(m[0])
    else out.push({ kind: 'blank', answer, number: ++number })
    i = m.index + m[0].length
  }
  pushText(text.slice(i))
  return out
}

/** The answers in order. */
export function blankAnswers(segments: readonly BlankSegment[]): string[] {
  return segments.flatMap((s) => (s.kind === 'blank' ? [s.answer] : []))
}

/** Distinct words for a word bank, ignoring case, in first-seen order (shuffle afterwards). */
export function distinctWords(words: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    const k = w.trim().toLocaleLowerCase('en-ZA')
    if (k === '' || seen.has(k)) continue
    seen.add(k)
    out.push(w.trim())
  }
  return out
}
