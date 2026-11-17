import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFArray, PDFDocument, PDFRawStream, PDFStream, decodePDFRawStream, rgb } from 'pdf-lib'

async function fixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  }
  return Buffer.from(await doc.save())
}

async function openTest(page: Page): Promise<void> {
  await page.goto('./')
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() })
  await expect(page.locator('.page')).toHaveCount(3)
}

/** Centre of the n-th tick in viewport px. */
async function tickPoint(page: Page, index = 0) {
  return page
    .locator('.annotation-tick')
    .nth(index)
    .evaluate((tick) => {
      const r = tick.querySelector('circle')!.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
}

async function dragTick(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test('clicking a Tick selects it and places no new Tick; blank click deselects and places one', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 150, y: 150 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await expect(page.locator('.annotation-tick.selected')).toHaveCount(0)

  const p = await tickPoint(page)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await expect(page.locator('.annotation-tick.selected')).toHaveCount(1)

  await first.click({ position: { x: 300, y: 300 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(2)
  await expect(page.locator('.annotation-tick.selected')).toHaveCount(0)
})

test('dragging a Tick moves it without adding one, and it stays selected', async ({ page }) => {
  await openTest(page)
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 150, y: 150 } })
  const from = await tickPoint(page)
  await dragTick(page, from, { x: from.x + 80, y: from.y + 60 })
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  const to = await tickPoint(page)
  expect(Math.abs(to.x - (from.x + 80))).toBeLessThan(1.5)
  expect(Math.abs(to.y - (from.y + 60))).toBeLessThan(1.5)
  await expect(page.locator('.annotation-tick.selected')).toHaveCount(1)
})

test('a Tick can be dragged onto another page', async ({ page }) => {
  await openTest(page)
  for (let i = 0; i < 3; i++) await page.locator('#zoom-out').click() // both pages in view
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 100, y: 100 } })
  const second = page.locator('.page').nth(1)
  const from = await tickPoint(page)
  const box = (await second.boundingBox())!
  await dragTick(page, from, { x: box.x + 60, y: box.y + 60 })
  await expect(page.locator('.page').nth(1).locator('.annotation-tick')).toHaveCount(1)
  await expect(page.locator('.page').first().locator('.annotation-tick')).toHaveCount(0)
})

test('Delete and Backspace remove the selected Tick; nothing selected means nothing removed', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 150, y: 150 } })
  await first.click({ position: { x: 300, y: 300 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(page.locator('.annotation-tick')).toHaveCount(2)

  const p = await tickPoint(page, 0)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('Delete')
  await expect(page.locator('.annotation-tick')).toHaveCount(1)

  const q = await tickPoint(page, 0)
  await page.mouse.click(q.x, q.y)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.annotation-tick')).toHaveCount(0)
})

test('the moved position, not the original, is exported', async ({ page }) => {
  await openTest(page)
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 150, y: 150 } })
  const from = await tickPoint(page)
  await dragTick(page, from, { x: from.x + 100, y: from.y + 50 })
  const to = await tickPoint(page)
  const pageBox = (await page.locator('.page').first().boundingBox())!
  const scale = pageBox.width / 595
  const expected = { x: (to.x - pageBox.x) / scale, y: (to.y - pageBox.y) / scale }

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()])
  const doc = await PDFDocument.load(await readFile((await download.path())!))
  const contents = doc.getPage(0).node.Contents()
  const streams: PDFStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(doc.context.lookup(contents.get(i), PDFStream))
  } else if (contents) streams.push(contents as PDFStream)
  const text = streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n')
  // The first tick segment starts 7 units left of the anchor, at its height (bottom-left space).
  const m = /RG\n2 w\n\[\] 0 d\n(\S+) (\S+) m/.exec(text)
  expect(m, text).not.toBeNull()
  expect(Math.abs(Number(m![1]) + 7 - expected.x), JSON.stringify({ text, expected })).toBeLessThan(1.5)
  expect(Math.abs(842 - Number(m![2]) - expected.y)).toBeLessThan(1.5)
})
