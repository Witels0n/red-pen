import { expect, test } from '@playwright/test'
import { damagedPdf, describePdf, download, expectNetworkBlocked, lockedPdf, pdfFile, trackRequests } from './pdf-fixtures'

const COMBINE = '/red-pen/combine/'

test('combines PDFs in the order the teacher sets, with nothing sent anywhere', async ({ page, baseURL }) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(COMBINE)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Combine PDFs')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')

  const files = [await pdfFile('a.pdf', [101, 102]), await pdfFile('b.pdf', [201]), await pdfFile('c.pdf', [301, 302, 303])]
  await page.locator('#file-input').setInputFiles(files)
  const items = page.locator('.file-item')
  await expect(items).toHaveCount(3)
  await expect(items.locator('.file-name')).toHaveText(['a.pdf', 'b.pdf', 'c.pdf'])
  await expect(items.locator('.file-pages')).toHaveText(['2 pages', '1 page', '3 pages'])
  await expect(page.locator('#summary')).toHaveText('3 files, 6 pages')

  // Keyboard: move c.pdf up once with Enter; focus stays on its button.
  await page.getByRole('button', { name: 'Move c.pdf up' }).focus()
  await page.keyboard.press('Enter')
  await expect(items.locator('.file-name')).toHaveText(['a.pdf', 'c.pdf', 'b.pdf'])
  await expect(page.getByRole('button', { name: 'Move c.pdf up' })).toBeFocused()

  // Drag and drop: b.pdf to the top.
  await items.nth(2).dragTo(items.nth(0), { targetPosition: { x: 20, y: 5 } })
  await expect(items.locator('.file-name')).toHaveText(['b.pdf', 'a.pdf', 'c.pdf'])

  // Add another file, then remove it again.
  await page.locator('#file-input').setInputFiles([await pdfFile('d.pdf', [401])])
  await expect(items).toHaveCount(4)
  await page.getByRole('button', { name: 'Remove d.pdf' }).click()
  await expect(items.locator('.file-name')).toHaveText(['b.pdf', 'a.pdf', 'c.pdf'])

  const out = await download(page, () => page.getByRole('button', { name: 'Combine and download' }).click())
  expect(out.name).toBe('combined.pdf')
  expect((await describePdf(out.bytes)).widths).toEqual([201, 101, 102, 301, 302, 303])

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('a locked or damaged PDF shows a clear error and the rest still combine', async ({ page }) => {
  await page.goto(COMBINE)
  await page.locator('#file-input').setInputFiles([await lockedPdf(), damagedPdf()])
  await expect(page.locator('#open-error')).toContainText('"locked.pdf" could not be opened: it is password protected.')
  await expect(page.locator('#open-error')).toContainText('"damaged.pdf" could not be opened: it appears to be damaged.')
  await expect(page.locator('#open-screen')).toBeVisible()

  await page.locator('#file-input').setInputFiles([await pdfFile('ok.pdf', [150]), await lockedPdf('also-locked.pdf')])
  await expect(page.locator('.file-item')).toHaveCount(1)
  await expect(page.locator('#work-error')).toContainText('"also-locked.pdf" could not be opened')

  const out = await download(page, () => page.locator('#combine').click())
  expect((await describePdf(out.bytes)).widths).toEqual([150])
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(COMBINE)
  await page.locator('#file-input').setInputFiles([await pdfFile('a-very-long-file-name-for-a-whole-class-scan.pdf', [101])])
  await expect(page.locator('.file-item')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
