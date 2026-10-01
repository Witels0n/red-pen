import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument, rgb } from 'pdf-lib'

async function fixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  }
  return Buffer.from(await doc.save())
}

async function openTest(page: Page): Promise<number> {
  await page.goto('./')
  const buffer = await fixturePdf()
  await page.locator('#file-input').setInputFiles({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer })
  await expect(page.locator('.page')).toHaveCount(3)
  return buffer.length
}

/** Centre of the tick's hit circle relative to the first page, in CSS px. */
async function tickCentre(page: Page, index = 0) {
  return page.locator('.annotation-tick').nth(index).evaluate((tick) => {
    const pageEl = tick.closest('.page')!.getBoundingClientRect()
    const r = tick.querySelector('circle')!.getBoundingClientRect()
    return { x: r.left + r.width / 2 - pageEl.left, y: r.top + r.height / 2 - pageEl.top, scale: pageEl.width / 595 }
  })
}

test('clicking blank page places a red Tick exactly where clicked, at every zoom level', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()

  for (const [i, zoom] of ['fit', 'in', 'in', 'out', 'out', 'out'].entries()) {
    if (zoom === 'in') await page.locator('#zoom-in').click()
    if (zoom === 'out') await page.locator('#zoom-out').click()
    await first.scrollIntoViewIfNeeded()
    const before = await page.locator('.annotation-tick').count()
    // Click at 40% / 50% of the page's visible size, in the page's own coordinates.
    const box = (await first.boundingBox())!
    const at = { x: Math.min(box.width * 0.4, 200) + i * 7, y: 40 + i * 70 }
    await first.click({ position: at })
    await expect(page.locator('.annotation-tick')).toHaveCount(before + 1)
    const c = await tickCentre(page, before)
    expect(Math.abs(c.x - at.x)).toBeLessThan(1.5)
    expect(Math.abs(c.y - at.y)).toBeLessThan(1.5)
    expect(await page.locator('.annotation-tick polyline').last().evaluate((e) => getComputedStyle(e).stroke)).toMatch(/^rgb\(2\d\d, \d+, \d+\)$/)
  }

  // Existing ticks follow zoom: same page position, new pixel position.
  await page.locator('#zoom-fit').click()
  const fitCentre = await tickCentre(page, 0)
  await page.locator('#zoom-in').click()
  const zoomedCentre = await tickCentre(page, 0)
  expect(zoomedCentre.scale).toBeGreaterThan(fitCentre.scale)
  expect(zoomedCentre.x / zoomedCentre.scale).toBeCloseTo(fitCentre.x / fitCentre.scale, 0)
  expect(zoomedCentre.y / zoomedCentre.scale).toBeCloseTo(fitCentre.y / fitCentre.scale, 0)
})

test('clicking an existing Tick does not stack another one on it', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 150, y: 150 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await first.click({ position: { x: 150, y: 150 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
})

test('Export downloads <name>-marked.pdf with the same pages and added marks', async ({ page }) => {
  const originalSize = await openTest(page)
  await page.locator('.page').first().click({ position: { x: 100, y: 120 } })
  await page.locator('.page').first().click({ position: { x: 200, y: 220 } })

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()])
  expect(download.suggestedFilename()).toBe('learner-1-marked.pdf')
  const bytes = await readFile((await download.path())!)
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBe(3)
  expect(bytes.length).toBeGreaterThan(originalSize)
})

test('opening another file starts with a clean slate', async ({ page }) => {
  await openTest(page)
  await page.locator('.page').first().click({ position: { x: 100, y: 120 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await page.locator('#file-input').setInputFiles({
    name: 'learner-2.pdf',
    mimeType: 'application/pdf',
    buffer: await fixturePdf(),
  })
  await expect(page.locator('#file-name')).toHaveText('learner-2.pdf')
  await expect(page.locator('.annotation-tick')).toHaveCount(0)
})

// Closing a page with runBeforeUnload raises a 'beforeunload' dialog only when the page asked
// for one. Returns whether it did.
async function closeAndSeeWarning(page: Page): Promise<boolean> {
  const warned = page.waitForEvent('dialog').then(async (d) => {
    const isWarning = d.type() === 'beforeunload'
    await d.accept()
    return isWarning
  })
  const closed = page.waitForEvent('close').then(() => false)
  await page.close({ runBeforeUnload: true })
  return Promise.race([warned, closed])
}

test('closing with unexported marks warns', async ({ page }) => {
  await openTest(page)
  await page.locator('.page').first().click({ position: { x: 100, y: 120 } })
  expect(await closeAndSeeWarning(page)).toBe(true)
})

test('closing with nothing marked does not warn', async ({ page }) => {
  await openTest(page)
  expect(await closeAndSeeWarning(page)).toBe(false)
})

test('closing right after exporting does not warn', async ({ page }) => {
  await openTest(page)
  await page.locator('.page').first().click({ position: { x: 100, y: 120 } })
  await Promise.all([page.waitForEvent('download'), page.locator('#export').click()])
  expect(await closeAndSeeWarning(page)).toBe(false)
})
