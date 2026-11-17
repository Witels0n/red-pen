import { expect, test, type Page } from '@playwright/test'
import { createCanvas } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { download, expectNetworkBlocked, trackRequests, type FixtureFile } from './pdf-fixtures'

const SCAN = '/red-pen/scan/'

/** A phone photo of a page: a slightly tilted white sheet with lines of "writing" on a dark desk. */
function photo(name: string, type: 'png' | 'jpeg' = 'jpeg', width = 900, height = 1200): FixtureFile {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3a3530'
  ctx.fillRect(0, 0, width, height)
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(0.06)
  ctx.fillStyle = '#f2f0ea'
  ctx.fillRect(-width * 0.36, -height * 0.4, width * 0.72, height * 0.8)
  ctx.fillStyle = '#20263a'
  for (let i = 0; i < 12; i++) ctx.fillRect(-width * 0.3, -height * 0.33 + i * 70, width * (0.3 + (i % 3) * 0.1), 10)
  ctx.restore()
  const buffer = type === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 90)
  return { name, mimeType: `image/${type}`, buffer }
}

async function addPhotos(page: Page, files: FixtureFile[], expected: number) {
  await page.locator('#photo-input').setInputFiles(files)
  await expect(page.locator('.page-card canvas[data-rendered="true"]')).toHaveCount(expected)
}

async function pageSizes(bytes: Uint8Array): Promise<number[][]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
}

test('photos become one PDF and a PDF per learner, with nothing sent anywhere', async ({ page, baseURL }) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(SCAN)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Photos to PDF')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await expect(page.locator('#camera-input')).toHaveAttribute('capture', 'environment')

  // A HEIC this browser cannot decode is refused with a clear message; the other photos are added.
  const heic: FixtureFile = { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a photo') }
  await addPhotos(page, [photo('page-1.jpg'), photo('page-2.png', 'png'), heic, photo('page-3.jpg')], 3)
  await expect(page.locator('#work-error')).toContainText('"IMG_0001.heic" is a HEIC photo')
  await expect(page.locator('#summary')).toHaveText('3 pages')
  await expect(page.locator('#estimate')).toContainText(/PDF about \d/)

  // Crop editor: corners were suggested, the look and turn can change.
  await page.getByRole('button', { name: 'Edit page 1' }).click()
  const editor = page.locator('#editor')
  await expect(editor).toBeVisible()
  await expect(editor.locator('.handle')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Find the page' })).toBeEnabled()
  // Drag the top left corner a little, then use the keyboard on it.
  const handle = editor.locator('.handle').first()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 4 })
  await page.mouse.up()
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await editor.getByLabel('Black and white').check()
  await page.getByRole('button', { name: 'Turn right' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(editor).toBeHidden()

  // Grid actions.
  await page.getByRole('button', { name: 'Duplicate page 3' }).click()
  await expect(page.locator('.page-card')).toHaveCount(4)
  await page.getByRole('button', { name: 'Delete page 4' }).click()
  await page.getByRole('button', { name: 'Move page 3 earlier' }).click()
  await page.getByRole('button', { name: 'Turn page 2' }).click()
  await expect(page.locator('.page-card')).toHaveCount(3)

  // Drag page 1 after page 2 by its handle.
  const from = (await page.locator('.page-card .drag-handle').nth(0).boundingBox())!
  const to = (await page.locator('.page-card').nth(1).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.page-card').nth(1).locator('canvas')).toBeVisible()

  // One PDF, A4.
  await page.getByLabel('File name').fill('Grade 9 essays')
  const one = await download(page, () => page.getByRole('button', { name: 'Download PDF' }).click())
  expect(one.name).toBe('Grade 9 essays.pdf')
  const sizes = await pageSizes(new Uint8Array(one.bytes))
  expect(sizes).toHaveLength(3)
  for (const s of sizes)
    expect([
      [595, 842],
      [842, 595],
    ]).toContainEqual(s)

  // Fit to photo changes the page shape.
  await page.getByLabel('Page size').selectOption('fit')
  const fit = await download(page, () => page.getByRole('button', { name: 'Download PDF' }).click())
  expect((await pageSizes(new Uint8Array(fit.bytes))).some((s) => s[0] !== 595 && s[0] !== 842)).toBe(true)

  // A PDF per learner: mark the first pages, name a learner.
  await page.getByLabel('A PDF per learner').check()
  await expect(page.locator('#parts .part')).toHaveCount(1)
  await page.locator('.page-card').nth(2).getByRole('button', { name: 'First page of a learner' }).click()
  await expect(page.locator('#parts .part')).toHaveCount(2)
  await page.getByLabel('Name of learner 1').fill('Thandi Mokoena')
  await expect(page.locator('#parts .part-name')).toHaveText(['Thandi Mokoena.pdf', 'Grade 9 essays-part-02.pdf'])
  await expect(page.locator('.learner-badge').first()).toHaveText('Thandi Mokoena')

  const zip = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(zip.name).toBe('Grade 9 essays-split.zip')
  const files = unzipSync(new Uint8Array(zip.bytes))
  expect(Object.keys(files).sort()).toEqual(['Grade 9 essays-part-02.pdf', 'Thandi Mokoena.pdf'])
  expect(await pageSizes(files['Thandi Mokoena.pdf'])).toHaveLength(2)
  expect(await pageSizes(files['Grade 9 essays-part-02.pdf'])).toHaveLength(1)

  // Every N pages.
  await page.getByLabel('Pages per learner').fill('1')
  await page.getByRole('button', { name: 'Mark first pages' }).click()
  await expect(page.locator('#parts .part')).toHaveCount(3)

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('fits a phone screen without sideways scrolling, editor included', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(SCAN)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await addPhotos(page, [photo('a.jpg', 'jpeg', 1200, 1600), photo('b.jpg', 'jpeg', 1600, 1200)], 2)
  await page.getByLabel('A PDF per learner').check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await page.getByRole('button', { name: 'Edit page 2' }).click()
  await expect(page.locator('#editor')).toBeVisible()
  const width = await page.locator('#editor').evaluate((el) => el.scrollWidth)
  expect(width).toBeLessThanOrEqual(360)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('#editor')).toBeHidden()
})
