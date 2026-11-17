// Prints a worksheet and its memo as one A4 PDF: the worksheet pages first, then the memo pages,
// which repeat every activity with the answers filled in red.
import type { PDFDocument, PDFImage } from 'pdf-lib'
import { columnLetter, type ActivityBody, type GeneratedActivity, type GeneratedWorksheet } from '../core/generate'
import type { DiagramPicture } from '../core/model'
import { lengthHint } from '../core/text'
import {
  BOTTOM,
  circle,
  CONTENT_WIDTH,
  ellipse,
  fitSize,
  Flow,
  highlight,
  INK,
  line,
  MARGIN,
  MEMO,
  MM,
  MUTED,
  newDocument,
  rect,
  RULE,
  text,
  WHITE,
  widthOf,
  wrap,
  A4_HEIGHT,
  A4_WIDTH,
  type Fonts,
} from './layout'

export type PrintPart = 'both' | 'worksheet' | 'memo'

interface Ctx {
  flow: Flow
  fonts: Fonts
  memo: boolean
  images: Map<string, PDFImage>
}

const LEFT = MARGIN
const RIGHT = A4_WIDTH - MARGIN
const BODY = 10.5

// ---------- Shared pieces ----------

/** Wrapped text from y (top of the first line); returns the y below the last line. */
function paragraph(
  ctx: Ctx,
  s: string,
  o: { font?: keyof Fonts; size?: number; lead?: number; x?: number; width?: number; color?: typeof INK } = {},
): void {
  const font = ctx.fonts[o.font ?? 'regular']
  const size = o.size ?? BODY
  const lead = o.lead ?? size * 1.35
  const x = o.x ?? LEFT
  for (const l of wrap(font, s, size, o.width ?? CONTENT_WIDTH)) {
    ctx.flow.ensure(lead)
    text(ctx.flow.page, l, x, ctx.flow.y + size, { font, size, color: o.color ?? INK })
    ctx.flow.y += lead
  }
}

function wordBank(ctx: Ctx, words: readonly string[]): void {
  if (words.length === 0) return
  const { fonts } = ctx
  const size = 10.5
  const pad = 3 * MM
  const gap = 7 * MM
  // Lay the words out in rows, wide gaps between them.
  const rows: string[][] = [[]]
  let x = 0
  const inner = CONTENT_WIDTH - 2 * pad
  for (const w of words) {
    const wd = widthOf(fonts.regular, w, size)
    if (x > 0 && x + wd > inner) {
      rows.push([])
      x = 0
    }
    rows[rows.length - 1].push(w)
    x += wd + gap
  }
  const lead = size * 1.6
  const h = pad * 2 + 12 + rows.length * lead
  ctx.flow.ensure(h + 4 * MM)
  const { page, y } = ctx.flow
  rect(page, LEFT, y, CONTENT_WIDTH, h, { border: RULE, borderWidth: 0.8 })
  text(page, 'Word bank', LEFT + pad, y + pad + 8, { font: fonts.bold, size: 8.5, color: MUTED })
  rows.forEach((row, i) => {
    let cx = LEFT + pad
    for (const w of row) {
      text(page, w, cx, y + pad + 12 + i * lead + size, { font: fonts.regular, size })
      cx += widthOf(fonts.regular, w, size) + gap
    }
  })
  ctx.flow.y += h + 4 * MM
}

/** Memo text in red on an answer line, shrunk to fit. */
function answerOn(ctx: Ctx, s: string, x: number, baseline: number, width: number, align: 'left' | 'center' = 'left') {
  if (!ctx.memo || s === '') return
  const size = fitSize(ctx.fonts.bold, s, 10.5, width)
  text(ctx.flow.page, s, align === 'center' ? x + width / 2 : x + 1, baseline - 2, {
    font: ctx.fonts.bold,
    size,
    color: MEMO,
    align,
  })
}

// ---------- Activities ----------

function wordSearchGeometry(b: Extract<ActivityBody, { type: 'wordsearch' }>) {
  const n = b.puzzle.size
  const listWidth = 42 * MM
  const cell = Math.min(9 * MM, (CONTENT_WIDTH - listWidth - 6 * MM) / n, (150 * MM) / n)
  const gw = cell * n
  const count = b.puzzle.placed.length
  const listLead = 15
  const besides = CONTENT_WIDTH - gw - 6 * MM >= listWidth && count * listLead <= Math.max(gw, 150 * MM)
  const listRows = besides ? count : Math.ceil(count / 4)
  const listHeight = listRows * listLead
  const height = besides ? Math.max(gw, listHeight) : gw + 5 * MM + listHeight
  return { cell, gw, besides, height, listLead }
}

