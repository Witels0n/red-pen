// Turns a payload into the grid of dark and light modules, using qrcode-generator.
import qrcode from 'qrcode-generator'

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H'

/** The square grid of a QR code, without its quiet zone. */
export interface QrMatrix {
  size: number
  isDark(row: number, col: number): boolean
}

/** The most bytes a QR code (version 40) can hold at each error correction level. */
export const MAX_BYTES: Record<ErrorCorrection, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 }

/** The payload's length in bytes when encoded as UTF-8, which is what the code stores. */
export function byteLength(payload: string): number {
  return new TextEncoder().encode(payload).length
}

export type MatrixResult = { ok: true; matrix: QrMatrix } | { ok: false; reason: 'empty' | 'too-long' }

/**
 * Encodes the payload as UTF-8 bytes in byte mode, choosing the smallest version that fits.
 * qrcode-generator maps each character to one byte, so the UTF-8 bytes are handed to it
 * as a string of single-byte characters.
 */
export function makeMatrix(payload: string, level: ErrorCorrection): MatrixResult {
  if (payload === '') return { ok: false, reason: 'empty' }
  const bytes = new TextEncoder().encode(payload)
  if (bytes.length > MAX_BYTES[level]) return { ok: false, reason: 'too-long' }
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const qr = qrcode(0, level)
  qr.addData(binary, 'Byte')
  try {
    qr.make()
  } catch {
    return { ok: false, reason: 'too-long' }
  }
  const size = qr.getModuleCount()
  return { ok: true, matrix: { size, isDark: (r, c) => qr.isDark(r, c) } }
}

/** A plain matrix from rows of "1" and "0", for tests. */
export function matrixFromRows(rows: string[]): QrMatrix {
  return { size: rows.length, isDark: (r, c) => rows[r]?.[c] === '1' }
}
