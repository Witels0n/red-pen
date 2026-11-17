// Copied from src/mark/pdf-file.ts.
// Cheap, DOM-free sniff to reject obvious non-PDFs before handing bytes to pdf.js.
// Per the PDF spec the header may be preceded by junk within the first 1024 bytes.
const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const SEARCH_WINDOW = 1024

export function looksLikePdf(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SEARCH_WINDOW) - HEADER.length
  for (let i = 0; i <= end; i++) {
    if (HEADER.every((b, j) => bytes[i + j] === b)) return true
  }
  return false
}