function crosswordGrid(b: Extract<ActivityBody, { type: 'crossword' }>) {
  const p = b.puzzle
  const cell = Math.min(8.5 * MM, CONTENT_WIDTH / Math.max(1, p.cols), (125 * MM) / Math.max(1, p.rows))
  return { cell, gw: cell * p.cols, gh: cell * p.rows }
}

function pictureSize(b: Extract<ActivityBody, { type: 'labelling' }>) {
  if (!b.picture) return { w: 0, h: 0 }
  const scale = Math.min(CONTENT_WIDTH / b.picture.width, (115 * MM) / b.picture.height)
  return { w: b.picture.width * scale, h: b.picture.height * scale }
}

/** How much room the start of an activity needs, so its heading never sits alone at the foot of a page. */
function openingHeight(b: ActivityBody): number {
  switch (b.type) {
    case 'wordsearch':
      return wordSearchGeometry(b).height
    case 'crossword':
      return crosswordGrid(b).gh + 25 * MM
    case 'labelling':
      return pictureSize(b).h + (b.bank ? 20 * MM : 0)
    default:
      return 30 * MM
  }
}

function drawWordSearch(ctx: Ctx, b: Extract<ActivityBody, { type: 'wordsearch' }>): void {
  const { fonts } = ctx
  const p = b.puzzle
  const n = p.size
  const { cell, gw, besides, height, listLead } = wordSearchGeometry(b)
  const words = p.placed.map((w) => w.word)
  ctx.flow.ensure(height + 4 * MM)
  const { page } = ctx.flow
  const top = ctx.flow.y
  rect(page, LEFT, top, gw, gw, { border: INK, borderWidth: 1 })
  if (ctx.memo) {
    for (const w of p.placed) {
      const cx = (c: number) => LEFT + (c + 0.5) * cell
      const cy = (r: number) => top + (r + 0.5) * cell
      const end = w.letters.length - 1
      highlight(page, cx(w.col), cy(w.row), cx(w.col + w.dc * end), cy(w.row + w.dr * end), cell * 0.78)
    }
  }
  const size = cell * 0.55
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const ch = b.lowerCase ? p.grid[r][c].toLocaleLowerCase('en-ZA') : p.grid[r][c]
      text(page, ch, LEFT + (c + 0.5) * cell, top + (r + 0.5) * cell + size * 0.36, {
        font: fonts.bold,
        size,
        align: 'center',
      })
    }
  }
  // The word list, each with a box to tick when found.
  const box = 3 * MM
  const shown = b.lowerCase ? words.map((w) => w.toLocaleLowerCase('en-ZA')) : words
  shown.forEach((w, i) => {
    const colW = CONTENT_WIDTH / 4
    const x = besides ? LEFT + gw + 6 * MM : LEFT + (i % 4) * colW
    const y = besides ? top + i * listLead : top + gw + 5 * MM + Math.floor(i / 4) * listLead
    const width = besides ? RIGHT - x - box - 2 * MM : colW - box - 3 * MM
    rect(page, x, y + 1, box, box, { border: MUTED, borderWidth: 0.6 })
    const s = fitSize(fonts.regular, w, 10, width)
    text(page, w, x + box + 2 * MM, y + box, { font: fonts.regular, size: s })
  })
  ctx.flow.y = top + height + 4 * MM
}

