import { expect, type Download, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { degrees, PDFDocument } from 'pdf-lib'

// Shared by the PDF Tool specs. Pages are told apart by their width, so order is easy to check.

export interface FixtureFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** A PDF whose pages have these widths (and are 500 tall), optionally with stored rotations. */
export async function pdfFile(
  name: string,
  widths: number[],
  rotations: Record<number, number> = {},
): Promise<FixtureFile> {
  const doc = await PDFDocument.create()
  widths.forEach((w, i) => {
    const page = doc.addPage([w, 500])
    page.drawRectangle({ x: 10, y: 10, width: w / 2, height: 100 })
    if (rotations[i]) page.setRotation(degrees(rotations[i]))
  })
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

/** A PDF that claims to be encrypted, as a password-protected scan does. */
export async function lockedPdf(name = 'locked.pdf'): Promise<FixtureFile> {
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2, R: 3 })
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

/** Starts with the PDF header but is not a PDF. */
export function damagedPdf(name = 'damaged.pdf'): FixtureFile {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot really a PDF\n%%EOF') }
}

/** Records every request the page makes beyond its own files. */
export function trackRequests(page: Page, baseURL: string): string[] {
  const origin = new URL(baseURL).origin
  const outside: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol.startsWith('http') && url.origin !== origin) outside.push(r.url())
  })
  return outside
}

/** Click `trigger` and return the downloaded file's name and bytes. */
export async function download(page: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const pending = page.waitForEvent('download')
  await click()
  const d: Download = await pending
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) }
}

/** The widths and stored rotations of a PDF's pages. */
export async function describePdf(bytes: Uint8Array): Promise<{ widths: number[]; rotations: number[] }> {
  const doc = await PDFDocument.load(bytes)
  return {
    widths: doc.getPages().map((p) => Math.round(p.getWidth())),
    rotations: doc.getPages().map((p) => p.getRotation().angle),
  }
}

/** The page refuses any network connection (CSP `connect-src 'none'`). */
export async function expectNetworkBlocked(page: Page): Promise<void> {
  const result = await page.evaluate(() =>
    fetch(location.href).then(
      () => 'allowed',
      () => 'blocked',
    ),
  )
  expect(result).toBe('blocked')
}
