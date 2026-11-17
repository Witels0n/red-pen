/**
 * CSV reading and writing, written in-house (RFC 4180).
 * Handles quoted fields with commas, newlines and doubled quotes, CRLF, LF or CR line ends,
 * a leading byte order mark, and files separated by semicolons (Excel's default where the
 * decimal mark is a comma, as in South Africa) or tabs, which are detected automatically.
 */

export type CsvDelimiter = ',' | ';' | '\t'

export interface ParseCsvOptions {
  /** Leave out to detect it from the first line. */
  delimiter?: CsvDelimiter
}

const CANDIDATES: readonly CsvDelimiter[] = [',', ';', '\t']

/** Picks the delimiter that appears most often, outside quotes, in the first line. Ties go to the comma. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(CANDIDATES.map((d) => [d, 0]))
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && counts.has(c as CsvDelimiter)) counts.set(c as CsvDelimiter, counts.get(c as CsvDelimiter)! + 1)
  }
  let best: CsvDelimiter = ','
  for (const d of CANDIDATES) if (counts.get(d)! > counts.get(best)!) best = d
  return best
}

/**
 * Splits CSV text into rows of fields. An empty line is a row with one empty field;
 * a line break at the very end of the text does not start a new row.
 * Lenient where files break the rules: an unclosed quote runs to the end of the text,
 * and a quote in the middle of an unquoted field is kept as it is.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text === '') return []
  const delimiter = options.delimiter ?? detectDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let atFieldStart = true

  const endField = () => {
    row.push(field)
    field = ''
    atFieldStart = true
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const c = text[i]
    if (atFieldStart && c === '"') {
      // Quoted field: runs to the next quote that is not doubled.
      i++
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i += 2
          } else {
            i++
            break
          }
        } else {
          field += text[i++]
        }
      }
      atFieldStart = false
      continue
    }
    atFieldStart = false
    if (c === delimiter) {
      endField()
      i++
    } else if (c === '\r' || c === '\n') {
      endRow()
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
      if (i >= text.length) return rows
    } else {
      field += c
      i++
    }
  }
  endRow()
  return rows
}

/** Quotes a field only when it needs it. */
function csvField(value: string, delimiter: CsvDelimiter): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replaceAll('"', '""')}"`
    : value
}

/** Rows to CSV text with CRLF line ends, as RFC 4180 describes. */
export function writeCsv(rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ','): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join('\r\n') + '\r\n'
}