function drawCrossword(ctx: Ctx, b: Extract<ActivityBody, { type: 'crossword' }>): void {
  const { fonts } = ctx
  const p = b.puzzle
  if (p.words.length === 0) return
  const { cell, gw, gh } = crosswordGrid(b)
  // Clues in two columns, Across and Down.
  const colW = (CONTENT_WIDTH - 8 * MM) / 2
  const size = 10
  const lead = 13
  const clueLines = (dir: 'across' | 'down') =>
    p.words
      .filter((w) => w.direction === dir)
      .map((w) => {
        const label = `${w.number}.`
        const clue = b.showLengths ? `${w.clue} ${lengthHint(w.answer)}` : w.clue
        return { label, lines: wrap(fonts.regular, clue, size, colW - 7 * MM), answer: w.answer }
      })
  const columns = [
    { title: 'Across', items: clueLines('across') },
    { title: 'Down', items: clueLines('down') },
  ]
  const heightOf = (items: ReturnType<typeof clueLines>) =>
    lead * 1.3 + items.reduce((s, i) => s + i.lines.length * lead + 3, 0)
  const tallest = Math.max(...columns.map((c) => heightOf(c.items)))
  // Keep the grid and its clues together when they fit on one page.
  const together = gh + 5 * MM + tallest
  ctx.flow.ensure(together <= BOTTOM - MARGIN - 20 * MM ? together : gh + 4 * MM)
  const { page } = ctx.flow
  const top = ctx.flow.y
  const x0 = LEFT + (CONTENT_WIDTH - gw) / 2
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      if (p.cells[r][c] === '') continue
      const x = x0 + c * cell
      const y = top + r * cell
      rect(page, x, y, cell, cell, { fill: WHITE, border: INK, borderWidth: 0.8 })
      const num = p.numbers[r][c]
      if (num) text(page, String(num), x + 1.2, y + cell * 0.3 + 1, { font: fonts.regular, size: cell * 0.28 })
      if (ctx.memo) {
        const size = cell * 0.55
        text(page, p.cells[r][c], x + cell / 2, y + cell * 0.5 + size * 0.42, {
          font: fonts.bold,
          size,
          color: MEMO,
          align: 'center',
        })
      }
    }
  }
  ctx.flow.y = top + gh + 5 * MM

  if (tallest <= BOTTOM - MARGIN - 20 * MM) {
    ctx.flow.ensure(tallest)
    const top2 = ctx.flow.y
    columns.forEach((col, ci) => {
      const x = LEFT + ci * (colW + 8 * MM)
      let y = top2
      text(ctx.flow.page, col.title, x, y + size, { font: fonts.bold, size: 11 })
      y += lead * 1.3
      for (const item of col.items) {
        text(ctx.flow.page, item.label, x, y + size, { font: fonts.bold, size })
        item.lines.forEach((l, li) =>
          text(ctx.flow.page, l, x + 7 * MM, y + size + li * lead, { font: fonts.regular, size }),
        )
        y += item.lines.length * lead + 3
      }
    })
    ctx.flow.y = top2 + tallest + 2 * MM
  } else {
    // A very long list of clues: one column that can run over pages.
    for (const col of columns) {
      ctx.flow.ensure(lead * 2)
      text(ctx.flow.page, col.title, LEFT, ctx.flow.y + size, { font: fonts.bold, size: 11 })
      ctx.flow.y += lead * 1.3
      for (const item of col.items) {
        ctx.flow.ensure(item.lines.length * lead)
        text(ctx.flow.page, item.label, LEFT, ctx.flow.y + size, { font: fonts.bold, size })
        item.lines.forEach((l, li) =>
          text(ctx.flow.page, l, LEFT + 7 * MM, ctx.flow.y + size + li * lead, { font: fonts.regular, size }),
        )
        ctx.flow.y += item.lines.length * lead + 3
      }
    }
  }
}

function drawMatch(ctx: Ctx, b: Extract<ActivityBody, { type: 'match' }>): void {
  const { fonts } = ctx
  const size = BODY
  const lead = 13.5
  const box = 7 * MM
  const colA = CONTENT_WIDTH * 0.47
  const xB = LEFT + CONTENT_WIDTH * 0.53
  const colB = RIGHT - xB
  const num = 7 * MM
  ctx.flow.ensure(lead * 3)
  text(ctx.flow.page, 'Column A', LEFT, ctx.flow.y + size, { font: fonts.bold, size })
  text(ctx.flow.page, 'Column B', xB, ctx.flow.y + size, { font: fonts.bold, size })
  ctx.flow.y += lead * 1.5
  const rows = Math.max(b.left.length, b.right.length)
  for (let i = 0; i < rows; i++) {
    const left = b.left[i] !== undefined ? wrap(fonts.regular, b.left[i], size, colA - num - box - 4 * MM) : []
    const right = b.right[i] !== undefined ? wrap(fonts.regular, b.right[i], size, colB - num) : []
    const h = Math.max(left.length, right.length, 1) * lead + 3 * MM
    const rowH = Math.max(h, box + 3 * MM)
    ctx.flow.ensure(rowH)
    const { page, y } = ctx.flow
    if (left.length) {
      text(page, `${i + 1}.`, LEFT, y + size, { font: fonts.bold, size })
      left.forEach((l, li) => text(page, l, LEFT + num, y + size + li * lead, { font: fonts.regular, size }))
      const bx = LEFT + colA - box
      rect(page, bx, y - 3, box, box, { border: INK, borderWidth: 0.8 })
      if (ctx.memo)
        text(page, b.answers[i], bx + box / 2, y - 3 + box / 2 + 4, {
          font: fonts.bold,
          size: 11,
          color: MEMO,
          align: 'center',
        })
    }
    if (right.length) {
      text(page, `${columnLetter(i)}.`, xB, y + size, { font: fonts.bold, size })
      right.forEach((l, li) => text(page, l, xB + num, y + size + li * lead, { font: fonts.regular, size }))
    }
    ctx.flow.y += rowH
  }
  ctx.flow.y += 2 * MM
}

