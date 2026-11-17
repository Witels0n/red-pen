// Reads one page: locate the sheet, pick its layout, sample every bubble, classify, and report.
import {
  classifyQuestion,
  deriveThresholds,
  needsReview,
  quantile,
  REVIEW_THRESHOLD,
  type QuestionRead,
} from './classify'
import { applyHomography, localScale, type Homography } from './homography'
import { darknessAt, type RgbaImage } from './image'
import { layoutSheet, MM, pageCount, QR_RECT, QUESTIONS_PER_PAGE } from './layout'
import { locateSheet, type LocatedSheet } from './locate'
import type { SheetQr } from './qr-payload'
import type { Bubble, QuestionGeometry, SheetGeometry, SheetRead, SheetSpec } from './types'

export interface ReadOptions {
  /**
   * The sheets that may be in the pile: one SheetSpec per Version, as printed (learner fields are
   * ignored). The QR picks the right one; without a readable QR the first is used.
   */
  templates: SheetSpec[]
  /** QR texts decoded elsewhere, for example by BarcodeDetector. Used only if jsQR finds nothing. */
  qrHints?: string[]
  /** Include scores and positions in the result. */
  debug?: boolean
}

/** Golden-angle spiral: evenly spread sample points in a unit disc. */
function discPattern(n: number): { x: number; y: number }[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / n)
    return { x: r * Math.cos(i * golden), y: r * Math.sin(i * golden) }
  })
}

/** Fraction of the bubble radius sampled: inside the printed outline, even when slightly misaligned. */
const INNER = 0.58
/** A group whose outlines fit less than this share of the sheet's best group goes to Review. */
const MIN_RELATIVE_FIT = 0.5
/** Below this the outlines are not visible at all (extreme blur): the whole sheet goes to Review. */
const MIN_FIT = 0.05
const RING_POINTS = Array.from({ length: 20 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 10),
  y: Math.sin((i * Math.PI) / 10),
}))

interface Sampler {
  sheet: LocatedSheet
  disc: { x: number; y: number }[]
}

function makeSampler(sheet: LocatedSheet, geometry: SheetGeometry): Sampler {
  const b = geometry.questions[0]?.bubbles[0] ?? geometry.idColumns[0]?.bubbles[0]
  const px = b ? localScale(sheet.h, b.cx, b.cy) * b.r * INNER : 4
  const n = Math.max(24, Math.min(160, Math.round(Math.PI * px * px)))
  return { sheet, disc: discPattern(n) }
}

function rawFill(s: Sampler, b: Bubble, dx: number, dy: number): number {
  const { gray, paper, h } = s.sheet
  const r = b.r * INNER
  let sum = 0
  for (const p of s.disc) {
    const q = applyHomography(h, b.cx + dx + p.x * r, b.cy + dy + p.y * r)
    sum += darknessAt(gray, paper, q.x, q.y)
  }
  return sum / s.disc.length
}

/** How well the printed outlines line up at an offset: darkness on the outline minus just outside it. */
function ringContrast(s: Sampler, bubbles: Bubble[], dx: number, dy: number): number {
  const { gray, paper, h } = s.sheet
  let on = 0
  let off = 0
  for (const b of bubbles) {
    const outer = b.r + 2.2
    for (const p of RING_POINTS) {
      const a = applyHomography(h, b.cx + dx + p.x * b.r, b.cy + dy + p.y * b.r)
      on += darknessAt(gray, paper, a.x, a.y)
      const c = applyHomography(h, b.cx + dx + p.x * outer, b.cy + dy + p.y * outer)
      off += darknessAt(gray, paper, c.x, c.y)
    }
  }
  return (on - off) / (bubbles.length * RING_POINTS.length)
}

interface Offset {
  dx: number
  dy: number
  /** Outline contrast at this offset, relative to the sheet's ink: how well the layout fits here. */
  fit: number
}

/**
 * The shift (within `reach` of `around`) that best lines up the printed outlines of `bubbles`.
 * Absorbs paper curl and lens distortion that four corner points cannot describe.
 */
