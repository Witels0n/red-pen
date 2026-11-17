// The shapes shared by the Answer sheet printer and the reader (OMR).
// Everything here is plain data, so it can cross into the OMR Web Worker unchanged.

import type { LearnerId } from '../classes/types'

export type { LearnerId }

export type SheetVersion = 'A' | 'B' | 'C' | 'D'

/** How a scanned Answer sheet is matched to a learner (see GLOSSARY.md, Sheet identity). */
export type IdentityMode = 'named-qr' | 'id-qr' | 'bubbled-id'

export interface SheetIdentity {
  mode: IdentityMode
  /** The learner this sheet is printed for (QR modes). Absent on a spare sheet and in Bubbled ID mode. */
  learnerId?: LearnerId
  /** Printed on the sheet only in named-qr mode. Never put in the QR. */
  learnerName?: string
  /** Digits in a Learner ID (1 to 4). Sets the columns of the Bubbled ID grid. */
  idDigits: number
}

export interface SheetQuestion {
  /** How many options the question has (2 to 5), lettered A onwards. */
  options: number
}

/** Everything needed to print, and later read, one learner's Answer sheet for one Version. */
export interface SheetSpec {
  /** 6 characters, from assessmentCodeFrom(assessment id). */
  assessmentCode: string
  title: string
  version: SheetVersion
  identity: SheetIdentity
  /** In this Version's order (the order printed on the sheet). */
  questions: SheetQuestion[]
  /** Print only this page (1-based). Omit to print every page the questions need. */
  page?: number
}

/** A rectangle in layout space: PDF points, origin at the top left of the A4 page, y down. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Bubble {
  /** Centre and radius in layout space. */
  cx: number
  cy: number
  r: number
  /** Printed inside the circle in light grey: "A".."E" or "0".."9". */
  label: string
}

export interface TextItem {
  text: string
  /** Left end (or centre, for align "center") of the baseline, in layout space. */
  x: number
  y: number
  size: number
  bold?: boolean
  /** 0 is black, 1 is white. */
  grey?: number
  align?: 'left' | 'center'
  /** The printer shortens text that would be wider than this. */
  maxWidth?: number
}

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
}

export interface QuestionGeometry {
  /** Index of the question in SheetSpec.questions (0-based). */
  index: number
  /** Where the question number is printed (right-aligned baseline end). */
  numberX: number
  numberY: number
  bubbles: Bubble[]
}

export interface IdColumnGeometry {
  /** Position of the digit within the Learner ID (0 is the leftmost digit). */
  digit: number
  /** A box where the learner writes the digit (not read). */
  writeBox: Rect
  /** Ten bubbles, for the digits 0 to 9 from top to bottom. */
  bubbles: Bubble[]
}

/**
 * One printed page, fully positioned. Produced only by layoutSheet or layoutCoverSheet and
 * used by both the printer and the reader, so they can never disagree.
 */
export interface SheetGeometry {
  kind: 'answer-sheet' | 'cover'
  width: number
  height: number
  page: number
  pages: number
  /** Solid squares in the order top left, top right, bottom right, bottom left. */
  fiducials: [Rect, Rect, Rect, Rect]
  /** A solid bar beside the top-left fiducial; the matching spot by the bottom-right one is always blank. */
  orientationMark: Rect
  /** Where the sheet QR is printed (its modules, without the quiet zone). */
  qr: Rect
  qrPayload: string
  /** Text, write-in lines and boxes: drawn by the printer, ignored by the reader. */
  texts: TextItem[]
  lines: Line[]
  /** Filled circles that show how to fill a bubble (in the instructions). */
  examples: Bubble[]
  questions: QuestionGeometry[]
  idColumns: IdColumnGeometry[]
  /** The area inside which everything is printed (keeps clear of printers' unprintable edges). */
  printable: Rect
}

/** A Cover sheet, stapled to the front of a written test so a batch scan can be split per learner. */
export interface CoverSpec {
  learnerId: LearnerId
  learnerName?: string
  /** Printed under the name, for example "Grade 9B". */
  className?: string
  /** Printed on the test line; left blank for the learner to fill in when absent. */
  title?: string
}

export type Answer = number | null | 'multiple'

/** Why a question needs a second look. */
export type QuestionFlag = 'light' | 'erasure' | 'multiple' | 'misaligned'

/** The result of reading one scanned or photographed page. */
export interface SheetRead {
  /** False when the page could not be read at all; problems says why. */
  ok: boolean
  /** 'answer-sheet', or 'cover' when the page turned out to be a Cover sheet. */
  kind?: 'answer-sheet' | 'cover'
  identity: { learnerId?: LearnerId; source: 'qr' | 'bubbles' }
  assessmentCode?: string
  version?: SheetVersion
  page: number
  pages: number
  /** SheetSpec.questions index of answers[0]: 0 on page 1, 50 on page 2. */
  questionStart: number
  /** Per question on this page: the option index (0 is A), null for blank, or 'multiple'. */
  answers: Answer[]
  /** Per question, 0 to 1. Below REVIEW_THRESHOLD needs Review. */
  confidences: number[]
  flags: QuestionFlag[][]
  /** 1 when the Learner ID came from the QR; for Bubbled ID, the weakest digit's confidence. */
  idConfidence: number
  /** Whether anything on this page needs the teacher's Review. */
  needsReview: boolean
  /** Teacher-facing sentences in South African English. */
  problems: string[]
  /** Maps layout points to pixels of the image that was read (3x3, row-major). For Review crops. */
  homography?: number[]
  debug?: ReadDebug
}

export interface ReadDebug {
  fiducials: { x: number; y: number }[]
  rotation: 0 | 90 | 180 | 270
  qrText?: string
  qrSource?: 'crop' | 'full' | 'hint'
  inkLevel: number
  thresholds: { mark: number; faint: number }
  /** Normalised fill per bubble, per question (0 is an empty bubble, 1 is solid printed ink). */
  scores: number[][]
  idScores: number[][]
  /** Local shift (layout points) and outline fit of each group of five questions. */
  alignment: { dx: number; dy: number; fit: number }[]
  /** Per question, the outline fit of its group. */
  fit: number[]
  millis: number
}
