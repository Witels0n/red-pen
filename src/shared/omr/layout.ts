// The one layout function for Answer sheets and Cover sheets. The printer draws exactly what this
// returns and the reader samples exactly where this says, so they can never disagree.
// Pure: no fonts, no DOM. All positions are PDF points in layout space (origin top left, y down).
import { encodeSheetQr } from './qr-payload'
import type {
  Bubble,
  CoverSpec,
  IdColumnGeometry,
  Line,
  QuestionGeometry,
  Rect,
  SheetGeometry,
  SheetSpec,
  TextItem,
} from './types'

export const MM = 72 / 25.4
export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89

export const FIDUCIAL_SIZE = 8 * MM
/** Distance from the page edge to the outer edge of each corner square. */
export const FIDUCIAL_INSET = 9 * MM
export const BUBBLE_RADIUS = 2.3 * MM
export const OPTION_PITCH = 7 * MM
export const QUESTIONS_PER_PAGE = 50
export const MAX_QUESTIONS = 200
export const OPTION_LETTERS = 'ABCDE'

const COLUMNS = 3
const ROWS_PER_COLUMN = 17 // 3 x 17 = 51 >= 50
const COLUMN_PITCH = 63 * MM
const LEFT = 20 * MM
const RIGHT = A4_WIDTH - 20 * MM
const NUMBER_RIGHT = 8 * MM // question number ends this far into the column
const FIRST_BUBBLE = 12.5 * MM // first bubble centre, from the column's left edge
const GROUP_GAP = 2 * MM // extra space after every fifth row, to help learners keep their place
const MIN_ROW_PITCH = 6.6 * MM
const MAX_ROW_PITCH = 8.5 * MM
const ANSWERS_BOTTOM = 274 * MM
const ID_COLUMN_PITCH = 7.5 * MM
const ID_ROW_PITCH = 6.2 * MM
export const QR_RECT: Rect = { x: 163 * MM, y: 20 * MM, w: 26 * MM, h: 26 * MM }

export const PRINTABLE: Rect = { x: 6 * MM, y: 6 * MM, w: A4_WIDTH - 12 * MM, h: A4_HEIGHT - 12 * MM }

/** The four corner squares, top left, top right, bottom right, bottom left. */
export function fiducialRects(): [Rect, Rect, Rect, Rect] {
  const s = FIDUCIAL_SIZE
  const i = FIDUCIAL_INSET
  const r = A4_WIDTH - i - s
  const b = A4_HEIGHT - i - s
  return [
    { x: i, y: i, w: s, h: s },
    { x: r, y: i, w: s, h: s },
    { x: r, y: b, w: s, h: s },
    { x: i, y: b, w: s, h: s },
  ]
}

/** A bar to the right of the top-left square; the same spot rotated 180 degrees is kept blank. */
export const ORIENTATION_MARK: Rect = { x: 20 * MM, y: 11.5 * MM, w: 8 * MM, h: 3 * MM }

/** Where the orientation mark would be if the sheet were upside down. Always blank paper. */
export function rotated180(r: Rect): Rect {
  return { x: A4_WIDTH - r.x - r.w, y: A4_HEIGHT - r.y - r.h, w: r.w, h: r.h }
}

