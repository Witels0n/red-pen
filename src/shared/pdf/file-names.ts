/** "Grade 8 tests.PDF" -> "Grade 8 tests". */
export function stripPdfExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '') || 'document'
}

/** "class.pdf" + "organised" -> "class-organised.pdf". */
export function withSuffix(fileName: string, suffix: string, extension = 'pdf'): string {
  return `${stripPdfExtension(fileName)}-${suffix}.${extension}`
}

const MAX_NAME_LENGTH = 80
// Names Windows refuses for a file, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * Turns text (a learner's or a class's name) into something every operating system accepts as a file name:
 * no slashes, colons, quotes or other reserved characters, no control characters, single spaces,
 * no leading or trailing dots, and at most 80 characters. Returns `fallback` when nothing is left.
 */
export function safeFileBase(text: string, fallback: string): string {
  const cleaned = text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  const short = [...cleaned].slice(0, MAX_NAME_LENGTH).join('').trimEnd()
  return short === '' || RESERVED.test(short) ? fallback : short
}

/** File names made unique (ignoring case) for one zip: a repeat gets " (2)", " (3)" before its extension. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const key = name.toLowerCase()
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count === 1) return name
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
  })
}