function align(
  s: Sampler,
  bubbles: Bubble[],
  around: { dx: number; dy: number },
  reach: number,
  steps: number,
): Offset {
  const step = reach / steps
  const base = ringContrast(s, bubbles, around.dx, around.dy)
  let best = { dx: around.dx, dy: around.dy, score: base, raw: base }
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      if (!ix && !iy) continue
      const dx = around.dx + ix * step
      const dy = around.dy + iy * step
      const raw = ringContrast(s, bubbles, dx, dy)
      // A small preference for no shift, so flat, well-lit sheets are left alone.
      const score = raw - 0.02 * s.sheet.ink * (Math.hypot(ix, iy) / steps)
      if (score > best.score) best = { dx, dy, score, raw }
    }
  }
  return { dx: best.dx, dy: best.dy, fit: best.raw / s.sheet.ink }
}

/** Raw fills of every bubble in `groups`: each group aligned within 1.5 mm of `around`. */
function sampleGroups(
  s: Sampler,
  groups: Bubble[][],
  around = { dx: 0, dy: 0 },
): { raw: number[][]; offsets: Offset[] } {
  const offsets = groups.map((bubbles) => align(s, bubbles, around, 1.5 * MM, 5))
  const raw = groups.map((bubbles, i) => bubbles.map((b) => rawFill(s, b, offsets[i].dx, offsets[i].dy)))
  return { raw, offsets }
}

/** Questions in printed columns, then in runs of five rows (the printed groups). */
function columns(questions: QuestionGeometry[]): QuestionGeometry[][] {
  const out: QuestionGeometry[][] = []
  for (const q of questions) {
    const col = out[out.length - 1]
    if (col && Math.abs(col[0].numberX - q.numberX) < 1) col.push(q)
    else out.push([q])
  }
  return out
}

function groupsOfFive<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 5) out.push(items.slice(i, i + 5))
  return out
}

/** Raw fills per question, plus the layout fit of the group each question was aligned with. */
function readAnswers(s: Sampler, g: SheetGeometry): { raw: number[][]; fit: number[]; offsets: Offset[] } {
  const raw: number[][] = []
  const fit: number[] = []
  const offsets: Offset[] = []
  for (const column of columns(g.questions)) {
    // A coarse shift for the whole column first (up to 3 mm, under half the bubble pitch), then per group.
    const coarse = align(
      s,
      column.flatMap((q) => q.bubbles),
      { dx: 0, dy: 0 },
      3 * MM,
      6,
    )
    // Distortion changes smoothly down a column, so each group starts from the one above it.
    let around: { dx: number; dy: number } = coarse
    for (const grp of groupsOfFive(column)) {
      const bubbles = grp.flatMap((q) => q.bubbles)
      let o = align(s, bubbles, around, 1.5 * MM, 5)
      if (around !== coarse) {
        const fromColumn = align(s, bubbles, coarse, 1.5 * MM, 5)
        if (fromColumn.fit > o.fit) o = fromColumn
      }
      around = o
      offsets.push(o)
      let k = 0
      for (const q of grp) {
        raw.push(bubbles.slice(k, k + q.bubbles.length).map((b) => rawFill(s, b, o.dx, o.dy)))
        fit.push(o.fit)
        k += q.bubbles.length
      }
    }
  }
  return { raw, fit, offsets }
}

/** Subtracts the empty-bubble level (per option letter, since letters differ in ink) and scales by the ink. */
function normalise(raw: number[][], ink: number): number[][] {
  const all = raw.flat()
  if (all.length === 0) return raw
  const overall = quantile(all, 0.25)
  const maxOptions = Math.max(...raw.map((r) => r.length))
  const base = Array.from({ length: maxOptions }, (_, o) => {
    const col = raw.filter((r) => r.length > o).map((r) => r[o])
    return col.length >= 4 ? Math.min(quantile(col, 0.25), overall + 0.04) : overall
  })
  return raw.map((r) => r.map((v, o) => Math.max(0, v - base[o]) / ink))
}

/** Mean outline alignment over every bubble: tells pages apart when the QR is unreadable. */
function layoutFit(s: Sampler, g: SheetGeometry): number {
  const bubbles = [...g.questions.flatMap((q) => q.bubbles), ...g.idColumns.flatMap((c) => c.bubbles)]
  return bubbles.length ? ringContrast(s, bubbles, 0, 0) : 0
}

function emptyRead(problem: string): SheetRead {
  return {
    ok: false,
    identity: { source: 'qr' },
    page: 1,
    pages: 1,
    questionStart: 0,
    answers: [],
    confidences: [],
    flags: [],
    idConfidence: 0,
    needsReview: true,
    problems: [problem],
  }
}