export function centreOf(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Number of pages an Answer sheet for this many questions needs. */
export function pageCount(questions: number): number {
  return Math.max(1, Math.ceil(questions / QUESTIONS_PER_PAGE))
}

function validate(spec: SheetSpec): void {
  const n = spec.questions.length
  if (n < 1 || n > MAX_QUESTIONS) throw new Error(`An Answer sheet needs 1 to ${MAX_QUESTIONS} questions, not ${n}.`)
  spec.questions.forEach((q, i) => {
    if (!Number.isInteger(q.options) || q.options < 2 || q.options > 5) {
      throw new Error(`Question ${i + 1} needs 2 to 5 options, not ${q.options}.`)
    }
  })
  const d = spec.identity.idDigits
  if (!Number.isInteger(d) || d < 1 || d > 4) throw new Error(`A Learner ID has 1 to 4 digits, not ${d}.`)
  if (spec.identity.learnerId !== undefined && spec.identity.learnerId.length !== d) {
    throw new Error(`Learner ID "${spec.identity.learnerId}" should have ${d} digits.`)
  }
}

function bubbleRow(cx0: number, cy: number, count: number, labels: string): Bubble[] {
  return Array.from({ length: count }, (_, o) => ({
    cx: cx0 + o * OPTION_PITCH,
    cy,
    r: BUBBLE_RADIUS,
    label: labels[o],
  }))
}

/** The parts every page shares: corner squares, orientation mark and QR box. */
function frame(): Pick<SheetGeometry, 'width' | 'height' | 'fiducials' | 'orientationMark' | 'qr' | 'printable'> {
  return {
    width: A4_WIDTH,
    height: A4_HEIGHT,
    fiducials: fiducialRects(),
    orientationMark: { ...ORIENTATION_MARK },
    qr: { ...QR_RECT },
    printable: { ...PRINTABLE },
  }
}

function footer(text: string): TextItem {
  return { text, x: A4_WIDTH / 2, y: 286 * MM, size: 7, grey: 0.45, align: 'center' }
}

/** Lays out every page of one learner's Answer sheet (or only spec.page). */
export function layoutSheet(spec: SheetSpec): SheetGeometry[] {
  validate(spec)
  const pages = pageCount(spec.questions.length)
  if (spec.page !== undefined && (spec.page < 1 || spec.page > pages)) {
    throw new Error(`Page ${spec.page} does not exist: this sheet has ${pages}.`)
  }
  const wanted = spec.page === undefined ? Array.from({ length: pages }, (_, i) => i + 1) : [spec.page]
  return wanted.map((page) => layoutPage(spec, page, pages))
}

function layoutPage(spec: SheetSpec, page: number, pages: number): SheetGeometry {
  const { identity } = spec
  const bubbled = identity.mode === 'bubbled-id'
  const learnerId = bubbled ? undefined : identity.learnerId
  const qrPayload = encodeSheetQr({
    kind: 'answer-sheet',
    assessmentCode: spec.assessmentCode,
    version: spec.version,
    learnerId,
    page,
    pages,
  })

  const texts: TextItem[] = []
  const lines: Line[] = []
  const headerWidth = QR_RECT.x - 5 * MM - LEFT
  texts.push({ text: spec.title, x: LEFT, y: 27 * MM, size: 14, bold: true, maxWidth: headerWidth })

  let y = 34.5 * MM
  const writeLine = (label: string, x2: number) => {
    texts.push({ text: label, x: LEFT, y, size: 11 })
    lines.push({ x1: LEFT + 13 * MM, y1: y + 1 * MM, x2, y2: y + 1 * MM, width: 0.6 })
  }
  if (identity.mode === 'named-qr' && identity.learnerName) {
    texts.push({ text: `Name: ${identity.learnerName}`, x: LEFT, y, size: 11, bold: true, maxWidth: headerWidth })
  } else if (identity.mode !== 'id-qr') {
    writeLine('Name:', LEFT + 95 * MM)
  }
  if (identity.mode !== 'id-qr' || identity.learnerName) y += 6.5 * MM

  const pageText = pages > 1 ? `      Page ${page} of ${pages}` : ''
  if (bubbled) {
    texts.push({ text: `Version ${spec.version}${pageText}`, x: LEFT, y, size: 10, maxWidth: headerWidth })
  } else {
    const idText = learnerId ?? '________'
    texts.push({
      text: `Learner ID: ${idText}      Version ${spec.version}${pageText}`,
      x: LEFT,
      y,
      size: 10,
      maxWidth: headerWidth,
    })
  }

  y += 6.5 * MM
  const examples: Bubble[] = [{ cx: LEFT + 2 * MM, cy: y - 1 * MM, r: 1.6 * MM, label: '' }]
  const instructions = [
    'Fill each circle completely with a dark pencil or pen.',
    'To change an answer, cross it out and fill another circle.',
    'Do not write on the black corner squares or on the code.',
  ]
  instructions.forEach((text, i) => {
    texts.push({ text, x: LEFT + (i === 0 ? 5 * MM : 0), y: y + i * 4.5 * MM, size: 8.5, maxWidth: headerWidth })
  })

  let answersTop = 63 * MM
  const idColumns: IdColumnGeometry[] = []
  if (bubbled) {
    texts.push({ text: 'Learner ID', x: LEFT, y: 66 * MM, size: 10, bold: true })
    texts.push({
      text: 'Write your Learner ID in the boxes, one digit per box,',
      x: LEFT + identity.idDigits * ID_COLUMN_PITCH + 12 * MM,
      y: 80 * MM,
      size: 8.5,
    })
    texts.push({
      text: 'then fill the matching circle under each box.',
      x: LEFT + identity.idDigits * ID_COLUMN_PITCH + 12 * MM,
      y: 84.5 * MM,
      size: 8.5,
    })
    for (let d = 0; d < identity.idDigits; d++) {
      const cx = LEFT + 5.5 * MM + d * ID_COLUMN_PITCH
      idColumns.push({
        digit: d,
        writeBox: { x: cx - 3 * MM, y: 68 * MM, w: 6 * MM, h: 7 * MM },
        bubbles: Array.from({ length: 10 }, (_, k) => ({
          cx,
          cy: 79 * MM + k * ID_ROW_PITCH,
          r: BUBBLE_RADIUS,
          label: String(k),
        })),
      })
    }
    answersTop = 142 * MM
  }

  const first = (page - 1) * QUESTIONS_PER_PAGE
  const count = Math.min(QUESTIONS_PER_PAGE, spec.questions.length - first)
  const rows = count <= ROWS_PER_COLUMN ? count : Math.ceil(count / COLUMNS)
  const gaps = Math.floor((rows - 1) / 5)
  const available = ANSWERS_BOTTOM - answersTop - 2 * BUBBLE_RADIUS
  const pitch = Math.max(MIN_ROW_PITCH, Math.min(MAX_ROW_PITCH, (available - gaps * GROUP_GAP) / Math.max(1, rows - 1)))
  const questions: QuestionGeometry[] = []
  for (let k = 0; k < count; k++) {
    const column = Math.floor(k / rows)
    const row = k % rows
    const x0 = LEFT + column * COLUMN_PITCH
    const cy = answersTop + BUBBLE_RADIUS + row * pitch + Math.floor(row / 5) * GROUP_GAP
    const index = first + k
    questions.push({
      index,
      numberX: x0 + NUMBER_RIGHT,
      numberY: cy + 3.2,
      bubbles: bubbleRow(x0 + FIRST_BUBBLE, cy, spec.questions[index].options, OPTION_LETTERS),
    })
  }

  return {
    kind: 'answer-sheet',
    ...frame(),
    page,
    pages,
    qrPayload,
    texts: [
      ...texts,
      footer(
        `Red Pen answer sheet  |  ${spec.assessmentCode}  |  Version ${spec.version}  |  Page ${page} of ${pages}`,
      ),
    ],
    lines,
    examples,
    questions,
    idColumns,
  }
}

/** Lays out a Cover sheet: the same corner squares and QR position as an Answer sheet. */
export function layoutCoverSheet(cover: CoverSpec): SheetGeometry {
  const qrPayload = encodeSheetQr({ kind: 'cover', learnerId: cover.learnerId })
  const mid = A4_WIDTH / 2
  const texts: TextItem[] = [
    { text: 'Cover sheet', x: LEFT, y: 27 * MM, size: 14, bold: true },
    { text: 'Staple this page on top of your test.', x: LEFT, y: 34 * MM, size: 9 },
    { text: 'Do not write on the black corner squares or on the code.', x: LEFT, y: 39 * MM, size: 9 },
  ]
  if (cover.learnerName) {
    texts.push({
      text: cover.learnerName,
      x: mid,
      y: 115 * MM,
      size: 30,
      bold: true,
      align: 'center',
      maxWidth: 165 * MM,
    })
  }
  if (cover.className) {
    texts.push({ text: cover.className, x: mid, y: 128 * MM, size: 14, align: 'center', maxWidth: 165 * MM })
  }
  texts.push({ text: `Learner ID ${cover.learnerId}`, x: mid, y: 146 * MM, size: 20, bold: true, align: 'center' })
  const lines: Line[] = []
  const testY = 180 * MM
  if (cover.title) {
    texts.push({
      text: `Test: ${cover.title}`,
      x: LEFT + 10 * MM,
      y: testY,
      size: 13,
      maxWidth: RIGHT - LEFT - 20 * MM,
    })
  } else {
    texts.push({ text: 'Test:', x: LEFT + 10 * MM, y: testY, size: 13 })
    lines.push({ x1: LEFT + 24 * MM, y1: testY + 1 * MM, x2: RIGHT - 10 * MM, y2: testY + 1 * MM, width: 0.6 })
  }
  texts.push({ text: 'Date:', x: LEFT + 10 * MM, y: testY + 15 * MM, size: 13 })
  lines.push({ x1: LEFT + 24 * MM, y1: testY + 16 * MM, x2: LEFT + 90 * MM, y2: testY + 16 * MM, width: 0.6 })
  texts.push(footer('Red Pen cover sheet'))
  return {
    kind: 'cover',
    ...frame(),
    page: 1,
    pages: 1,
    qrPayload,
    texts,
    lines,
    examples: [],
    questions: [],
    idColumns: [],
  }
}

/** The bounding box of a question's bubbles plus its number, for Review crops. */
export function questionRect(q: QuestionGeometry, pad = 2 * MM): Rect {
  const last = q.bubbles[q.bubbles.length - 1]
  const x = q.numberX - 8 * MM
  const y = q.bubbles[0].cy - BUBBLE_RADIUS - pad
  return { x, y, w: last.cx + BUBBLE_RADIUS + pad - x, h: 2 * (BUBBLE_RADIUS + pad) }
}
