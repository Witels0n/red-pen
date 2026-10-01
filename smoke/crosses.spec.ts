import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, rgb } from 'pdf-lib'

async function openTest(page: Page): Promise<void> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 2; i++) {
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  }
  await page.goto('./')
  await page.locator('#file-input').setInputFiles({
    name: 'learner-1.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  })
  await expect(page.locator('.page')).toHaveCount(2)
  // Records whether the page cancelled each contextmenu event (i.e. no browser menu appears).
  await page.evaluate(() => {
    const w = window as unknown as { __menus: boolean[] }
    w.__menus = []
    document.addEventListener('contextmenu', (e) => w.__menus.push(e.defaultPrevented))
  })
}

async function crossCentre(page: Page, index: number) {
  return page.locator('.annotation-cross').nth(index).evaluate((cross) => {
    const pageEl = cross.closest('.page')!.getBoundingClientRect()
    const r = cross.querySelector('circle')!.getBoundingClientRect()
    return { x: r.left + r.width / 2 - pageEl.left, y: r.top + r.height / 2 - pageEl.top }
  })
}

test('right-click places a red Cross exactly where clicked at every zoom, with no browser menu', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()

  for (const [i, zoom] of ['fit', 'in', 'in', 'out', 'out', 'out'].entries()) {
    if (zoom === 'in') await page.locator('#zoom-in').click()
    if (zoom === 'out') await page.locator('#zoom-out').click()
    await first.scrollIntoViewIfNeeded()
    const box = (await first.boundingBox())!
    const at = { x: Math.min(box.width * 0.4, 200) + i * 7, y: 40 + i * 70 }
    await first.click({ position: at, button: 'right' })
    await expect(page.locator('.annotation-cross')).toHaveCount(i + 1)
    const c = await crossCentre(page, i)
    expect(Math.abs(c.x - at.x)).toBeLessThan(1.5)
    expect(Math.abs(c.y - at.y)).toBeLessThan(1.5)
    expect(await page.locator('.annotation-cross line').last().evaluate((e) => getComputedStyle(e).stroke)).toMatch(/^rgb\(2\d\d, \d+, \d+\)$/)
  }

  const menus = await page.evaluate(() => (window as unknown as { __menus: boolean[] }).__menus)
  expect(menus).toHaveLength(6)
  expect(menus.every(Boolean)).toBe(true)
  await expect(page.locator('.annotation-tick')).toHaveCount(0)
})

test('right-clicking an existing Cross does not stack another, and still suppresses the menu', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 150, y: 150 }, button: 'right' })
  await first.click({ position: { x: 150, y: 150 }, button: 'right' })
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
  const menus = await page.evaluate(() => (window as unknown as { __menus: boolean[] }).__menus)
  expect(menus).toEqual([true, true])
})

test('a Cross is not a Tick', async ({ page }) => {
  await openTest(page)
  await page.locator('.page').first().click({ position: { x: 100, y: 120 }, button: 'right' })
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
  await expect(page.locator('.annotation-tick')).toHaveCount(0)
})

