import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, rgb } from 'pdf-lib'

async function fixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

async function openTest(page: Page): Promise<void> {
  await page.goto('./')
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() })
  await expect(page.locator('.page')).toHaveCount(1)
}

const swatch = (page: Page, name: string) => page.locator(`#ink-swatches [data-ink="${name}"]`)
const strokeOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((e) => getComputedStyle(e).stroke)

test('Ink colour is red by default, recolours every annotation, is used in the export, and is remembered', async ({
  page,
}) => {
  await openTest(page)
  await expect(swatch(page, 'red')).toHaveAttribute('aria-checked', 'true')

  const first = page.locator('.page').first()
  await first.click({ position: { x: 100, y: 120 } })
  await first.click({ position: { x: 200, y: 120 }, button: 'right' })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
  expect(await strokeOf(page, '.annotation-tick polyline')).toBe('rgb(217, 26, 26)')

  // Changing the colour recolours the annotations already placed.
  await swatch(page, 'blue').click()
  await expect(swatch(page, 'blue')).toHaveAttribute('aria-checked', 'true')
  await expect(swatch(page, 'red')).toHaveAttribute('aria-checked', 'false')
  expect(await strokeOf(page, '.annotation-tick polyline')).toBe('rgb(26, 64, 217)')
  expect(await strokeOf(page, '.annotation-cross line')).toBe('rgb(26, 64, 217)')

  // The export uses the chosen colour.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()])
  const marked = await PDFDocument.load(await readFile((await download.path())!))
  const contents = marked.getPage(0).node.Contents()!
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
  const content = refs
    .map((ref) =>
      new TextDecoder('latin1').decode(decodePDFRawStream(marked.context.lookup(ref, PDFRawStream)).decode()),
    )
    .join('\n')
  expect(content).toMatch(/0\.1 0\.25 0\.85 RG/)
  expect(content).not.toMatch(/0\.85 0\.1 0\.1 RG/)

  // The choice is remembered for the next Test.
  await page.reload()
  await expect(swatch(page, 'blue')).toHaveAttribute('aria-checked', 'true')
})