function drawBlanks(ctx: Ctx, b: Extract<ActivityBody, { type: 'blanks' }>): void {
  const { fonts } = ctx
  if (b.bank) wordBank(ctx, b.bank)
  const size = 11
  const lead = 24
  const numSize = 7.5
  const answers = b.segments.flatMap((s) => (s.kind === 'blank' ? [s.answer] : []))
  const blankW = Math.min(
    CONTENT_WIDTH * 0.6,
    Math.max(24 * MM, ...answers.map((a) => widthOf(fonts.bold, a, size) + 6 * MM)),
  )
  const space = widthOf(fonts.regular, ' ', size)
  let x = LEFT
  let started = false
  const newLine = () => {
    ctx.flow.y += lead
    x = LEFT
  }
  const startIfNeeded = () => {
    if (!started) {
      ctx.flow.ensure(lead)
      started = true
    }
  }
  const place = (w: number) => {
    startIfNeeded()
    if (x > LEFT && x + w > RIGHT) newLine()
    if (ctx.flow.y + lead > BOTTOM) {
      ctx.flow.newPage()
      x = LEFT
    }
  }
  for (const seg of b.segments) {
    if (seg.kind === 'blank') {
      const label = `(${seg.number})`
      const lw = widthOf(fonts.regular, label, numSize) + 1.5
      place(lw + blankW)
      const base = ctx.flow.y + size + 6
      text(ctx.flow.page, label, x, base, { font: fonts.regular, size: numSize, color: MUTED })
      line(ctx.flow.page, x + lw, base + 2, x + lw + blankW, base + 2, 0.7, INK)
      answerOn(ctx, seg.answer, x + lw, base, blankW, 'center')
      x += lw + blankW
      continue
    }
    const paragraphs = seg.text.split(/\r\n|\r|\n/)
    paragraphs.forEach((para, pi) => {
      if (pi > 0) {
        startIfNeeded()
        newLine()
      }
      const words = para.split(/(\s+)/)
      for (const w of words) {
        if (w === '') continue
        if (/^\s+$/.test(w)) {
          if (x > LEFT) x += space
          continue
        }
        const ww = widthOf(fonts.regular, w, size)
        place(ww)
        text(ctx.flow.page, w, x, ctx.flow.y + size + 6, { font: fonts.regular, size })
        x += ww
      }
    })
  }
  if (started) ctx.flow.y += lead + 2 * MM
}