function listNumbers(ns: number[]): string {
  return ns.length <= 12 ? ns.join(', ') : `${ns.slice(0, 12).join(', ')} and ${ns.length - 12} more`
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Reads one page image (a scan rendered at about 200 dpi, or a photo). Synchronous; run it in a worker. */
export function readSheet(image: RgbaImage, opts: ReadOptions): SheetRead {
  const started = now()
  if (opts.templates.length === 0) throw new Error('readSheet needs at least one template.')
  const first = layoutSheet(opts.templates[0])[0]
  const located = locateSheet(image, { qrRect: first.qr, qrHints: opts.qrHints })
  if (!located.ok) return emptyRead(located.problem)
  const sheet = located.sheet
  const problems: string[] = []

  if (sheet.qr?.kind === 'cover') {
    return {
      ...emptyRead('This is a Cover sheet, not an Answer sheet.'),
      ok: false,
      kind: 'cover',
      identity: { learnerId: sheet.qr.learnerId, source: 'qr' },
      idConfidence: 1,
      homography: scaleHomography(sheet.h, sheet.scale),
    }
  }

  const qr = sheet.qr
  let template = opts.templates[0]
  let versionKnown = opts.templates.length === 1
  if (qr) {
    const match = opts.templates.find((t) => t.version === qr.version)
    if (qr.assessmentCode !== template.assessmentCode) {
      return {
        ...emptyRead(`This sheet belongs to a different assessment (code ${qr.assessmentCode}).`),
        kind: 'answer-sheet',
        assessmentCode: qr.assessmentCode,
        version: qr.version,
      }
    }
    if (!match) {
      return {
        ...emptyRead(`This sheet is Version ${qr.version}, which this assessment does not have.`),
        kind: 'answer-sheet',
        assessmentCode: qr.assessmentCode,
        version: qr.version,
      }
    }
    template = match
    versionKnown = true
  } else {
    problems.push('The code on the sheet could not be read.')
  }

  const pages = pageCount(template.questions.length)
  const geometries = layoutSheet({ ...template, page: undefined })
  let geometry: SheetGeometry
  let pageKnown = true
  if (qr) {
    if (qr.pages !== pages || qr.page > pages) {
      return {
        ...emptyRead(`The code says page ${qr.page} of ${qr.pages}, but this assessment has ${pages}.`),
        kind: 'answer-sheet',
      }
    }
    geometry = geometries[qr.page - 1]
  } else if (geometries.length === 1) {
    geometry = geometries[0]
  } else {
    const probe = makeSampler(sheet, geometries[0])
    const fits = geometries.map((g) => layoutFit(probe, g))
    geometry = geometries[fits.indexOf(Math.max(...fits))]
    pageKnown = false
    problems.push(`The page number is a guess (page ${geometry.page}).`)
  }
  if (!versionKnown) problems.push('The Version is unknown, so this sheet cannot be marked until it is checked.')
  if (sheet.orientationUnsure) problems.push('It was not clear which way up the sheet is.')

  const sampler = makeSampler(sheet, geometry)
  const { raw, fit, offsets } = readAnswers(sampler, geometry)
  const scores = normalise(raw, sheet.ink)
  const thresholds = deriveThresholds(scores.map((r) => Math.max(...r)))
  const reads: QuestionRead[] = scores.map((s) => classifyQuestion(s, thresholds))
  // Where the printed outlines do not line up as well as elsewhere on the sheet (a bent page or a
  // strong lens), the bubbles may have been sampled in the wrong place: never trust those reads.
  const bestFit = Math.max(...fit)
  const misaligned: number[] = []
  reads.forEach((r, i) => {
    if (fit[i] < MIN_RELATIVE_FIT * bestFit || bestFit < MIN_FIT) {
      r.confidence = Math.min(r.confidence, 0.4)
      r.flags = [...r.flags, 'misaligned']
      misaligned.push(geometry.questions[i].index + 1)
    }
  })
  if (misaligned.length) {
    problems.push(
      `Part of the sheet did not line up (is the page bent or creased?): question ${listNumbers(misaligned)}.`,
    )
  }

  // Identity: the QR when it names a learner, otherwise the Bubbled ID grid.
  let learnerId: string | undefined
  let idSource: 'qr' | 'bubbles' = 'qr'
  let idConfidence = 0
  let idScores: number[][] = []
  if (qr?.learnerId) {
    learnerId = qr.learnerId
    idConfidence = 1
  } else if (geometry.idColumns.length > 0) {
    idSource = 'bubbles'
    const idRaw = sampleGroups(
      sampler,
      geometry.idColumns.map((c) => c.bubbles),
    ).raw
    const idBase = quantile(idRaw.flat(), 0.5)
    idScores = idRaw.map((col) => col.map((v) => Math.max(0, v - idBase) / sheet.ink))
    const idReads = idScores.map((col) => classifyQuestion(col, thresholds))
    idConfidence = Math.min(...idReads.map((r) => (typeof r.answer === 'number' ? r.confidence : 0)))
    if (idReads.every((r) => typeof r.answer === 'number')) {
      learnerId = idReads.map((r) => String(r.answer)).join('')
    }
    if (idConfidence < REVIEW_THRESHOLD || idReads.some((r) => r.flags.length > 0)) {
      problems.push(
        learnerId ? `Check the Learner ID: it reads as ${learnerId}.` : 'The Learner ID circles could not be read.',
      )
    }
  } else {
    problems.push('The learner is unknown: the code could not be read and the sheet has no Learner ID circles.')
  }

  const questionStart = (geometry.page - 1) * QUESTIONS_PER_PAGE
  const review = reads.map((r, i) => (needsReview(r) ? questionStart + i + 1 : 0)).filter((n) => n > 0)
  const multiple = reads.map((r, i) => (r.answer === 'multiple' ? questionStart + i + 1 : 0)).filter((n) => n > 0)
  if (multiple.length) problems.push(`More than one circle filled: question ${listNumbers(multiple)}.`)
  const unsure = review.filter((n) => !multiple.includes(n) && !misaligned.includes(n))
  if (unsure.length) problems.push(`Light, erased or unclear marks: question ${listNumbers(unsure)}.`)

  const result: SheetRead = {
    ok: true,
    kind: 'answer-sheet',
    identity: { ...(learnerId ? { learnerId } : {}), source: idSource },
    ...(qr ? { assessmentCode: qr.assessmentCode } : {}),
    ...(versionKnown ? { version: template.version } : {}),
    page: geometry.page,
    pages,
    questionStart,
    answers: reads.map((r) => r.answer),
    confidences: reads.map((r) => Math.round(r.confidence * 1000) / 1000),
    flags: reads.map((r) => r.flags),
    idConfidence: Math.round(idConfidence * 1000) / 1000,
    needsReview:
      review.length > 0 || idConfidence < REVIEW_THRESHOLD || !versionKnown || !pageKnown || sheet.orientationUnsure,
    problems,
    homography: scaleHomography(sheet.h, sheet.scale),
  }
  if (opts.debug) {
    result.debug = {
      fiducials: sheet.corners.map((p) => ({ x: p.x * sheet.scale, y: p.y * sheet.scale })),
      rotation: sheet.rotation,
      qrText: sheet.qrText,
      qrSource: sheet.qrSource,
      inkLevel: sheet.ink,
      thresholds,
      scores,
      idScores,
      alignment: offsets,
      fit,
      millis: Math.round(now() - started),
    }
  }
  return result
}

export type IdentifyResult = { ok: true; qr: SheetQr | null; homography: number[] } | { ok: false; problem: string }

/**
 * Finds the corner squares and decodes the QR only: enough to tell a Cover sheet from an Answer
 * sheet and whose it is, without knowing the assessment (used to split batch scans).
 */
export function identifySheet(image: RgbaImage, qrHints?: string[]): IdentifyResult {
  const located = locateSheet(image, { qrRect: QR_RECT, qrHints })
  if (!located.ok) return located
  return { ok: true, qr: located.sheet.qr, homography: scaleHomography(located.sheet.h, located.sheet.scale) }
}

/** Layout points to pixels of the original (not downscaled) input image. */
function scaleHomography(h: Homography, scale: number): number[] {
  if (scale === 1) return [...h]
  return [h[0] * scale, h[1] * scale, h[2] * scale, h[3] * scale, h[4] * scale, h[5] * scale, h[6], h[7], h[8]]
}
