// The marksheet as an Excel file. The writer is loaded on first use, so the page stays light.
import type { SheetData } from 'write-excel-file/browser'

export interface XlsxSheet {
  name: string
  rows: (string | number | null)[][]
  /** Column widths in characters. */
  widths?: number[]
}

export async function writeXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const blob = await writeXlsxFile(
    sheets.map((s) => ({
      data: s.rows.map((row, r) =>
        row.map((value) =>
          value === null ? null : r === 0 ? { value: String(value), fontWeight: 'bold' as const } : { value },
        ),
      ) as SheetData,
      // Excel sheet names: at most 31 characters, none of : \ / ? * [ ]
      sheet: s.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31),
      stickyRowsCount: 1,
      ...(s.widths ? { columns: s.widths.map((width) => ({ width })) } : {}),
    })),
  ).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