function drawTrueFalse(ctx: Ctx, b: Extract<ActivityBody, { type: 'truefalse' }>): void {
  const { fonts } = ctx
  const size = BODY
  const lead = 13.5
  const num = 7 * MM
  const choices = 32 * MM
  const tx = RIGHT - choices
  b.items.forEach((item, i) => {
    const ls = wrap(fonts.regular, item.text, size, CONTENT_WIDTH - num - choices - 4 * MM)
    const correctionH = b.corrections ? 11 * MM : 0
    const h = ls.length * lead + 3 * MM + correctionH
    ctx.flow.ensure(h)
    const { page, y } = ctx.flow
    text(page, `${i + 1}.`, LEFT, y + size, { font: fonts.bold, size })
    ls.forEach((l, li) => text(page, l, LEFT + num, y + size + li * lead, { font: fonts.regular, size }))
    const trueX = tx + 2 * MM
    const falseX = tx + 18 * MM
    text(page, 'True', trueX, y + size, { font: fonts.regular, size })
    text(page, 'False', falseX, y + size, { font: fonts.regular, size })
    if (ctx.memo) {
      const word = item.answer ? 'True' : 'False'
      const x = item.answer ? trueX : falseX
      const w = widthOf(fonts.regular, word, size)
      ellipse(page, x + w / 2, y + size - 3.5, w / 2 + 4, 8, MEMO)
    }
    if (b.corrections) {
      const base = y + ls.length * lead + 8 * MM
      line(page, LEFT + num, base, RIGHT, base, 0.6, RULE)
      if (!item.answer) answerOn(ctx, item.correction, LEFT + num, base, CONTENT_WIDTH - num)
    }
    ctx.flow.y += h
  })
  ctx.flow.y += 2 * MM
}

function drawUnscramble(ctx: Ctx, b: Extract<ActivityBody, { type: 'unscramble' }>): void {
  const { fonts } = ctx
  const size = 11
  const num = 7 * MM
  const spaced = b.items.map((i) => [...i.scrambled].join(' '))
  const widest = Math.max(0, ...spaced.map((s) => widthOf(fonts.bold, s, size)))
  const lineX = Math.min(LEFT + num + widest + 8 * MM, LEFT + CONTENT_WIDTH * 0.55)
  const lineW = Math.min(60 * MM, RIGHT - lineX)
  b.items.forEach((item, i) => {
    const h = (item.hint ? 13 : 0) + 9 * MM
    ctx.flow.ensure(h)
    const { page, y } = ctx.flow
    const base = y + size + 4
    text(page, `${i + 1}.`, LEFT, base, { font: fonts.bold, size })
    const s = fitSize(fonts.bold, spaced[i], size, lineX - LEFT - num - 4 * MM)
    text(page, spaced[i], LEFT + num, base, { font: fonts.bold, size: s })
    line(page, lineX, base + 2, lineX + lineW, base + 2, 0.7, INK)
    answerOn(ctx, item.answer, lineX, base, lineW)
    if (item.hint) {
      const hs = fitSize(fonts.italic, `Hint: ${item.hint}`, 9, CONTENT_WIDTH - num)
      text(page, `Hint: ${item.hint}`, LEFT + num, base + 13, { font: fonts.italic, size: hs, color: MUTED })
    }
    ctx.flow.y += h
  })
  ctx.flow.y += 2 * MM
}

function drawVocabulary(ctx: Ctx, b: Extract<ActivityBody, { type: 'vocabulary' }>): void {
  const { fonts } = ctx
  if (b.bank) wordBank(ctx, b.bank)
  const size = BODY
  const lead = 13.5
  const num = 7 * MM
  const lineW = 45 * MM
  const mx = LEFT + num + lineW + 5 * MM
  b.items.forEach((item, i) => {
    const ls = wrap(fonts.regular, item.meaning, size, RIGHT - mx)
    const h = Math.max(ls.length * lead, 8 * MM) + 4 * MM
    ctx.flow.ensure(h)
    const { page, y } = ctx.flow
    const base = y + size + 4
    text(page, `${i + 1}.`, LEFT, base, { font: fonts.bold, size })
    line(page, LEFT + num, base + 2, LEFT + num + lineW, base + 2, 0.7, INK)
    answerOn(ctx, item.word, LEFT + num, base, lineW)
    ls.forEach((l, li) => text(page, l, mx, base + li * lead, { font: fonts.regular, size }))
    ctx.flow.y += h
  })
  ctx.flow.y += 2 * MM
}

