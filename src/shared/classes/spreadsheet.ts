import { parseCsv } from './csv'

export interface ImportedSheet {
  name: string
  /** Every row has the same number of cells; trailing empty rows are dropped. */
  rows: string[][]
}

export interface ImportedSpreadsheet {
  sheets: ImportedSheet[]
}

/** A spreadsheet that could not be read, with a message to show the teacher. */
export class SpreadsheetError extends Error {
  override name = 'SpreadsheetError'
}

/** What the file picker should offer. */
export const SPREADSHEET_ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** The parts of a File that importing needs, so tests can pass a plain object. */
export interface SpreadsheetFile {
  name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b // "PK": an .xlsx is a zip archive
}

function isOldExcel(bytes: Uint8Array): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

/** Pads rows to the same width and drops empty rows at the end. */
export function normaliseRows(rows: string[][]): string[][] {
  let end = rows.length
  while (end > 0 && rows[end - 1].every((c) => c.trim() === '')) end--
  const kept = rows.slice(0, end)
  const width = Math.max(0, ...kept.map((r) => r.length))
  return kept.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r))
}

function two(n: number): string {
  return String(n).padStart(2, '0')
}

/** One spreadsheet cell as text: numbers without a trailing ".0", dates as 2026-11-17. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return `${value.getUTCFullYear()}-${two(value.getUTCMonth() + 1)}-${two(value.getUTCDate())}`
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Older Excel saves "CSV" in the Windows-1252 code page, not UTF-8.
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** A text file's contents, read as UTF-8 or, failing that, as Windows-1252. */
export async function readTextFile(file: SpreadsheetFile): Promise<string> {
  return decodeText(new Uint8Array(await file.arrayBuffer()))
}

async function readXlsx(buffer: ArrayBuffer): Promise<ImportedSheet[]> {
  // Loaded only when an .xlsx is chosen, so other pages and plain CSV imports never pay for it.
  // The universal build parses on the page itself: no worker and no network.
  const { default: readXlsxFile } = await import('read-excel-file/universal')
  let sheets
  try {
    sheets = await readXlsxFile(buffer)
  } catch {
    throw new SpreadsheetError('This Excel file could not be read. Try saving it again as .xlsx or CSV.')
  }
  return sheets.map((s) => ({ name: s.sheet, rows: normaliseRows(s.data.map((row) => row.map(cellText))) }))
}

/** Reads a .csv or .xlsx file into sheets of text cells. A CSV has one sheet, named after the file. */
export async function importSpreadsheet(file: SpreadsheetFile): Promise<ImportedSpreadsheet> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const lower = file.name.toLowerCase()

  if (isOldExcel(bytes) || lower.endsWith('.xls')) {
    throw new SpreadsheetError(
      'Old .xls files cannot be read. In Excel, choose Save As and pick Excel Workbook (.xlsx) or CSV.',
    )
  }
  if (lower.endsWith('.ods')) {
    throw new SpreadsheetError('OpenDocument (.ods) files cannot be read. Save it as .xlsx or CSV first.')
  }

  let sheets: ImportedSheet[]
  if (isZip(bytes) || lower.endsWith('.xlsx')) {
    sheets = await readXlsx(buffer)
  } else {
    if (bytes.includes(0)) throw new SpreadsheetError('This file is not a spreadsheet. Choose a .csv or .xlsx file.')
    sheets = [
      { name: file.name.replace(/\.[^.]+$/, '') || 'Sheet 1', rows: normaliseRows(parseCsv(decodeText(bytes))) },
    ]
  }
  if (sheets.every((s) => s.rows.length === 0)) throw new SpreadsheetError('This spreadsheet is empty.')
  return { sheets }
}
