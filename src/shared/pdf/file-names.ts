/** "Grade 8 tests.PDF" -> "Grade 8 tests". */
export function stripPdfExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '') || 'document'
}

/** "class.pdf" + "organised" -> "class-organised.pdf". */
export function withSuffix(fileName: string, suffix: string, extension = 'pdf'): string {
  return `${stripPdfExtension(fileName)}-${suffix}.${extension}`
}
