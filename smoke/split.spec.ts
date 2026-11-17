import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import {
  damagedPdf,
  describePdf,
  download,
  expectNetworkBlocked,
  lockedPdf,
  pdfFile,
  trackRequests,
} from './pdf-fixtures'

const SPLIT = '/red-pen/split/'
const WIDTHS = [101, 102, 103, 104, 105, 106, 107]

async function openClass(page: import('@playwright/test').Page) {
  await page.goto(SPLIT)
  await page.locator('#file-input').setInputFiles([await pdfFile('Class 8B.pdf', WIDTHS)])
  await expect(page.locator('#summary')).toHaveText('Class 8B.pdf, 7 pages')
}

async function unzip(bytes: Buffer): Promise<Record<string, number[]>> {
  const files = unzipSync(new Uint8Array(bytes))
  const out: Record<string, number[]> = {}
  for (const [name, data] of Object.entries(files)) out[name] = (await describePdf(data)).widths
  return out
}

test('splits every N pages (one file per learner) into a zip, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(SPLIT)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Split a PDF')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await openClass(page)

  await page.getByLabel('Pages per file').fill('3')
  await expect(page.locator('#preview li .part-name')).toHaveText([
    'Class 8B-part-01.pdf',
    'Class 8B-part-02.pdf',
    'Class 8B-part-03.pdf',
  ])
  await expect(page.locator('#preview li .part-range')).toHaveText(['Pages 1-3', 'Pages 4-6', 'Page 7'])

  const out = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(out.name).toBe('Class 8B-split.zip')
  expect(await unzip(out.bytes)).toEqual({
    'Class 8B-part-01.pdf': [101, 102, 103],
    'Class 8B-part-02.pdf': [104, 105, 106],
    'Class 8B-part-03.pdf': [107],
  })

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('one file per page', async ({ page }) => {
  await openClass(page)
  await page.getByLabel('One file per page').check()
  await expect(page.locator('#preview li')).toHaveCount(7)
  const out = await download(page, () => page.locator('#download').click())
  const files = await unzip(out.bytes)
  expect(Object.keys(files)).toHaveLength(7)
  expect(files['Class 8B-part-05.pdf']).toEqual([105])
})

test('custom ranges are checked before anything downloads', async ({ page }) => {
  await openClass(page)
  const ranges = page.getByLabel('Page ranges')
  const error = page.locator('#plan-error')
  const downloadButton = page.locator('#download')

  await ranges.fill('1-3, 9')
  await expect(error).toHaveText('"9" goes past the end: this PDF has 7 pages.')
  await expect(downloadButton).toBeDisabled()
  await expect(page.locator('#preview li')).toHaveCount(0)

  await ranges.fill('')
  await expect(error).toContainText('Enter at least one page or range')

  await ranges.fill('1-3, four')
  await expect(error).toContainText('"four" is not a page or a range')

  await ranges.fill('6-4')
  await expect(error).toHaveText('"6-4" runs backwards. Write it as 4-6.')

  await ranges.fill('1-3, 4-6, 7')
  await expect(error).toBeHidden()
  await expect(page.locator('#preview li .part-range')).toHaveText(['Pages 1-3', 'Pages 4-6', 'Page 7'])
  const out = await download(page, () => downloadButton.click())
  expect(await unzip(out.bytes)).toEqual({
    'Class 8B-part-01.pdf': [101, 102, 103],
    'Class 8B-part-02.pdf': [104, 105, 106],
    'Class 8B-part-03.pdf': [107],
  })
})

test('a locked or damaged PDF shows a clear error and the open PDF stays usable', async ({ page }) => {
  await page.goto(SPLIT)
  await page.locator('#file-input').setInputFiles([await lockedPdf()])
  await expect(page.locator('#open-error')).toHaveText('"locked.pdf" could not be opened: it is password protected.')

  await page.locator('#file-input').setInputFiles([await pdfFile('Class 8B.pdf', WIDTHS)])
  await page.locator('#file-input').setInputFiles([damagedPdf()])
  await expect(page.locator('#work-error')).toHaveText('"damaged.pdf" could not be opened: it appears to be damaged.')
  await expect(page.locator('#summary')).toHaveText('Class 8B.pdf, 7 pages')
  await expect(page.locator('#download')).toBeEnabled()
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await openClass(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
