// Where everything in a question booklet goes: question numbers, text, options and pictures, with
// page breaks. Pure (text wrapping is passed in), so the layout can be tested without drawing.
// Positions are in PDF points from the top left of the page, y down.
import { fitImage } from '../core/images'
import { MM } from '../../shared/omr/layout'

export const QUESTION_SIZE = 11
export const OPTION_SIZE = 10.5
export const LEADING = 1.35
/** The tallest a question's own picture is drawn. */
export const QUESTION_IMAGE_MAX = 70 * MM
/** The tallest an option's picture is drawn. */
export const OPTION_IMAGE_MAX = 42 * MM

export interface Size {
  width: number
  height: number
}

/** One question as printed: its options already in the printed order. */
export interface BookletQuestion {
  /** As printed, from 1. */
  number: number
  /** "(2 marks)", or empty for one mark. */
  marks: string
  text: string
  image: Size | null
  options: { text: string; image: Size | null }[]
}

export interface BookletFrame {
  left: number
  width: number
  /** Where the questions start on the first page (below the title block). */
  firstTop: number
  /** Where the questions start on every later page (below the running header). */
  top: number
  bottom: number
}

export type Wrap = (text: string, size: number, width: number) => string[]

export type Placed =
  | {
      kind: 'text'
      page: number
      x: number
      /** The baseline. */
      y: number
      text: string
      size: number
      bold?: boolean
      muted?: boolean
      align?: 'right'
    }
  | {
      kind: 'image'
      page: number
      x: number
      /** The top edge. */
      y: number
      width: number
      height: number
      /** Which printed question (index) and which printed option (null for the question's own picture). */
      question: number
      option: number | null
    }

const NUMBER_WIDTH = 10 * MM
const LETTER_WIDTH = 7 * MM
const COLUMN_GAP = 6 * MM
const PICTURE_GAP = 1.5 * MM
const OPTION_GAP = 1.5
const QUESTION_GAP = 5 * MM

interface Block {
  height: number
  /** Draws the block with its top at y on the given page. */
  place: (page: number, y: number, out: Placed[]) => void
}

/** A block of option cells side by side (one cell when the options are in a single column). */
function optionRow(
  q: BookletQuestion,
  index: number,
  cells: number[],
  x0: number,
  cellWidth: number,
  wrap: Wrap,
): Block {
  const lineH = OPTION_SIZE * LEADING
  const laid = cells.map((k) => {
    const o = q.options[k]
    const textWidth = cellWidth - LETTER_WIDTH
    const lines = o.text.trim() ? wrap(o.text, OPTION_SIZE, textWidth) : []
    const image = o.image ? fitImage(o.image, textWidth, OPTION_IMAGE_MAX) : null
    const textH = lines.length * lineH
    const height = Math.max(lineH, textH + (image ? (lines.length ? PICTURE_GAP : 0) + image.height : 0))
    return { k, lines, image, textH, height }
  })
  const height = Math.max(...laid.map((c) => c.height)) + OPTION_GAP
  return {
    height,
    place(page, y, out) {
      laid.forEach((c, col) => {
        const x = x0 + col * (cellWidth + COLUMN_GAP)
        out.push({ kind: 'text', page, x, y: y + OPTION_SIZE, text: 'ABCDE'[c.k], size: OPTION_SIZE, bold: true })
        c.lines.forEach((line, i) =>
          out.push({
            kind: 'text',
            page,
            x: x + LETTER_WIDTH,
            y: y + OPTION_SIZE + i * lineH,
            text: line,
            size: OPTION_SIZE,
          }),
        )
        if (c.image) {
          // Beside the letter when there is no text; under the text otherwise.
          const top = c.lines.length ? y + c.textH + PICTURE_GAP : y + 1
          out.push({ kind: 'image', page, x: x + LETTER_WIDTH, y: top, ...c.image, question: index, option: c.k })
        }
      })
    },
  }
}

/** The blocks of one question: its number and text, its picture, then its options (two columns when they have pictures). */
function questionBlocks(q: BookletQuestion, index: number, frame: BookletFrame, wrap: Wrap): Block[] {
  const lineH = QUESTION_SIZE * LEADING
  const textX = frame.left + NUMBER_WIDTH
  const textWidth = frame.width - NUMBER_WIDTH
  const blocks: Block[] = []
  const lines = q.text.trim() ? wrap(q.text, QUESTION_SIZE, textWidth) : []

  // The number goes with the first line of text (or stands alone).
  blocks.push({
    height: lineH,
    place(page, y, out) {
      out.push({
        kind: 'text',
        page,
        x: frame.left,
        y: y + QUESTION_SIZE,
        text: `${q.number}.`,
        size: QUESTION_SIZE,
        bold: true,
      })
      if (q.marks)
        out.push({
          kind: 'text',
          page,
          x: frame.left + frame.width,
          y: y + QUESTION_SIZE,
          text: q.marks,
          size: 9,
          muted: true,
          align: 'right',
        })
      if (lines[0])
        out.push({ kind: 'text', page, x: textX, y: y + QUESTION_SIZE, text: lines[0], size: QUESTION_SIZE })
    },
  })
  for (const line of lines.slice(1)) {
    blocks.push({
      height: lineH,
      place: (page, y, out) =>
        out.push({ kind: 'text', page, x: textX, y: y + QUESTION_SIZE, text: line, size: QUESTION_SIZE }),
    })
  }
  if (q.image) {
    const size = fitImage(q.image, textWidth, QUESTION_IMAGE_MAX)
    blocks.push({
      height: PICTURE_GAP + size.height,
      place: (page, y, out) =>
        out.push({ kind: 'image', page, x: textX, y: y + PICTURE_GAP, ...size, question: index, option: null }),
    })
  }
  blocks.push({ height: PICTURE_GAP, place: () => undefined })

  const pictures = q.options.some((o) => o.image)
  const keys = q.options.map((_, k) => k)
  if (pictures) {
    const cellWidth = (textWidth - COLUMN_GAP) / 2
    for (let k = 0; k < keys.length; k += 2)
      blocks.push(optionRow(q, index, keys.slice(k, k + 2), textX, cellWidth, wrap))
  } else {
    for (const k of keys) blocks.push(optionRow(q, index, [k], textX, textWidth, wrap))
  }
  return blocks
}

/**
 * Lays out every question. A question stays on one page when it fits on one; a longer one breaks
 * between its lines and option rows, never through an option (its text and picture stay together).
 */
export function layoutBooklet(
  questions: readonly BookletQuestion[],
  frame: BookletFrame,
  wrap: Wrap,
): { placed: Placed[]; pages: number } {
  const placed: Placed[] = []
  let page = 0
  let y = frame.firstTop
  const pageRoom = frame.bottom - frame.top
  const newPage = () => {
    page++
    y = frame.top
  }

  questions.forEach((q, index) => {
    const blocks = questionBlocks(q, index, frame, wrap)
    const total = blocks.reduce((s, b) => s + b.height, 0)
    if (total <= pageRoom) {
      if (y + total > frame.bottom) newPage()
    } else {
      // Too long for any page: at least start it with its first lines and an option on this page.
      const start = blocks.slice(0, 3).reduce((s, b) => s + b.height, 0)
      if (y + Math.min(start, pageRoom) > frame.bottom) newPage()
    }
    for (const b of blocks) {
      if (y + b.height > frame.bottom && y > frame.top) newPage()
      b.place(page, y, placed)
      y += b.height
    }
    y += QUESTION_GAP
  })
  return { placed, pages: page + 1 }
}
