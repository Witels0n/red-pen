import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describePdf, download, expectNetworkBlocked, pdfFile, trackRequests } from './pdf-fixtures'

const STAMP = '/red-pen/stamp/'

/** The text on each page of a PDF, as pdf.js reads it. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    out.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '))
  }
  return out
}

async function previewDrawn(page: Page): Promise<void> {
  await expect(page.locator('#preview[data-rendered]')).toBeAttached()
}

test('stamps a watermark, page numbers and a header on several PDFs, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(STAMP)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Stamp and number')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')

  await page
    .locator('#file-input')
    .setInputFiles([await pdfFile('Test A.pdf', [400, 410, 420]), await pdfFile('Test B.pdf', [500, 510], { 1: 90 })])
  await expect(page.locator('#summary')).toHaveText('2 PDFs, 5 pages in all')
  await expect(page.locator('#file-list li')).toHaveCount(2)

  await page.locator('#wm-preset').selectOption('DRAFT')
  await page.locator('#header-text').fill('Sunnyside High School')
  await page.locator('#footer-text').fill('Grade 10 Term 2 Test')
  await page.locator('#num-format').selectOption('page-n-of')
  await previewDrawn(page)
  await expect(page.locator('#preview-page')).toHaveText('Page 1 of 3')
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.locator('#preview-page')).toHaveText('Page 2 of 3')

  const out = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(out.name).toBe('stamped-pdfs.zip')
  const files = unzipSync(new Uint8Array(out.bytes))
  expect(Object.keys(files).sort()).toEqual(['Test A-stamped.pdf', 'Test B-stamped.pdf'])

  const a = await pageTexts(files['Test A-stamped.pdf'])
  expect(a).toHaveLength(3)
  for (const [i, text] of a.entries()) {
    expect(text).toContain('DRAFT')
    expect(text).toContain('Sunnyside High School')
    expect(text).toContain('Grade 10 Term 2 Test')
    expect(text).toContain(`Page ${i + 1} of 3`)
  }
  const b = await pageTexts(files['Test B-stamped.pdf'])
  expect(b[1]).toContain('Page 2 of 2')
  // Pages keep their size and stored rotation: the stamps are drawn onto them, not redrawn.
  expect(await describePdf(files['Test B-stamped.pdf'])).toEqual({ widths: [500, 510], rotations: [0, 90] })

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('stamps only the chosen pages and counts from them', async ({ page }) => {
  await page.goto(STAMP)
  await page.locator('#file-input').setInputFiles([await pdfFile('Memo.pdf', [400, 400, 400])])
  await page.getByLabel('These pages').check()
  await page.getByLabel('Pages to stamp').fill('nine')
  await expect(page.locator('#range-error')).toContainText('"nine" is not a page or a range')
  await expect(page.locator('#download')).toBeDisabled()
  await page.getByLabel('Pages to stamp').fill('2-3')
  await expect(page.locator('#range-error')).toBeHidden()
  await previewDrawn(page)
  await expect(page.locator('#preview-note')).toHaveText('This page is not stamped.')

  const out = await download(page, () => page.getByRole('button', { name: 'Download stamped PDF' }).click())
  expect(out.name).toBe('Memo-stamped.pdf')
  const texts = await pageTexts(new Uint8Array(out.bytes))
  expect(texts[0]).not.toContain('MEMO')
  expect(texts[1]).toContain('MEMO')
  expect(texts[1]).toContain('Page 1 of 2')
  expect(texts[2]).toContain('Page 2 of 2')
})

test('remembers the settings on this device', async ({ page }) => {
  await page.goto(STAMP)
  await page.locator('#file-input').setInputFiles([await pdfFile('Memo.pdf', [400])])
  await page.locator('#footer-text').fill('Mathematics')
  await page.reload()
  await page.locator('#file-input').setInputFiles([await pdfFile('Memo.pdf', [400])])
  await expect(page.locator('#footer-text')).toHaveValue('Mathematics')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(STAMP)
  await page.locator('#file-input').setInputFiles([await pdfFile('A long file name for a phone.pdf', [595])])
  await previewDrawn(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
