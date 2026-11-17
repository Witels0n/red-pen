import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { download, expectNetworkBlocked, trackRequests } from './pdf-fixtures'

// Certificates and labels, end to end: certificates from a Class list (one PDF and a zip per
// learner), then labels and award slips from pasted rows with an extra merge field.
const PAGE = '/red-pen/certificates/'
const CLASSES = '/red-pen/classes/'
const LEARNERS = ['Thandi Mokoena', 'Sipho Dlamini', 'Ayesha Patel']

async function makeClass(page: Page, name: string, names: string[]): Promise<void> {
  await page.goto(CLASSES)
  await page.locator('#new-class').click()
  await page.locator('#new-name').fill(name)
  await page.locator('#names-text').fill(names.join('\n'))
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-title')).toHaveText(name)
}

async function pageSizes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`)
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

test('makes certificates from a Class list and labels from pasted rows, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const outside = trackRequests(page, baseURL!)
  await makeClass(page, 'Grade 8A', LEARNERS)

  await page.goto(PAGE)
  await expect(page).toHaveTitle('Certificates and labels · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Certificates and labels')
  await expect(page.locator('#class-select option:checked')).toHaveText('Grade 8A (3 learners)')
  await expect(page.locator('#source-summary')).toHaveText('3 learners, 3 pages.')
  await expect(page.locator('#field-chips .chip')).toHaveText(['{Name}', '{Learner ID}', '{Class}', '{Date}'])

  // Certificates: wording, a merge field from the chips, a signature line.
  await page.locator('#c-title').fill('Certificate of Merit')
  await page.locator('#c-body').fill('for hard work in ')
  await page.locator('#field-chips .chip', { hasText: '{Class}' }).click()
  await expect(page.locator('#c-body')).toHaveValue('for hard work in {Class}')
  await page.locator('#c-sig1-name').fill('Ms N. Dube')
  await page.getByLabel('Modern').check()
  await expect(page.locator('#preview-canvas[data-rendered="true"]')).toBeVisible()
  await expect(page.locator('#preview-caption')).toHaveText('First page: Thandi Mokoena.')
  await expect(page.locator('#warnings')).toBeHidden()

  const pdf = await download(page, () => page.getByRole('button', { name: 'Download PDF (3 learners)' }).click())
  expect(pdf.name).toBe('Grade 8A certificates.pdf')
  expect(await pageSizes(new Uint8Array(pdf.bytes))).toEqual(['842x595', '842x595', '842x595'])

  await page.getByLabel('Portrait').check()
  const zip = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(zip.name).toBe('Grade 8A certificates.zip')
  const files = unzipSync(new Uint8Array(zip.bytes))
  expect(Object.keys(files)).toEqual(LEARNERS.map((n) => `${n}.pdf`))
  expect(await pageSizes(files['Thandi Mokoena.pdf'])).toEqual(['595x842'])
  await expectNetworkBlocked(page)

  // Pasted rows with an Award column, one of them blank.
  await page.getByLabel('Paste names').check()
  await page.locator('#paste-text').fill('Name\tAward\nLwazi Khumalo\tTop reader\nMia van Wyk\t\n')
  await expect(page.locator('#source-summary')).toHaveText('2 learners, 2 pages.')
  await expect(page.locator('#field-chips .chip', { hasText: '{Award}' })).toBeVisible()
  await page.locator('#c-body').fill('for {Award} and {Awrd}')
  await expect(page.locator('#warnings li')).toHaveText([
    /No column is called \{Awrd\}/,
    '1 learner has no Award; it is left out on theirs.',
  ])
  await expect(page.locator('#preview-caption')).toHaveText('First page: Lwazi Khumalo.')

  // Name labels on a 3 x 7 sheet, two copies each, after 20 used labels: two sheets.
  await page.getByRole('radio', { name: /^Name labels/ }).check()
  await expect(page.locator('#sheet-preset')).toHaveValue('3x7')
  await page.getByLabel('Labels already used').fill('20')
  await page.getByLabel('Copies per learner').fill('2')
  await expect(page.locator('#source-summary')).toHaveText('2 learners, 2 pages.')
  await expect(page.locator('#download-zip')).toBeHidden()
  const labels = await download(page, () => page.getByRole('button', { name: 'Download PDF (2 learners)' }).click())
  expect(labels.name).toBe('learners name labels.pdf')
  expect(await pageSizes(new Uint8Array(labels.bytes))).toEqual(['595x842', '595x842'])

  // A custom sheet that runs off the page cannot be printed.
  await page.locator('#grid-details summary').click()
  await page.getByLabel('Across', { exact: true }).fill('5')
  await expect(page.locator('#sheet-preset')).toHaveValue('custom')
  await expect(page.locator('#layout-error')).toContainText('off the right of the sheet')
  await expect(page.locator('#download')).toBeDisabled()

  // Award slips: four per page.
  await page.getByRole('radio', { name: /^Award slips/ }).check()
  await expect(page.locator('#download')).toBeEnabled()
  const slips = await download(page, () => page.locator('#download').click())
  expect(slips.name).toBe('learners award slips.pdf')
  expect(await pageSizes(new Uint8Array(slips.bytes))).toEqual(['595x842'])

  // Settings are remembered, names are not.
  await page.reload()
  await expect(page.locator('input[name="product"][value="slips"]')).toBeChecked()
  await expect(page.locator('#paste-text')).toHaveValue('')
  await expect(page.locator('#c-title')).toHaveValue('Certificate of Merit')

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(PAGE)
  await expect(page.getByLabel('Paste names')).toBeChecked()
  await page.locator('#paste-text').fill('Bartholomew Montgomery-Featherstonehaugh\nZoë du Plessis')
  await expect(page.locator('#preview-canvas[data-rendered="true"]')).toBeVisible()
  await noSidewaysScroll(page)
  await page.getByRole('radio', { name: /^Book labels/ }).check()
  await page.locator('#grid-details summary').click()
  await noSidewaysScroll(page)
  const book = await download(page, () => page.locator('#download').click())
  expect(await pageSizes(new Uint8Array(book.bytes))).toEqual(['595x842'])
})