function drawLabelling(ctx: Ctx, b: Extract<ActivityBody, { type: 'labelling' }>, id: string): void {
  const { fonts } = ctx
  if (b.bank) wordBank(ctx, b.bank)
  const image = ctx.images.get(id)
  if (b.picture && image) {
    const { w, h } = pictureSize(b)
    ctx.flow.ensure(h + 4 * MM)
    const { page } = ctx.flow
    const top = ctx.flow.y
    const x0 = LEFT + (CONTENT_WIDTH - w) / 2
    page.drawImage(image, { x: x0, y: A4_HEIGHT - top - h, width: w, height: h })
    rect(page, x0, top, w, h, { border: RULE, borderWidth: 0.6 })
    for (const l of b.labels) {
      const cx = x0 + l.x * w
      const cy = top + l.y * h
      const r = 7.5
      circle(page, cx, cy, r, { fill: WHITE, border: INK, borderWidth: 1.2 })
      text(page, String(l.number), cx, cy + 3.3, { font: fonts.bold, size: 9.5, align: 'center' })
    }
    ctx.flow.y = top + h + 5 * MM
  }
  // Numbered answer lines in two columns.
  const colW = (CONTENT_WIDTH - 8 * MM) / 2
  const rowH = 9 * MM
  const num = 7 * MM
  for (let i = 0; i < b.labels.length; i += 2) {
    ctx.flow.ensure(rowH)
    for (let k = 0; k < 2 && i + k < b.labels.length; k++) {
      const l = b.labels[i + k]
      const x = LEFT + k * (colW + 8 * MM)
      const base = ctx.flow.y + 16
      text(ctx.flow.page, `${l.number}.`, x, base, { font: fonts.bold, size: BODY })
      line(ctx.flow.page, x + num, base + 2, x + colW, base + 2, 0.7, INK)
      answerOn(ctx, l.answer, x + num, base, colW - num)
    }
    ctx.flow.y += rowH
  }
  ctx.flow.y += 2 * MM
}

function drawActivity(ctx: Ctx, a: GeneratedActivity, index: number): void {
  const { fonts } = ctx
  const headSize = 12.5
  const instructions = wrap(fonts.italic, a.instructions, 10, CONTENT_WIDTH)
  // Keep the heading with its instructions and the start of the activity.
  const opening = headSize * 1.6 + instructions.length * 13.5 + 3 * MM + openingHeight(a.body)
  ctx.flow.ensure(Math.min(opening, BOTTOM - MARGIN - 20 * MM))
  const { page } = ctx.flow
  const marks = `[${a.marks}]`
  const marksW = widthOf(fonts.bold, marks, headSize)
  const heading = `${index + 1}. ${a.heading}`
  const hs = fitSize(fonts.bold, heading, headSize, CONTENT_WIDTH - marksW - 6 * MM)
  text(page, heading, LEFT, ctx.flow.y + headSize, { font: fonts.bold, size: hs })
  text(page, marks, RIGHT, ctx.flow.y + headSize, { font: fonts.bold, size: headSize, align: 'right' })
  ctx.flow.y += headSize * 1.6
  for (const l of instructions) {
    text(ctx.flow.page, l, LEFT, ctx.flow.y + 10, { font: fonts.italic, size: 10, color: MUTED })
    ctx.flow.y += 13.5
  }
  ctx.flow.y += 3 * MM
  const b = a.body
  switch (b.type) {
    case 'wordsearch':
      return drawWordSearch(ctx, b)
    case 'crossword':
      return drawCrossword(ctx, b)
    case 'match':
      return drawMatch(ctx, b)
    case 'blanks':
      return drawBlanks(ctx, b)
    case 'truefalse':
      return drawTrueFalse(ctx, b)
    case 'unscramble':
      return drawUnscramble(ctx, b)
    case 'vocabulary':
      return drawVocabulary(ctx, b)
    case 'labelling':
      return drawLabelling(ctx, b, a.id)
  }
}

// ---------- The page header ----------

