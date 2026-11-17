import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFName, rgb } from 'pdf-lib'

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 2; i++) {
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  }
  return Buffer.from(await doc.save())
}

async function openTest(page: Page): Promise<void> {
  await page.goto('./')
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer: await fixture() })
  await expect(page.locator('.page')).toHaveCount(2)
}

const popup = (page: Page) => page.locator('.reason-popup')
const firstPage = (page: Page) => page.locator('.page').first()
const placeCross = (page: Page, x = 100, y = 120) => firstPage(page).click({ position: { x, y }, button: 'right' })

/** Click the Cross's centre (its strokes sit over the hit circle, so a locator click is intercepted). */
async function clickCross(page: Page): Promise<void> {
  const b = (await page.locator('.annotation-cross circle').boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

async function localStorageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage))
}

test('placing a Cross offers the default Reasons; choosing one shows a red tag beside the Cross', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await expect(popup(page)).toBeVisible()
  for (const r of ['Factual error', 'RTQ', 'Repeated fact']) {
    await expect(popup(page).getByRole('button', { name: r, exact: true })).toBeVisible()
  }
  await popup(page).getByRole('button', { name: 'RTQ', exact: true }).click()
  await expect(popup(page)).toHaveCount(0)
  const tag = page.locator('.annotation-cross .reason-tag')
  await expect(tag).toHaveText('RTQ')
  expect(await tag.evaluate((e) => getComputedStyle(e).fill)).toMatch(/^rgb\(2\d\d, \d+, \d+\)$/)
  // The tag sits beside (to the right of) the Cross.
  const cross = (await page.locator('.annotation-cross circle').boundingBox())!
  const tagBox = (await tag.boundingBox())!
  expect(tagBox.x).toBeGreaterThan(cross.x + cross.width / 2)
})

test('Escape dismisses the pop-up and leaves a bare Cross', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await expect(popup(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
  await expect(page.locator('.reason-tag')).toHaveCount(0)
})

test('marking elsewhere never waits on the pop-up: the next click places a Tick and leaves the Cross bare', async ({
  page,
}) => {
  await openTest(page)
  await placeCross(page, 100, 120)
  await expect(popup(page)).toBeVisible()
  await firstPage(page).click({ position: { x: 20, y: 600 } })
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await expect(page.locator('.reason-tag')).toHaveCount(0)
})

test('a second right-click Cross replaces the pop-up for the new Cross', async ({ page }) => {
  await openTest(page)
  await placeCross(page, 100, 120)
  await placeCross(page, 40, 500)
  await expect(page.locator('.annotation-cross')).toHaveCount(2)
  await expect(popup(page)).toHaveCount(1)
  await popup(page).getByRole('button', { name: 'Repeated fact', exact: true }).click()
  await expect(page.locator('.reason-tag')).toHaveCount(1)
  await expect(page.locator('.annotation-cross').nth(1).locator('.reason-tag')).toHaveText('Repeated fact')
})

test('clicking an existing Cross re-opens the pop-up to change or clear its Reason', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await popup(page).getByRole('button', { name: 'RTQ', exact: true }).click()
  await expect(page.locator('.reason-tag')).toHaveText('RTQ')

  await clickCross(page)
  await expect(popup(page)).toBeVisible()
  await expect(page.locator('.annotation-tick')).toHaveCount(0) // no Tick stacked on the Cross
  await popup(page).getByRole('button', { name: 'Factual error', exact: true }).click()
  await expect(page.locator('.reason-tag')).toHaveText('Factual error')

  await clickCross(page)
  await popup(page).getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('.reason-tag')).toHaveCount(0)
  await expect(page.locator('.annotation-cross')).toHaveCount(1)
})

test('the tag follows zoom', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await popup(page).getByRole('button', { name: 'RTQ', exact: true }).click()
  const before = (await page.locator('.reason-tag').boundingBox())!
  await page.locator('#zoom-in').click()
  const after = (await page.locator('.reason-tag').boundingBox())!
  expect(after.height).toBeGreaterThan(before.height)
})

test('the teacher can edit the Reasons list; it survives a reload, and nothing else is stored', async ({ page }) => {
  await openTest(page)
  expect(await localStorageKeys(page)).toEqual([])
  await page.locator('#edit-reasons').click()
  await page.locator('#reasons-text').fill('Units\n  Method  \n\nUnits')
  await page.locator('#reasons-save').click()
  await expect(page.locator('#reasons-editor')).toHaveCount(0)

  await placeCross(page)
  await expect(popup(page).locator('.reason-choice')).toHaveText(['Units', 'Method'])
  await popup(page).getByRole('button', { name: 'Method', exact: true }).click()
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 30, y: 30 } }) // a Tick too

  // Only the Reasons list is in storage: no PDF data, no annotations.
  const keys = await localStorageKeys(page)
  expect(keys).toEqual(['red-pen.mark.reasons'])
  const stored = await page.evaluate(() => localStorage.getItem('red-pen.mark.reasons'))
  expect(JSON.parse(stored!)).toEqual(['Units', 'Method'])

  await page.reload({ waitUntil: 'load' })
  await page.locator('#file-input').setInputFiles({
    name: 'learner-1.pdf',
    mimeType: 'application/pdf',
    buffer: await fixture(),
  })
  await expect(page.locator('.page')).toHaveCount(2)
  await expect(page.locator('.annotation')).toHaveCount(0) // marks did not persist
  await placeCross(page)
  await expect(popup(page).locator('.reason-choice')).toHaveText(['Units', 'Method'])
  expect(await localStorageKeys(page)).toEqual(['red-pen.mark.reasons'])
})

test('the pop-up can open the Reasons editor, and Cancel keeps the list', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await popup(page)
    .getByRole('button', { name: /Edit reasons/ })
    .click()
  await expect(page.locator('#reasons-editor')).toBeVisible()
  await page.locator('#reasons-text').fill('Only one')
  await page.getByRole('button', { name: 'Cancel' }).click()
  expect(await localStorageKeys(page)).toEqual([])
  await placeCross(page, 60, 300)
  await expect(popup(page).locator('.reason-choice')).toHaveCount(7)
})

test('exporting includes the Reason tag as text in the marked PDF', async ({ page }) => {
  await openTest(page)
  await placeCross(page)
  await popup(page).getByRole('button', { name: 'Factual error', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()])
  const doc = await PDFDocument.load(await readFile((await download.path())!))
  expect(doc.getPageCount()).toBe(2)
  const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'))
  expect(fonts).toBeDefined()
})

test('deleting a Cross with Delete closes its pop-up; dragging a Cross carries its tag and opens no pop-up', async ({
  page,
}) => {
  await openTest(page)
  await placeCross(page)
  await popup(page).getByRole('button', { name: 'RTQ', exact: true }).click()
  const b = (await page.locator('.annotation-cross circle').boundingBox())!
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 80, { steps: 6 })
  await page.mouse.up()
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('.annotation-cross .reason-tag')).toHaveText('RTQ')
  const moved = (await page.locator('.annotation-cross circle').boundingBox())!
  expect(moved.y).toBeGreaterThan(b.y + 60)

  await clickCross(page)
  await expect(popup(page)).toBeVisible()
  await page.keyboard.press('Delete')
  await expect(page.locator('.annotation-cross')).toHaveCount(0)
  await expect(popup(page)).toHaveCount(0)
})
