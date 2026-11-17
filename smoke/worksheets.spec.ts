import { createCanvas } from '@napi-rs/canvas'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { download, expectNetworkBlocked, trackRequests } from './pdf-fixtures'

// Worksheet maker, end to end: the example worksheet, adding activities (a labelled picture too),
// downloading the worksheet with its memo, and keeping, duplicating and deleting worksheets on the device.
const WORKSHEETS = '/red-pen/worksheets/'

function diagramPng(): Buffer {
  const canvas = createCanvas(400, 300)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 400, 300)
  ctx.fillStyle = '#2a7a3b'
  ctx.fillRect(180, 40, 40, 220)
  ctx.beginPath()
  ctx.arc(200, 60, 50, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toBuffer('image/png')
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

/** The total in the heading is the sum of every activity's marks. */
async function expectTotalOfBadges(page: Page): Promise<void> {
  const badges = await page.locator('.activity .marks-badge').allTextContents()
  const sum = badges.reduce((s, b) => s + Number(b.replace(/[[\]]/g, '')), 0)
  await expect(page.locator('#sheet-total')).toHaveText(String(sum))
}

test('makes a worksheet with a memo, keeps it on the device, and sends nothing anywhere', async ({ page, baseURL }) => {
  test.setTimeout(90_000)
  const outside = trackRequests(page, baseURL!)
  page.on('dialog', (d) => void d.accept())
  await page.goto(WORKSHEETS)
  await expect(page).toHaveTitle('Word search and crossword maker with memo · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Worksheet maker')
  await expect(page.locator('.intro.paper h1')).toHaveText('Worksheet maker')

  // The example: a word search (8 words) and fill in the blanks (4 blanks).
  await expect(page.locator('.activity')).toHaveCount(2)
  await expect(page.locator('#sheet-total')).toHaveText('12')
  await expect(page.locator('#preview-pages canvas').first()).toBeVisible()
  await expect(page.locator('#preview-pages')).toHaveAttribute('data-pages', /^[2-9]$/)

  await page.locator('#sheet-title').fill('Grade 6 Natural Sciences')
  await expect(page.locator('#worksheet-select option:checked')).toHaveText('Grade 6 Natural Sciences')

  // A word that cannot fit is reported, and the grid grows to fit a long word as it is typed.
  const search = page.locator('.activity[data-type="wordsearch"]')
  await search.getByLabel('Words', { exact: true }).fill('Photosynthesis\nLeaf\nRoot')
  await expect(search.getByLabel('Grid size')).toHaveValue('16')
  await search.getByLabel('Grid size').selectOption('8')
  await expect(search.locator('.warnings')).toContainText('Did not fit: Photosynthesis.')
  await search.getByLabel('Grid size').selectOption('16')
  await expect(search.locator('.warnings')).toBeHidden()
  await search.getByRole('button', { name: 'Shuffle' }).click()
  await expect(search.locator('.marks-badge')).toHaveText('[3]')

  // Add a crossword and a match the columns.
  await page.locator('#add-type').selectOption({ label: 'Crossword' })
  await page.locator('#add-activity').click()
  await page.locator('#add-type').selectOption({ label: 'Match the columns' })
  await page.locator('#add-activity').click()
  const match = page.locator('.activity[data-type="match"]')
  await match.getByLabel('Marks each').fill('2')
  await expect(match.locator('.marks-badge')).toHaveText('[10]')
  await expectTotalOfBadges(page)

  // A labelled diagram: tap the picture twice and type the answers.
  await page.locator('#add-type').selectOption({ label: 'Label the diagram' })
  await page.locator('#add-activity').click()
  const label = page.locator('.activity[data-type="labelling"]')
  await expect(label.locator('.warnings')).toContainText('Add a picture')
  await label
    .locator('input[type="file"]')
    .setInputFiles({ name: 'plant.png', mimeType: 'image/png', buffer: diagramPng() })
  const picture = label.locator('.diagram-stage img')
  await expect(picture).toBeVisible()
  await picture.click({ position: { x: 60, y: 40 } })
  await label.getByLabel('Label 1 answer').fill('Flower')
  await picture.click({ position: { x: 100, y: 120 } })
  await label.getByLabel('Label 2 answer').fill('Stem')
  await expect(label.locator('.pin')).toHaveText(['1', '2'])
  await expect(label.locator('.marks-badge')).toHaveText('[2]')
  await expectTotalOfBadges(page)

  // Move the match activity up, then remove the crossword.
  await match.getByRole('button', { name: 'Move up' }).click()
  await expect(page.locator('.activity').nth(2)).toHaveAttribute('data-type', 'match')
  await page
    .locator('.activity[data-type="crossword"]')
    .getByRole('button', { name: /^Remove/ })
    .click()
  await expect(page.locator('.activity')).toHaveCount(4)
  await expect(page.locator('#sheet-total')).toHaveText('19')

  // Download the worksheet and memo, then the memo alone.
  const both = await download(page, () => page.locator('#download').click())
  expect(both.name).toBe('Grade 6 Natural Sciences.pdf')
  const bothDoc = await PDFDocument.load(new Uint8Array(both.bytes))
  await page.locator('#print-part').selectOption('memo')
  const memo = await download(page, () => page.locator('#download').click())
  expect(memo.name).toBe('Grade 6 Natural Sciences memo.pdf')
  const memoDoc = await PDFDocument.load(new Uint8Array(memo.bytes))
  expect(memoDoc.getPageCount()).toBeGreaterThan(0)
  expect(bothDoc.getPageCount()).toBeGreaterThan(memoDoc.getPageCount())
  expect(memoDoc.getTitle()).toBe('Grade 6 Natural Sciences (memo)')

  // Saved on the device: a reload brings it all back.
  await expect(page.locator('#save-status')).toHaveText('Saved on this device.')
  await page.reload()
  await expect(page.locator('#sheet-title')).toHaveValue('Grade 6 Natural Sciences')
  await expect(page.locator('.activity')).toHaveCount(4)
  await expect(page.locator('#sheet-total')).toHaveText('19')
  await expect(page.locator('.activity[data-type="labelling"] .pin')).toHaveCount(2)
  await expect(page.locator('#print-part')).toHaveValue('memo')

  // Duplicate, then delete the copy.
  await page.locator('#duplicate-worksheet').click()
  await expect(page.locator('#worksheet-select option')).toHaveCount(2)
  await expect(page.locator('#sheet-title')).toHaveValue('Grade 6 Natural Sciences (copy)')
  await page.locator('#delete-worksheet').click()
  await expect(page.locator('#worksheet-select option')).toHaveCount(1)
  await expect(page.locator('#sheet-title')).toHaveValue('Grade 6 Natural Sciences')

  // A new, empty worksheet.
  await page.locator('#new-worksheet').click()
  await expect(page.locator('.activity')).toHaveCount(0)
  await expect(page.locator('#sheet-total')).toHaveText('0')
  await expect(page.locator('#worksheet-select option')).toHaveCount(2)

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(WORKSHEETS)
  await expect(page.locator('#preview-pages canvas').first()).toBeVisible()
  for (const type of ['Crossword', 'True or false', 'Label the diagram']) {
    await page.locator('#add-type').selectOption({ label: type })
    await page.locator('#add-activity').click()
  }
  await expect(page.locator('.activity')).toHaveCount(5)
  await noSidewaysScroll(page)
})
