// The Recipient list: who gets a certificate or label, with the merge fields for each.
// Built from a Class list, pasted rows or an imported spreadsheet. Pure; see tests/certificates.
import { columnLetter, guessColumns, parseCsv, tidyName, type ClassList } from '../shared/classes'
import { fieldKey, type Recipient } from './merge'

export interface RecipientList {
  /** Every merge field, in column order. Always includes "Name". */
  fields: string[]
  recipients: Recipient[]
}

export const NAME_FIELD = 'Name'

/** One recipient per learner on a Class list, with the fields Name, Learner ID and Class. */
export function fromClassList(list: ClassList): RecipientList {
  return {
    fields: [NAME_FIELD, 'Learner ID', 'Class'],
    recipients: list.learners.map((l) => ({
      [NAME_FIELD]: l.name?.trim() || `Learner ${l.id}`,
      'Learner ID': l.id,
      Class: list.name.trim(),
    })),
  }
}

function uniqueTitles(cells: readonly string[]): string[] {
  const used = new Set<string>()
  return cells.map((cell, i) => {
    let base = tidyName(cell).replace(/[{}]/g, '') || `Column ${columnLetter(i)}`
    if (fieldKey(base) === 'name' && base !== NAME_FIELD) base = NAME_FIELD
    let title = base
    for (let n = 2; used.has(fieldKey(title)); n++) title = `${base} ${n}`
    used.add(fieldKey(title))
    return title
  })
}

/**
 * Rows of a spreadsheet or pasted table. With a header row, its cells name the fields; without one,
 * the columns are "Column A", "Column B"... A Name field is made from the column(s) that look like
 * names (first name and surname are joined) when no column is called Name.
 */
export function fromRows(
  rows: readonly (readonly string[])[],
  headerRow = guessColumns(rows).headerRow,
): RecipientList {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const header = headerRow ? (rows[0] ?? []) : []
  const titles = uniqueTitles(Array.from({ length: width }, (_, i) => header[i] ?? ''))
  const body = (headerRow ? rows.slice(1) : rows).filter((r) => r.some((c) => c.trim() !== ''))
  const hasName = titles.includes(NAME_FIELD)
  const guess = guessColumns(rows)
  const nameColumns = hasName ? [] : guess.nameColumns.filter((c) => c < width)
  if (!hasName && !headerRow && nameColumns.length === 1) titles[nameColumns[0]] = NAME_FIELD
  const madeName = !titles.includes(NAME_FIELD)
  const fields = madeName ? [NAME_FIELD, ...titles] : titles
  const recipients = body.map((cells) => {
    const r: Recipient = {}
    if (madeName)
      r[NAME_FIELD] = nameColumns
        .map((c) => tidyName(cells[c] ?? ''))
        .filter(Boolean)
        .join(' ')
    titles.forEach((t, i) => (r[t] = tidyName(cells[i] ?? '')))
    return r
  })
  return { fields, recipients }
}

/**
 * Text pasted from a spreadsheet (tab separated), a CSV, or simply one name per line. A first line
 * that looks like column titles ("Name, Award") names the fields.
 */
export function fromPasted(text: string): RecipientList {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { fields: [NAME_FIELD], recipients: [] }
  const joined = lines.join('\n')
  let rows: string[][]
  if (joined.includes('\t')) rows = parseCsv(joined, { delimiter: '\t' })
  else {
    // Commas only count as columns when every line has the same number of them, so a list of
    // "Surname, First name" lines from one teacher and a table from another both work.
    const delimiter = [';', ','].find((d) => {
      const counts = lines.map((l) => l.split(d).length - 1)
      return counts[0] > 0 && counts.every((c) => c === counts[0]) && lines.length > 1
    }) as ';' | ',' | undefined
    rows = delimiter ? parseCsv(joined, { delimiter }) : lines.map((l) => [l])
  }
  return fromRows(rows)
}

/** Adds fields every recipient shares (Date, Class...) where the list does not already have them. */
export function withShared(list: RecipientList, shared: Record<string, string>): RecipientList {
  const have = new Set(list.fields.map(fieldKey))
  const extra = Object.entries(shared).filter(([name]) => !have.has(fieldKey(name)))
  if (extra.length === 0) return list
  return {
    fields: [...list.fields, ...extra.map(([n]) => n)],
    recipients: list.recipients.map((r) => ({ ...r, ...Object.fromEntries(extra) })),
  }
}
