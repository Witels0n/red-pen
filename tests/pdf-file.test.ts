import { describe, expect, it } from 'vitest'
import { looksLikePdf } from '../src/mark/pdf-file'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('looksLikePdf', () => {
  it('accepts bytes starting with the PDF header', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\n...'))).toBe(true)
  })

  it('accepts a header preceded by a little junk, as many scanners emit', () => {
    expect(looksLikePdf(bytes('\n\n  %PDF-1.4\n'))).toBe(true)
  })

  it('rejects other content', () => {
    expect(looksLikePdf(bytes('hello world'))).toBe(false)
    expect(looksLikePdf(new Uint8Array(0))).toBe(false)
  })

  it('rejects a header buried far into the file', () => {
    expect(looksLikePdf(bytes('x'.repeat(5000) + '%PDF-1.4'))).toBe(false)
  })
})
