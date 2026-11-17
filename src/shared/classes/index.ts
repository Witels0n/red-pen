/**
 * Class lists: named lists of learners, each with a Learner ID and optionally a name.
 * Stored only in this browser (IndexedDB). Used by the Class lists Tool and by the Tools that
 * print or read sheets per learner. `importSpreadsheet` loads its Excel reader on first use.
 */
export * from './types'
export { buildLearners, numberedLearners, rowsFromNames, tidyName } from './build-learners'
export type { BuildLearnersOptions, BuildLearnersResult, BuiltRow } from './build-learners'
export {
  addLearner,
  changeIdDigits,
  classListProblems,
  duplicateClassList,
  moveLearner,
  namedCount,
  newClassList,
  nextLearnerId,
  removeLearner,
  renameLearner,
  sortByName,
} from './class-list'
export type { ChangeDigitsResult } from './class-list'
export { detectDelimiter, parseCsv, writeCsv } from './csv'
export { columnLetter, guessColumns } from './guess-columns'
export type { ColumnGuess } from './guess-columns'
export type { CsvDelimiter, ParseCsvOptions } from './csv'
export { CLASS_CSV_HEADER, classFileName, classFromCsv, classToCsv } from './class-csv'
export type { ClassCsvResult } from './class-csv'
export {
  SPREADSHEET_ACCEPT,
  SpreadsheetError,
  cellText,
  importSpreadsheet,
  normaliseRows,
  readTextFile,
} from './spreadsheet'
export type { ImportedSheet, ImportedSpreadsheet, SpreadsheetFile } from './spreadsheet'
export {
  ClassStorageError,
  deleteClass,
  getClass,
  indexedDbStorage,
  listClasses,
  memoryStorage,
  saveClass,
  setClassStorage,
} from './storage'
export type { ClassStorage } from './storage'
