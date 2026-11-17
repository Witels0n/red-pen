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
