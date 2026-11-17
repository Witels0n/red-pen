import { createCanvas, loadImage } from '@napi-rs/canvas'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

async function openTest(page: Page, width = 1366): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await page.goto('./')
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.addPage([595, 842])
  const buffer = Buffer.from(await doc.save())
  await page.locator('#file-input').setInputFiles({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer })
  await expect(page.locator('.page[data-rendered="true"]').first()).toBeVisible()
}

/** Counts strongly red pixels in a screenshot of the region around a point. */
async function redPixelsAround(page: Page, x: number, y: number): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - 30, y: y - 30, width: 60, height: 60 } })
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  let red = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 90) red++
  return red
}

test('placed marks are actually painted on screen, not just present in the page', async ({ page }) => {
  await openTest(page)
  const box = (await page.locator('.page').first().boundingBox())!
  const x = box.x + 300
  const y = box.y + 200
  expect(await redPixelsAround(page, x, y)).toBe(0)
  await page.mouse.click(x, y)
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  expect(await redPixelsAround(page, x, y)).toBeGreaterThan(20)
})

test('the click mode switches what a click places, and right-click places the other mark', async ({ page }) => {
  await openTest(page)
  const pg = page.locator('.page').first()
  await expect(page.locator('#mode-tick')).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#mode-cross').click()
  await expect(page.locator('#mode-cross')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#hint-click')).toHaveText('cross')
  await pg.click({ position: { x: 200, y: 150 } })
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
  await page.keyboard.press('Escape') // close the Reason pop-up
  await pg.click({ position: { x: 200, y: 300 }, button: 'right' })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)

  await page.keyboard.press('t')
  await expect(page.locator('#mode-tick')).toHaveAttribute('aria-pressed', 'true')
  await pg.click({ position: { x: 200, y: 450 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(2)
  await page.keyboard.press('x')
  await expect(page.locator('#mode-cross')).toHaveAttribute('aria-pressed', 'true')
})

test('the mark count, undo and redo buttons follow the marking', async ({ page }) => {
  await openTest(page)
  const pg = page.locator('.page').first()
  await expect(page.locator('#undo')).toBeDisabled()
  await expect(page.locator('#redo')).toBeDisabled()

  await pg.click({ position: { x: 200, y: 150 } })
  await pg.click({ position: { x: 200, y: 300 } })
  await pg.click({ position: { x: 200, y: 450 }, button: 'right' })
  await page.keyboard.press('Escape')
  await expect(page.locator('#tick-count')).toHaveText('2')
  await expect(page.locator('#cross-count')).toHaveText('1')

  await page.locator('#undo').click()
  await expect(page.locator('#cross-count')).toHaveText('0')
  await expect(page.locator('#redo')).toBeEnabled()
  await page.locator('#redo').click()
  await expect(page.locator('#cross-count')).toHaveText('1')
})

test('a drag chip can be placed from the keyboard', async ({ page }) => {
  await openTest(page)
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 200, y: 150 } })
  await page.locator('#tool-subtotal').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.annotation-subtotal')).toHaveCount(1)
})

test('the tips can be hidden, and stay hidden after a reload', async ({ page }) => {
  await openTest(page)
  await expect(page.locator('#hint')).toBeVisible()
  await page.locator('#hint-close').click()
  await expect(page.locator('#hint')).toBeHidden()
  await openTest(page)
  await expect(page.locator('#hint')).toBeHidden()
})

for (const width of [1366, 820, 390]) {
  test(`the toolbar fits at ${width}px: no sideways scroll and Export always in view`, async ({ page }) => {
    await openTest(page, width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const exportBox = (await page.locator('#export').boundingBox())!
    expect(exportBox.x + exportBox.width).toBeLessThanOrEqual(width)
    if (width >= 1366) expect((await page.locator('#toolbar').boundingBox())!.height).toBeLessThan(60)
  })
}

test('on a phone, the less-used tools fold behind More', async ({ page }) => {
  await openTest(page, 390)
  await expect(page.locator('#edit-reasons')).toBeHidden()
  await page.locator('#more').click()
  await expect(page.locator('#more')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#edit-reasons')).toBeVisible()
  await expect(page.locator('#zoom-fit')).toBeVisible()
})