function header(page: ReturnType<PDFDocument['addPage']>, fonts: Fonts, g: GeneratedWorksheet, memo: boolean): number {
  const w = g.worksheet
  let y = MARGIN
  const boxW = 34 * MM
  const boxH = 15 * MM
  if (memo) {
    text(page, 'MEMO', LEFT, y + 9, { font: fonts.bold, size: 10, color: MEMO })
    y += 14
  }
  const title = w.title.trim() || 'Worksheet'
  const titleLines = wrap(fonts.bold, title, 18, CONTENT_WIDTH - boxW - 6 * MM)
  const titleTop = y
  titleLines.forEach((l, i) => text(page, l, LEFT, y + 16 + i * 22, { font: fonts.bold, size: 18 }))
  // Total marks box at the top right.
  rect(page, RIGHT - boxW, titleTop, boxW, boxH, { border: INK, borderWidth: 1 })
  text(page, 'Total', RIGHT - boxW + 2 * MM, titleTop + 9, { font: fonts.bold, size: 8, color: MUTED })
  text(page, `/ ${g.total}`, RIGHT - 2.5 * MM, titleTop + boxH - 3 * MM, { font: fonts.bold, size: 14, align: 'right' })
  if (memo)
    text(page, String(g.total), RIGHT - boxW + 3 * MM, titleTop + boxH - 3 * MM, {
      font: fonts.bold,
      size: 14,
      color: MEMO,
    })
  y = Math.max(y + titleLines.length * 22, titleTop + boxH) + 4 * MM

  if (w.learnerLines && !memo) {
    const size = 10.5
    const fields: [string, number][] = [
      ['Name', 0.5],
      ['Class', 0.22],
      ['Date', 0.28],
    ]
    let x = LEFT
    const base = y + 14
    for (const [label, share] of fields) {
      const width = CONTENT_WIDTH * share
      const lw = widthOf(fonts.bold, label, size) + 2 * MM
      text(page, label, x, base, { font: fonts.bold, size })
      line(page, x + lw, base + 2, x + width - 4 * MM, base + 2, 0.7, INK)
      x += width
    }
    y = base + 8 * MM
  }
  const instructions = w.instructions.trim()
  if (instructions) {
    for (const l of wrap(fonts.regular, instructions, 10.5, CONTENT_WIDTH)) {
      text(page, l, LEFT, y + 10.5, { font: fonts.regular, size: 10.5 })
      y += 14
    }
    y += 2 * MM
  }
  line(page, LEFT, y, RIGHT, y, 1, INK)
  return y + 6 * MM
}

function runningHeader(page: ReturnType<PDFDocument['addPage']>, fonts: Fonts, title: string, memo: boolean): number {
  const label = memo ? `Memo: ${title}` : title
  text(page, label, LEFT, MARGIN + 8, { font: fonts.bold, size: 9, color: memo ? MEMO : MUTED })
  line(page, LEFT, MARGIN + 13, RIGHT, MARGIN + 13, 0.5, RULE)
  return MARGIN + 13 + 6 * MM
}

// ---------- Pictures ----------

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function embedPicture(doc: PDFDocument, p: DiagramPicture): Promise<PDFImage | undefined> {
  try {
    const bytes = dataUrlBytes(p.dataUrl)
    return p.dataUrl.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    return undefined
  }
}

// ---------- The document ----------

function footers(doc: PDFDocument, fonts: Fonts, from: number, to: number, label: string, memo: boolean): void {
  const pages = doc.getPages().slice(from, to)
  pages.forEach((page, i) => {
    const y = A4_HEIGHT - 9 * MM
    text(page, label, LEFT, y, { font: fonts.regular, size: 8, color: memo ? MEMO : MUTED })
    text(page, `Page ${i + 1} of ${pages.length}`, RIGHT, y, {
      font: fonts.regular,
      size: 8,
      color: MUTED,
      align: 'right',
    })
  })
}

/** The worksheet, its memo, or both (worksheet first), as PDF bytes. */
export async function renderWorksheetPdf(g: GeneratedWorksheet, part: PrintPart = 'both'): Promise<Uint8Array> {
  const title = g.worksheet.title.trim() || 'Worksheet'
  const { doc, fonts } = await newDocument(part === 'memo' ? `${title} (memo)` : title)
  const images = new Map<string, PDFImage>()
  for (const a of g.activities) {
    if (a.body.type === 'labelling' && a.body.picture) {
      const img = await embedPicture(doc, a.body.picture)
      if (img) images.set(a.id, img)
    }
  }
  const parts: boolean[] = part === 'both' ? [false, true] : [part === 'memo']
  for (const memo of parts) {
    const from = doc.getPageCount()
    const flow = new Flow(doc, fonts, (page, first) =>
      first ? header(page, fonts, g, memo) : runningHeader(page, fonts, title, memo),
    )
    const ctx: Ctx = { flow, fonts, memo, images }
    g.activities.forEach((a, i) => {
      drawActivity(ctx, a, i)
      ctx.flow.y += 4 * MM
    })
    if (g.activities.length === 0) paragraph(ctx, 'Add an activity to start.', { font: 'italic', color: MUTED })
    footers(doc, fonts, from, doc.getPageCount(), memo ? `Memo: ${title}` : title, memo)
  }
  return doc.save()
}
