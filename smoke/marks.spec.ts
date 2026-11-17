import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

const MARKS = '/red-pen/marks/'

// Made-up names only.
const PASTE = [
  ['Name', 'Test 1 (40)', 'Test 2 (50)'],
  ['Thandi Mokoena', '34', '41'],
  ['Sipho Dlamini', 'ABS', '28,5'],
  ['Ayesha Patel', '18', '20'],
  ['Lerato Khumalo', '30', 'sick'],
  ['Pieter van Wyk', '25', '45'],
  ['Naledi Nkosi', '12', '15/25'],
  ['Kagiso Molefe', '38', '47'],
]
  .map((r) => r.join('\t'))
  .join('\n')

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

function trackProblems(page: Page, baseURL: string): { foreign: string[]; errors: string[] } {
  const origin = new URL(baseURL).origin
  const foreign: string[] = []
  const errors: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) foreign.push(r.url())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return { foreign, errors }
}

test.beforeEach(async ({ page }) => {
  await page.goto(MARKS)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('pastes marks, corrects a cell, compares two assessments and exports the report and CSVs', async ({
  page,
  baseURL,
}) => {
  const { foreign, errors } = trackProblems(page, baseURL!)
  await page.locator('#marks-text').fill(PASTE)

  // Headings and names are detected.
  await expect(page.locator('#header-row')).toBeChecked()
  await expect(page.locator('#names-column')).toBeChecked()

  // A card per assessment, with its "out of" from the heading and its counts.
  const cards = page.locator('#cards .card')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0).locator('.card-counts')).toHaveText('6 marks, 1 absent')
  await expect(cards.nth(0).locator('input[type="number"]')).toHaveValue('40')
  await expect(cards.nth(1).locator('.card-counts')).toHaveText('6 marks, 0 absent, 1 unreadable')

  // Correct the unreadable cell in place.
  const fix = page.getByLabel('Correct Test 2, Lerato Khumalo')
  await expect(fix).toHaveValue('sick')
  await fix.fill('33')
  await fix.press('Enter')
  await expect(cards.nth(1).locator('.card-counts')).toHaveText('7 marks, 0 absent')
  await expect(page.locator('#marks-text')).toHaveValue(/Lerato Khumalo\t30\t33/)

  // Overview first: comparison table, small multiples, box plots, improved and dropped.
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#comparison-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.multiples svg')).toHaveCount(2)
  await expect(page.locator('#changes')).toContainText('Improved most')
  await expect(page.locator('#changes')).toContainText('1 learner with only one of the two left out')

  // A tab per assessment, with the headline figures and the learner lists.
  await page.getByRole('tab', { name: 'Test 1' }).click()
  // Test 1 as percentages: 85, 45, 75, 62.5, 30, 95 (Sipho absent).
  await expect(page.locator('.tile').first()).toContainText('65.4%')
  await expect(page.locator('.learner-list.support li')).toHaveCount(2)
  await expect(page.locator('.learner-list.support li').first()).toContainText('Naledi Nkosi')
  await expect(page.locator('.learner-list.top li').first()).toContainText('Kagiso Molefe')
  await expect(page.locator('svg.chart rect.c-bar-below, svg.chart rect.c-bar').first()).toBeVisible()

  // The pass mark is remembered in this browser; the marks are not.
  await page.locator('.segmented label', { hasText: '40%' }).click()
  await expect(page.locator('.learner-list.support li')).toHaveCount(1)
  const stored = await page.evaluate(() => Object.keys(localStorage))
  expect(stored).toEqual(['red-pen.marks.settings'])
  expect(await page.evaluate(() => localStorage.getItem('red-pen.marks.settings'))).not.toContain('Thandi')

  // Exports
  await page.locator('#report-class').fill('Grade 9B')
  await page.locator('#report-comments').fill('A solid improvement on the second test.')
  const report = await downloadFrom(page, () => page.locator('#download-report').click())
  expect(report.suggestedFilename()).toBe('Marks analysis Grade 9B.pdf')
  expect((await PDFDocument.load(await bytesOf(report))).getPageCount()).toBe(1)
  await page.locator('#report-names').check()
  const named = await downloadFrom(page, () => page.locator('#download-report').click())
  expect((await PDFDocument.load(await bytesOf(named))).getPageCount()).toBe(2)

  const summary = (await bytesOf(await downloadFrom(page, () => page.locator('#download-summary').click()))).toString(
    'utf8',
  )
  expect(summary.split('\r\n')[1]).toMatch(/^Test 1,40,6,1,0,65.4,/)
  const learners = (await bytesOf(await downloadFrom(page, () => page.locator('#download-learners').click()))).toString(
    'utf8',
  )
  expect(learners.split('\r\n')).toContain('3,Sipho Dlamini,ABS,57.0')

  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})

test('asks for an out of when marks are above 100, and assumes percentages otherwise', async ({ page }) => {
  await page.locator('#marks-text').fill('Exam\tQuiz\n120\t45\n88\t60\n140\t72')
  const cards = page.locator('#cards .card')
  await expect(cards.nth(0)).toContainText('Type what this is out of')
  await expect(cards.nth(1)).toContainText('Assumed percentages. Is this out of something else?')
  await cards.nth(0).locator('input[type="number"]').fill('150')
  await cards.nth(0).locator('input[type="number"]').press('Enter')
  await expect(cards.nth(0)).not.toContainText('Type what this is out of')
  await expect(page.getByRole('tab', { name: 'Exam' })).toBeVisible()
})

test('works at phone width with the sample marks', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.locator('#sample').click()
  await expect(page.locator('#cards .card')).toHaveCount(3)
  await expect(page.locator('.multiples svg')).toHaveCount(3)
  await noSidewaysScroll(page)
  await page.getByRole('tab', { name: 'Term 1 test' }).click()
  await expect(page.locator('.tiles')).toBeVisible()
  await noSidewaysScroll(page)
  await page.locator('.segmented label', { hasText: '10% bands' }).click()
  await expect(page.locator('.result-panel svg').first()).toBeVisible()
  await noSidewaysScroll(page)
})

test('takes percentages and names handed over from MCQ results', async ({ page }) => {
  await page.evaluate(() =>
    sessionStorage.setItem(
      'red-pen.marks.handoff',
      JSON.stringify({
        title: 'Fractions quiz',
        learners: [
          { name: 'Thandi Mokoena', percent: 100 },
          { name: 'Sipho Dlamini', percent: 83.33333 },
          { name: 'Lerato Khumalo', percent: 50 },
        ],
      }),
    ),
  )
  await page.reload()
  await expect(page.locator('#handoff-note')).toContainText('Fractions quiz')
  await expect(page.locator('#cards .card-name')).toHaveValue('Fractions quiz')
  await expect(page.locator('#cards .card-counts')).toHaveText('3 marks, 0 absent')
  await expect(page.locator('.tile').first()).toContainText('77.8%')
  // Read once: a reload does not bring the marks back.
  expect(await page.evaluate(() => sessionStorage.getItem('red-pen.marks.handoff'))).toBeNull()
})
