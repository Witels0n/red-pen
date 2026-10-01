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
}

/** Drag a toolbar tool onto the first page at a position relative to the page. */
async function dragTool(page: Page, tool: string, at: { x: number; y: number }): Promise<void> {
  const from = (await page.locator(`#tool-${tool}`).boundingBox())!
  const pageBox = (await page.locator('.page').first().boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(pageBox.x + at.x, pageBox.y + at.y, { steps: 5 })
  await page.mouse.up()
}

test('a Subtotal dragged from the toolbar counts the Ticks above it and updates live', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 200, y: 100 } })
  await first.click({ position: { x: 200, y: 160 } })
  await dragTool(page, 'subtotal', { x: 60, y: 300 })
  await expect(page.locator('.annotation-subtotal text')).toHaveText('2')

  await first.click({ position: { x: 200, y: 200 } })
  await expect(page.locator('.annotation-subtotal text')).toHaveText('3')
  await first.click({ position: { x: 200, y: 400 } }) // below the Subtotal
  await expect(page.locator('.annotation-subtotal text')).toHaveText('3')
  await expect(page.locator('.annotation-cross')).toHaveCount(0)
})

test('the Total prompts for out-of, remembers it, allows only one and warns when exceeded', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 200, y: 100 } })
  await dragTool(page, 'total', { x: 100, y: 500 })
  await page.locator('#dialog-input').fill('1')
  await page.locator('#dialog-ok').click()
  await expect(page.locator('.annotation-total text')).toHaveText('1 / 1')
  await expect(page.locator('#tool-total')).toHaveAttribute('aria-disabled', 'true')

  const warn = () => page.locator('.annotation-total text').getAttribute('fill')
  const ok = await warn()
  await first.click({ position: { x: 200, y: 160 } }) // over the maximum, still allowed
  await expect(page.locator('.annotation-tick')).toHaveCount(2)
  await expect(page.locator('.annotation-total text')).toHaveText('2 / 1')
  expect(await warn()).not.toBe(ok)

  // A second Total cannot be placed.
  await dragTool(page, 'total', { x: 100, y: 600 })
  await expect(page.locator('#dialog-input')).toHaveCount(0)
  await expect(page.locator('.annotation-total')).toHaveCount(1)

  // Clicking the Total edits the out-of value.
  await page.locator('.annotation-total text').click()
  await page.locator('#dialog-input').fill('40')
  await page.locator('#dialog-ok').click()
  await expect(page.locator('.annotation-total text')).toHaveText('2 / 40')

  // The remembered value pre-fills the next Total (after the first is deleted).
  await page.keyboard.press('Delete')
  await dragTool(page, 'total', { x: 100, y: 500 })
  await expect(page.locator('#dialog-input')).toHaveValue('40')
})

test('a Text note can be dragged on, typed into, edited, moved and deleted', async ({ page }) => {
  await openTest(page)
  await dragTool(page, 'text', { x: 100, y: 200 })
  await page.locator('.note-editor').fill('-1 for units')
  await page.keyboard.press('Enter')
  await expect(page.locator('.annotation-text text')).toHaveText('-1 for units')

  await page.locator('.annotation-text text').dblclick()
  await page.locator('.note-editor').fill('no working')
  await page.keyboard.press('Enter')
  await expect(page.locator('.annotation-text text')).toHaveText('no working')

  const before = (await page.locator('.annotation-text text').boundingBox())!
  await page.mouse.move(before.x + 5, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + 105, before.y + 80, { steps: 5 })
  await page.mouse.up()
  const after = (await page.locator('.annotation-text text').boundingBox())!
  expect(after.x - before.x).toBeGreaterThan(80)

  await page.keyboard.press('Delete')
  await expect(page.locator('.annotation-text')).toHaveCount(0)
  await expect(page.locator('.annotation-tick')).toHaveCount(0)
})

test('an empty Text note is not kept', async ({ page }) => {
  await openTest(page)
  await dragTool(page, 'text', { x: 100, y: 200 })
  await page.keyboard.press('Enter')
  await expect(page.locator('.annotation-text')).toHaveCount(0)
})

test('Ctrl+Z undoes and Ctrl+Y redoes; a new mark after undo drops the redo history', async ({ page }) => {
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 200, y: 100 } })
  await first.click({ position: { x: 200, y: 160 } })
  await expect(page.locator('.annotation-tick')).toHaveCount(2)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.annotation-tick')).toHaveCount(1)
  await page.keyboard.press('Control+y')
  await expect(page.locator('.annotation-tick')).toHaveCount(2)

  await page.keyboard.press('Control+z')
  await first.click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+y')
  await expect(page.locator('.annotation-tick')).toHaveCount(2)
})

test('the exported PDF contains the Subtotal, Total and note text and no network is used', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(new URL(r.url()).origin)
  })
  await openTest(page)
  const first = page.locator('.page').first()
  await first.click({ position: { x: 200, y: 100 } })
  await dragTool(page, 'subtotal', { x: 60, y: 300 })
  await dragTool(page, 'total', { x: 100, y: 500 })
  await page.locator('#dialog-input').fill('40')
  await page.locator('#dialog-ok').click()
  await dragTool(page, 'text', { x: 100, y: 200 })
  await page.locator('.note-editor').fill('hello')
  await page.keyboard.press('Enter')

  const download = page.waitForEvent('download')
  await page.locator('#export').click()
  const file = await download
  expect(file.suggestedFilename()).toBe('learner-1-marked.pdf')
  const path = await file.path()
  const out = await PDFDocument.load(await (await import('node:fs/promises')).readFile(path))
  expect(out.getPageCount()).toBe(2)
  expect(new Set(requests).size).toBe(1) // only the app's own origin
})
