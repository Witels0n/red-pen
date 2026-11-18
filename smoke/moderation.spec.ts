import { expect, test, type Page } from '@playwright/test'
import { describePdf, download, expectNetworkBlocked, trackRequests } from './pdf-fixtures'

// The three moderation forms, end to end: details typed once carry from form to form, each
// downloads as a PDF of the right shape, and a form is saved in the browser and opened again.
const J1 = '/red-pen/j1/'
const J2 = '/red-pen/j2/'
const J3 = '/red-pen/j3/'

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
}

const key = (page: Page, name: string) => page.locator(`[data-key="${name}"]`)

test('J1: fills in the pre-moderation tool and downloads a one-page PDF, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await open(page, J1)
  await expect(page).toHaveTitle('Pre-assessment moderation tool (Annexure J1) to fill in · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('J1 Pre-moderation')
  await expect(page.locator('.criteria li')).toHaveCount(18)

  await key(page, 'school').fill('Parktown High School for Girls')
  await key(page, 'district').fill('Johannesburg North')
  await key(page, 'subject').fill('Information Technology')
  await key(page, 'ref').fill('Gr 10: Term 2 test')
  await key(page, 'c1.1').fill('All the details are on the cover page.')
  await page.locator('input[name="meets"][value="yes"]').check()
  await page.locator('input[name="decision"][value="conditional"]').check()
  await key(page, 'date').fill('2026-11-18')

  const file = await download(page, () => page.getByRole('button', { name: 'Download the PDF' }).click())
  expect(file.name).toBe('J1 Pre-moderation - Information Technology - Gr 10 Term 2 test.pdf')
  const shape = await describePdf(file.bytes)
  expect(shape.widths.map(Math.round)).toEqual([595])
  await expect(page.locator('#download-status')).toContainText('Downloaded J1 Pre-moderation')

  const blank = await download(page, () => page.getByRole('button', { name: 'Download a blank form' }).click())
  expect(blank.name).toBe('J1 Pre-moderation - blank.pdf')

  // Saved, then a new form keeps the school details and drops the rest.
  await page.locator('#save-name').fill('IT Gr 10 Term 2')
  await page.getByRole('button', { name: 'Save form' }).click()
  await page.getByRole('button', { name: 'Start a new form' }).click()
  await expect(key(page, 'school')).toHaveValue('Parktown High School for Girls')
  await expect(key(page, 'c1.1')).toHaveValue('')
  await expect(page.locator('input[name="meets"][value="yes"]')).not.toBeChecked()
  await page.locator('#saved-select').selectOption('IT Gr 10 Term 2')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(key(page, 'c1.1')).toHaveValue('All the details are on the cover page.')
  await expect(page.locator('input[name="decision"][value="conditional"]')).toBeChecked()

  // What was typed is still there after a reload.
  await page.reload()
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
  await expect(key(page, 'ref')).toHaveValue('Gr 10: Term 2 test')

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('J2 and J3 pick up the school details, and download in portrait and landscape', async ({ page }) => {
  await open(page, J1)
  await key(page, 'school').fill('Parktown High School for Girls')
  await key(page, 'subject').fill('Information Technology')

  await open(page, J2)
  await expect(page).toHaveTitle('Post assessment moderation tool (Annexure J2) to fill in · Red Pen')
  await expect(key(page, 'school')).toHaveValue('Parktown High School for Girls')
  await expect(page.locator('.criteria li')).toHaveCount(38)
  await key(page, 'grade').fill('11')
  await key(page, 'task').fill('Term 2 test')
  await key(page, 'c1.1').fill('The paper, the marking guideline and the grid are all there.')
  await key(page, 'p1.q').fill('3.2')
  await page.locator('input[name="level"][value="district"]').check()
  const j2 = await download(page, () => page.getByRole('button', { name: 'Download the PDF' }).click())
  expect(j2.name).toBe('J2 Post-moderation - Information Technology - Grade 11 - Term 2 test.pdf')
  const portrait = await describePdf(j2.bytes)
  expect(portrait.widths.map(Math.round)).toEqual([595, 595, 595])

  await open(page, J3)
  await expect(page).toHaveTitle('Evidence of school moderation (Annexure J3) to fill in · Red Pen')
  await expect(key(page, 'subject')).toHaveValue('Information Technology')
  await expect(key(page, 'grade')).toHaveValue('11')
  await key(page, 'year').fill('2026')
  await key(page, 'm1.task').fill('Task 1')
  await key(page, 'm1.l1').fill('Thandi Mokoena')
  await key(page, 'm1.t1').fill('41')
  await page.getByRole('button', { name: "Use the 1st moderation's learners for every task" }).click()
  await page.getByText('6th moderation').click()
  await expect(key(page, 'm6.l1')).toHaveValue('Thandi Mokoena')
  await expect(key(page, 'm6.t1')).toHaveValue('')
  const j3 = await download(page, () => page.getByRole('button', { name: 'Download the PDF' }).click())
  expect(j3.name).toBe('J3 Evidence of moderation - Information Technology - Grade 11 - 2026.pdf')
  const landscape = await describePdf(j3.bytes)
  expect(landscape.widths.map(Math.round)).toEqual([842])
})

test('the forms fit a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  for (const path of [J1, J2, J3]) {
    await open(page, path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, path).toBe(0)
  }
})
