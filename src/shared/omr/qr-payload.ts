// The text inside a sheet QR. It holds only codes and the Learner ID, never a name (spec: Privacy).
//
//   Answer sheet: RP1|<assessment code>|<version>|<learner id or ->|<page>/<pages>
//                 RP1|K7QM2X|B|0042|1/2
//   Cover sheet:  RP1|COVER|-|<learner id>|1/1
//                 RP1|COVER|-|0042|1/1
import type { LearnerId, SheetVersion } from './types'

/** Letters and digits that cannot be confused when read aloud or written down (no 0, O, 1, I). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/
const LEARNER_RE = /^\d{1,4}$/
const VERSION_RE = /^[A-D]$/
const COVER = 'COVER'
const PREFIX = 'RP1'

export type SheetQr =
  | {
      kind: 'answer-sheet'
      assessmentCode: string
      version: SheetVersion
      /** Absent on Bubbled ID and spare sheets (the QR holds "-"). */
      learnerId?: LearnerId
      page: number
      pages: number
    }
  | { kind: 'cover'; learnerId: LearnerId }

/** The 6-character Assessment code for an Assessment id: stable, and the same on every device. */
export function assessmentCodeFrom(id: string): string {
  // FNV-1a, then a second mixing round so similar ids spread out; 30 bits become 6 characters.
  let h = 0x811c9dc5
  for (const ch of new TextEncoder().encode(id)) {
    h ^= ch
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[h & 31]
    h >>>= 5
  }
  return code
}

export function isAssessmentCode(s: string): boolean {
  return CODE_RE.test(s)
}

export function isLearnerId(s: string): boolean {
  return LEARNER_RE.test(s)
}

/** Throws on anything that would not decode again, so a bad sheet can never be printed. */
export function encodeSheetQr(qr: SheetQr): string {
  if (qr.kind === 'cover') {
    if (!isLearnerId(qr.learnerId)) throw new Error(`Learner ID "${qr.learnerId}" must be 1 to 4 digits.`)
    return `${PREFIX}|${COVER}|-|${qr.learnerId}|1/1`
  }
  if (!isAssessmentCode(qr.assessmentCode)) throw new Error(`Assessment code "${qr.assessmentCode}" is not valid.`)
  if (!VERSION_RE.test(qr.version)) throw new Error(`Version "${qr.version}" must be A to D.`)
  if (qr.learnerId !== undefined && !isLearnerId(qr.learnerId)) {
    throw new Error(`Learner ID "${qr.learnerId}" must be 1 to 4 digits.`)
  }
  if (!validPages(qr.page, qr.pages)) throw new Error(`Page ${qr.page} of ${qr.pages} is not valid.`)
  return `${PREFIX}|${qr.assessmentCode}|${qr.version}|${qr.learnerId ?? '-'}|${qr.page}/${qr.pages}`
}

function validPages(page: number, pages: number): boolean {
  return Number.isInteger(page) && Number.isInteger(pages) && page >= 1 && pages >= 1 && page <= pages && pages <= 9
}

/** Parses a scanned QR text. Returns null for anything that is not exactly a Red Pen sheet QR. */
export function decodeSheetQr(text: string): SheetQr | null {
  const parts = text.split('|')
  if (parts.length !== 5 || parts[0] !== PREFIX) return null
  const [, code, version, learner, pageText] = parts
  const pm = /^([1-9])\/([1-9])$/.exec(pageText)
  if (!pm) return null
  const page = Number(pm[1])
  const pages = Number(pm[2])
  if (!validPages(page, pages)) return null
  if (code === COVER) {
    if (version !== '-' || !isLearnerId(learner) || page !== 1 || pages !== 1) return null
    return { kind: 'cover', learnerId: learner }
  }
  if (!isAssessmentCode(code) || !VERSION_RE.test(version)) return null
  if (learner !== '-' && !isLearnerId(learner)) return null
  return {
    kind: 'answer-sheet',
    assessmentCode: code,
    version: version as SheetVersion,
    ...(learner === '-' ? {} : { learnerId: learner }),
    page,
    pages,
  }
}
