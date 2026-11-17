import { expect, test } from '@playwright/test'
import { createCanvas } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import {
  describePdf,
  download,
  expectNetworkBlocked,
  lockedPdf,
  pdfFile,
  trackRequests,
  type FixtureFile,
} from './pdf-fixtures'

const COMPRESS = '/red-pen/compress/'

/** A "scan": A4 pages, each a heavy 200 dpi JPEG with speckles, as a phone scanner app makes. */
async function scanPdf(name: string, pageCount: number): Promise<FixtureFile> {
  const canvas = createCanvas(1240, 1754)
  const ctx = canvas.getContext('2d')
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  ctx.fillStyle = '#f4f1e8'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < 60000; i++) {
    const g = Math.floor(random() * 255)
    ctx.fillStyle = `rgb(${g},${Math.floor(random() * 255)},${g})`
    ctx.fillRect(random() * canvas.width, random() * canvas.height, 3, 3)
  }
  ctx.fillStyle = '#000'
  ctx.font = '64px sans-serif'
  ctx.fillText('Grade 9 test', 120, 200)
  const jpeg = canvas.toBuffer('image/jpeg', 95)

  const doc = await PDFDocument.create()
  const image = await doc.embedJpg(jpeg)
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([595.28, 841.89]).drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 })
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

function kb(text: string): number {
  const [n, unit] = text.split(' ')
  return unit === 'MB' ? Number(n) * 1024 : unit === 'KB' ? Number(n) : Number(n) / 1024
}

test('compresses scans, keeps a typed PDF that would grow, and zips them', async ({ page, baseURL }) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(COMPRESS)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Compress a PDF')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')

  const scan = await scanPdf('scan.pdf', 2)
  await page.locator('#file-input').setInputFiles([scan, await pdfFile('typed.pdf', [595])])
  await expect(page.locator('.file-item')).toHaveCount(2)
  await expect(page.locator('.picture-warning')).toContainText('Every page becomes a picture')

  await page.getByRole('radio', { name: 'Small 100 dpi' }).check()
  await page.getByLabel(/Greyscale/).check()
  await page.locator('#compress').click()
  await expect(page.locator('.file-item.done')).toHaveCount(2, { timeout: 30_000 })
  await expect(page.locator('#progress-text')).toHaveText('Done.')

  const scanItem = page.locator('.file-item', { hasText: 'scan.pdf' })
  await expect(scanItem.locator('.change')).toContainText('smaller')
  await expect(scanItem.locator('.settings-used')).toContainText('100 dpi, quality 70%')
  await expect(scanItem.locator('.choice-select')).toHaveValue('compressed')
  const typedItem = page.locator('.file-item', { hasText: 'typed.pdf' })
  await expect(typedItem.locator('.change')).toContainText('larger')
  await expect(typedItem.locator('.file-note')).toContainText('the original is kept')
  await expect(typedItem.locator('.choice-select')).toHaveValue('original')

  const zip = await download(page, () => page.getByRole('button', { name: 'Download all (.zip)' }).click())
  expect(zip.name).toBe('compressed-pdfs.zip')
  const files = unzipSync(new Uint8Array(zip.bytes))
  expect(Object.keys(files).sort()).toEqual(['scan-compressed.pdf', 'typed.pdf'])
  expect(files['scan-compressed.pdf'].length).toBeLessThan(scan.buffer.length)
  expect((await describePdf(files['scan-compressed.pdf'])).widths).toEqual([595, 595])

  // A target size well below the first result: lower settings are tried until it fits.
  const firstKb = kb((await scanItem.locator('.new-size').textContent())!)
  const targetKb = Math.floor(firstKb / 2)
  await page.getByRole('button', { name: 'Remove typed.pdf' }).click()
  await page.locator('#target-value').fill(String(targetKb))
  await page.locator('#target-unit').selectOption('KB')
  await expect(page.locator('#use-target')).toBeChecked()
  await expect(page.locator('.file-item.done')).toHaveCount(0) // new settings: results cleared
  await page.locator('#compress').click()
  await expect(page.locator('.file-item.done')).toHaveCount(1, { timeout: 60_000 })
  const one = await download(page, () => page.getByRole('button', { name: 'Download scan.pdf' }).click())
  expect(one.name).toBe('scan-compressed.pdf')
  expect(one.bytes.length).toBeLessThanOrEqual(targetKb * 1024)

  // Settings are remembered on this device.
  await page.reload()
  await expect(page.locator('input[name="preset"][value="small"]')).toBeChecked()
  await expect(page.locator('#target-unit')).toHaveValue('KB')

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('compression can be cancelled', async ({ page }) => {
  await page.goto(COMPRESS)
  await page.locator('#file-input').setInputFiles([await scanPdf('long-scan.pdf', 10)])
  await page.getByRole('radio', { name: 'Sharp 200 dpi' }).check()
  // Press Cancel the moment the first page is reported, so the test does not race the compression.
  await page.evaluate(() => {
    const text = document.getElementById('progress-text')!
    const observer = new MutationObserver(() => {
      if (!text.textContent?.includes('page 1 of 10')) return
      observer.disconnect()
      document.getElementById('cancel')!.click()
    })
    observer.observe(text, { childList: true, characterData: true, subtree: true })
  })
  await page.locator('#compress').click()
  await expect(page.locator('#progress-text')).toHaveText('Cancelled.')
  await expect(page.locator('.file-result')).toHaveText('Cancelled')
  await expect(page.locator('#compress')).toBeEnabled()
})

test('a locked PDF shows a clear error', async ({ page }) => {
  await page.goto(COMPRESS)
  await page.locator('#file-input').setInputFiles([await lockedPdf()])
  await expect(page.locator('#open-error')).toContainText('it is password protected')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(COMPRESS)
  await page
    .locator('#file-input')
    .setInputFiles([await pdfFile('a-very-long-file-name-for-a-whole-class-scan.pdf', [595])])
  await page.locator('#compress').click()
  await expect(page.locator('.file-item.done')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
