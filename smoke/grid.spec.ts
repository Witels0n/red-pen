import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { readSheet } from 'read-excel-file/node'

const GRID = '/red-pen/grid/'

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync((await download.path())!)
}

async function downloadFrom(page: Page, click: () => Promise<void>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()])
  return download
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

function levelRow(page: Page, n: number) {
  return page.locator('#level-summary tbody tr').nth(n - 1)
}

test('builds a grid, checks it against targets and exports it', async ({ page }) => {
  await page.goto(GRID)
  await expect(page).toHaveTitle('Question paper analysis grid (CAPS) · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Question paper grid')
  await expect(page.locator('#no-grids')).toBeVisible()

  await page.locator('#new-grid').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  await page.locator('#d-subject').fill('Mathematics')
  await page.locator('#d-grade').fill('10')
  await page.locator('#d-paper').fill('Paper 1')
  await page.locator('#d-examiner').fill('T. Mokoena')
  await page.locator('#d-total').fill('22')
  await expect(page.locator('#edit-title')).toHaveText('Mathematics Grade 10 Paper 1')

  // Rows pasted from a spreadsheet, header row included.
  await page.locator('.paste-box summary').click()
  await page
    .locator('#paste-text')
    .fill('No.\tMarks\tLevel\tTopic\n1.1\t3\t1\tAlgebra\n1.2\t5\tRoutine\tAlgebra\n2\t12\tL3\tGeometry')
  await page.locator('#paste-add').click()
  await expect(page.locator('#paste-status')).toHaveText('Added 3 rows.')
  await expect(page.locator('#question-table tbody tr[data-id]')).toHaveCount(3)
  await expect(page.locator('tr[data-section="1"] .subtotal-value')).toHaveText('8 marks')
  await expect(page.locator('#total-line')).toHaveText('20 of 22 marks')
  await expect(page.locator('#warnings')).toContainText('2 short of the paper total of 22')

  // Keyboard entry: Enter on the last row adds the next question.
  const lastMarks = page.locator('#question-table tbody tr[data-id]').last().locator('[data-col="marks"]')
  await lastMarks.press('Enter')
  const newRow = page.locator('#question-table tbody tr[data-id]').last()
  await expect(newRow.locator('[data-col="number"]')).toHaveValue('3')
  await expect(newRow.locator('[data-col="marks"]')).toBeFocused()
  await page.keyboard.type('2')
  await newRow.locator('[data-col="level"]').selectOption({ label: '4: Problem solving' })
  await newRow.locator('[data-col="topic"]').fill('Geometry')
  await expect(page.locator('#total-line')).toHaveText('22 of 22 marks')
  await expect(page.locator('#warnings')).not.toContainText('short')

  // Levels against the CAPS targets 30/40/20/10 with a 5 point tolerance.
  await expect(levelRow(page, 1)).toContainText('13.6%')
  await expect(levelRow(page, 1)).toContainText('Under by 16.4 pts')
  await expect(levelRow(page, 3)).toContainText('Over by 34.5 pts')
  await expect(levelRow(page, 4)).toContainText('On target')
  await expect(page.locator('#level-chart svg rect.chart-bar')).toHaveCount(4)
  await expect(page.locator('#topic-summary tbody tr')).toHaveCount(2)
  await expect(page.locator('#matrix tbody tr.total')).toContainText('8')

  // A teacher's own target is remembered for the next grid.
  await page.getByLabel('Target percentage for level 1, Knowledge').fill('20')
  await page.getByLabel('Target percentage for level 3, Complex procedures').fill('30')
  await expect(page.locator('#level-sum')).toHaveText('Targets add up to 100%.')

  const pdf = await bytesOf(await downloadFrom(page, () => page.locator('#download-pdf').click()))
  const doc = await PDFDocument.load(pdf)
  expect(doc.getPageCount()).toBe(1)
  expect(doc.getTitle()).toContain('Mathematics Grade 10 Paper 1')

  const xlsx = await downloadFrom(page, () => page.locator('#download-xlsx').click())
  expect(xlsx.suggestedFilename()).toBe('Mathematics Grade 10 Paper 1 grid.xlsx')
  const sheet = await readSheet(await bytesOf(xlsx), 'Questions')
  const header = sheet.findIndex((r) => r[0] === 'Number')
  expect(sheet[header + 1].slice(0, 4)).toEqual(['1.1', 3, '1: Knowledge', 'Algebra'])
  expect(sheet.slice(header + 1)).toHaveLength(4)

  // Saved on the device: back to the list, duplicate, and the new grid starts with my targets.
  await page.locator('.back a').click()
  await expect(page.locator('.grid-card')).toHaveCount(1)
  await expect(page.locator('.grid-card .meta')).toContainText('22 of 22 marks')
  await page.getByRole('button', { name: 'Duplicate Mathematics Grade 10 Paper 1' }).click()
  await expect(page.locator('.grid-card')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.grid-card')).toHaveCount(2)

  await page.locator('#new-grid').click()
  await expect(page.getByLabel('Target percentage for level 1, Knowledge')).toHaveValue('20')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(GRID)
  await noSidewaysScroll(page)
  await page.locator('#new-grid').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  await page.locator('#show-extra').check()
  await page.locator('.paste-box summary').click()
  await page.locator('#paste-text').fill('1.1\t3\t1\tA very long topic name about functions and graphs\t\tEasy\tA note')
  await page.locator('#paste-add').click()
  await noSidewaysScroll(page)
})
