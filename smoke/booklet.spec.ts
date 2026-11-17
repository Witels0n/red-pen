import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { describePdf, download, expectNetworkBlocked, lockedPdf, trackRequests, type FixtureFile } from './pdf-fixtures'

const BOOKLET = '/red-pen/booklet/'

/** An A4 PDF with `count` pages, each numbered. */
async function a4Pdf(name: string, count: number): Promise<FixtureFile> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([595.28, 841.89])
    page.drawText(`Page ${i + 1}`, { x: 60, y: 760, size: 48 })
    page.drawRectangle({ x: 60, y: 60, width: 475, height: 600, borderWidth: 4 })
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

test('makes a booklet, n-up sheets and copies, with nothing sent anywhere', async ({ page, baseURL }) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(BOOKLET)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Booklet printing')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')

  await page.locator('#file-input').setInputFiles([await a4Pdf('worksheet.pdf', 6)])
  await expect(page.locator('#summary')).toHaveText('worksheet.pdf, 6 pages')
  await expect(page.locator('#sheet-count')).toHaveText(
    '6 pages on 2 sheets (printed on both sides), with 2 blank pages added at the end.',
  )
  await expect(page.locator('.sheet-label')).toHaveText([
    'Sheet 1, front',
    'Sheet 1, back',
    'Sheet 2, front',
    'Sheet 2, back',
  ])
  await expect(page.locator('.sheet canvas[data-rendered="true"]')).toHaveCount(4)
  await page.locator('#order summary').click()
  await expect(page.locator('#order-list li')).toHaveText([
    'Sheet 1: front blank | 1, back 2 | blank',
    'Sheet 2: front 6 | 3, back 4 | 5',
  ])

  const booklet = await download(page, () => page.locator('#download').click())
  expect(booklet.name).toBe('worksheet-booklet.pdf')
  expect((await describePdf(booklet.bytes)).widths).toEqual([842, 842, 842, 842])

  // The last page can stay the back cover.
  await page.locator('#back-cover').check()
  await expect(page.locator('#order-list li').first()).toHaveText('Sheet 1: front 6 | 1, back 2 | blank')

  // Four pages per sheet: 6 pages on 2 portrait sheets.
  await page.getByLabel('Several pages per sheet').check()
  await expect(page.locator('#order')).toBeHidden()
  await expect(page.locator('#sheet-count')).toHaveText('6 pages on 2 sheets.')
  await expect(page.locator('.sheet canvas[data-rendered="true"]')).toHaveCount(2)
  await page.locator('#nup').selectOption('6')
  await page.locator('#borders').check()
  await expect(page.locator('#sheet-count')).toHaveText('6 pages on 1 sheet.')
  await expect(page.locator('.sheet canvas[data-rendered="true"]')).toHaveCount(1)
  await page.locator('#nup').selectOption('4')
  await expect(page.locator('#sheet-count')).toHaveText('6 pages on 2 sheets.')
  const nup = await download(page, () => page.locator('#download').click())
  expect(nup.name).toBe('worksheet-4-up.pdf')
  expect((await describePdf(nup.bytes)).widths).toEqual([595, 595])

  // Copies: one sheet per page, two copies each.
  await page.getByLabel('Copies of each page').check()
  await page.locator('#repeat').selectOption('2')
  await expect(page.locator('#sheet-count')).toHaveText('6 pages on 6 sheets.')
  await expect(page.locator('.sheet canvas[data-rendered="true"]')).toHaveCount(4)
  const copies = await download(page, () => page.locator('#download').click())
  expect(copies.name).toBe('worksheet-2-copies.pdf')
  expect((await describePdf(copies.bytes)).widths).toEqual([842, 842, 842, 842, 842, 842])

  // Settings are remembered on this device.
  await page.reload()
  await expect(page.getByLabel('Copies of each page')).toBeChecked()

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('a locked PDF shows a clear error', async ({ page }) => {
  await page.goto(BOOKLET)
  await page.locator('#file-input').setInputFiles([await lockedPdf()])
  await expect(page.locator('#open-error')).toContainText('it is password protected')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(BOOKLET)
  await page.locator('#file-input').setInputFiles([await a4Pdf('a-very-long-file-name-for-the-grade-9-booklet.pdf', 9)])
  await expect(page.locator('.sheet')).toHaveCount(4)
  await page.locator('.sheet').first().scrollIntoViewIfNeeded()
  await expect(page.locator('.sheet canvas[data-rendered="true"]').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
