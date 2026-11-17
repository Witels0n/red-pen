import { expect, test, type Page } from '@playwright/test'
import {
  damagedPdf,
  describePdf,
  download,
  expectNetworkBlocked,
  lockedPdf,
  pdfFile,
  trackRequests,
} from './pdf-fixtures'

const ORGANISE = '/red-pen/organise/'

/** Four pages, 101 to 104 wide; page 3 is already stored rotated by 90 degrees. */
async function openScan(page: Page) {
  await page.goto(ORGANISE)
  await page.locator('#file-input').setInputFiles([await pdfFile('scan.pdf', [101, 102, 103, 104], { 2: 90 })])
  await expect(page.locator('.page-card')).toHaveCount(4)
}

const captions = (page: Page) => page.locator('.page-card .page-label')

test('rotates, deletes and reorders pages, storing rotation in the PDF, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(ORGANISE)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Organise pages')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await openScan(page)
  await expect(page.locator('.page-card canvas[data-rendered="true"]')).toHaveCount(4)

  await page.getByRole('button', { name: 'Rotate page 1 right' }).click()
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click()
  await page.getByRole('button', { name: 'Rotate all left' }).click()
  await page.getByRole('button', { name: 'Delete page 2' }).click()
  await expect(captions(page)).toHaveText(['Page 1', 'Page 3', 'Page 4'])

  // Keyboard: move page 4 earlier; focus follows the page.
  await page.getByRole('button', { name: 'Move page 4 earlier' }).focus()
  await page.keyboard.press('Enter')
  await expect(captions(page)).toHaveText(['Page 1', 'Page 4', 'Page 3'])
  await expect(page.getByRole('button', { name: 'Move page 4 earlier' })).toBeFocused()

  // Drag and drop: page 3 to the front.
  const cards = page.locator('.page-card')
  await cards.nth(2).dragTo(cards.nth(0), { targetPosition: { x: 5, y: 40 } })
  await expect(captions(page)).toHaveText(['Page 3', 'Page 1', 'Page 4'])
  await expect(cards.first()).toHaveAttribute('data-turn', '270')

  const out = await download(page, () => page.getByRole('button', { name: 'Save PDF' }).click())
  expect(out.name).toBe('scan-organised.pdf')
  const saved = await describePdf(out.bytes)
  expect(saved.widths).toEqual([103, 101, 104])
  // Page 3: stored 90 plus a left turn = 0. Page 1: right, right, left = 90. Page 4: left = 270.
  expect(saved.rotations).toEqual([0, 90, 270])

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('a turn adds to the rotation already stored in the PDF', async ({ page }) => {
  await openScan(page)
  await page.getByRole('button', { name: 'Rotate page 3 right' }).click()
  await page.getByRole('button', { name: 'Rotate page 1 left' }).click()
  await page.getByRole('button', { name: 'Rotate page 2 right' }).click()
  await page.getByRole('button', { name: 'Rotate page 2 right' }).click()
  const out = await download(page, () => page.locator('#save').click())
  expect(await describePdf(out.bytes)).toEqual({ widths: [101, 102, 103, 104], rotations: [270, 180, 180, 0] })
})

test('Start over brings back every page', async ({ page }) => {
  await openScan(page)
  await page.getByRole('button', { name: 'Delete page 1' }).click()
  await page.getByRole('button', { name: 'Rotate all right' }).click()
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(captions(page)).toHaveText(['Page 1', 'Page 2', 'Page 3', 'Page 4'])
  await expect(page.locator('.page-card[data-turn="0"]')).toHaveCount(4)
})

test('a locked or damaged PDF shows a clear error and the open PDF stays usable', async ({ page }) => {
  await page.goto(ORGANISE)
  await page.locator('#file-input').setInputFiles([damagedPdf()])
  await expect(page.locator('#open-error')).toHaveText('"damaged.pdf" could not be opened: it appears to be damaged.')

  await openScan(page)
  await page.locator('#file-input').setInputFiles([await lockedPdf()])
  await expect(page.locator('#work-error')).toHaveText('"locked.pdf" could not be opened: it is password protected.')
  await expect(page.locator('.page-card')).toHaveCount(4)
  const out = await download(page, () => page.locator('#save').click())
  expect((await describePdf(out.bytes)).widths).toEqual([101, 102, 103, 104])
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await openScan(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
