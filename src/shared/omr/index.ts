// The sheet engine: print Answer sheets and Cover sheets, and read them back from scans and photos.
// See docs/omr.md. Pages import from here; the worker imports read.ts directly.
export * from './types'
export {
  A4_HEIGHT,
  A4_WIDTH,
  layoutCoverSheet,
  layoutSheet,
  MAX_QUESTIONS,
  MM,
  pageCount,
  questionRect,
  QUESTIONS_PER_PAGE,
} from './layout'
export {
  assessmentCodeFrom,
  decodeSheetQr,
  encodeSheetQr,
  isAssessmentCode,
  isLearnerId,
  type SheetQr,
} from './qr-payload'
export { renderAnswerSheetsPdf, renderCoverSheetsPdf } from './print'
export { REVIEW_THRESHOLD } from './classify'
export { identifySheet, readSheet, type IdentifyResult, type ReadOptions } from './read'
export { NOT_FOUND } from './locate'
export { rectifyRegion } from './rectify'
export type { RgbaImage } from './image'
export { createOmrReader, type OmrReader } from './client'
export {
  isReadableUpload,
  pageToImageData,
  pdfPagesToImageData,
  photoToImageData,
  PhotoDecodeError,
  SCAN_DPI,
} from './page-image'
