import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { download, expectNetworkBlocked, trackRequests } from './pdf-fixtures'

// Markbook builder, end to end: learners from a Class list, a preset layout, the preview with its
// sample maths and formulas, a weights warning, the .xlsx download with real formulas, and a saved design.
const MARKBOOK = '/red-pen/markbook/'
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

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

function unescapeXml(xml: string): string {
  return xml.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

test('builds a markbook from a Class list and downloads live formulas, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await makeClass(page, 'Grade 10B', LEARNERS)

  await page.goto(MARKBOOK)
  await expect(page).toHaveTitle('Excel markbook template with CAPS levels · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Markbook builder')
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
  // A Class list on the device is chosen by default.
  await expect(page.locator('input[name="source"][value="class"]')).toBeChecked()
  await expect(page.locator('#class-select option:checked')).toHaveText('Grade 10B (3 learners)')
  await expect(page.locator('#learner-summary')).toHaveText('3 learner rows in the markbook.')

  await page.locator('#preset-select').selectOption('term')
  await page.getByRole('button', { name: 'Use this layout' }).click()
  await expect(page.locator('#title')).toHaveValue('Term 1 markbook')
  await expect(page.locator('#category-total')).toHaveText('Total 100% ✓')
  await expect(page.locator('#problems li')).toHaveCount(0)

  // The preview: headings, sample results and the summary at the real row numbers.
  const head = page.locator('#preview tr.head td')
  await expect(head.first()).toHaveText('Learner ID')
  await expect(head).toContainText(['Test 1', 'Test 1 (%)', 'Tests (%)', 'Term mark (%)', 'Rounded (%)', 'Level'])
  await expect(page.locator('#preview tr.summary th')).toHaveText(['8', '9', '10', '11', '12'])
  await expect(page.locator('#preview td.absent')).toHaveText(['a'])
  await expect(page.locator('#preview-caption')).toContainText('absent learner (a)')
  await page.getByLabel('Show formulas').check()
  await expect(page.locator('#preview')).toContainText('=IF(ISNUMBER(C4),C4/C$2*100,"")')
  await expect(page.locator('#preview')).toContainText('=IFERROR(AVERAGE(D4:D6),"")')
  await page.getByLabel('Show formulas').uncheck()

  // Weights that do not add up are flagged, but the sheet still works.
  const testsWeight = page.locator('#category-list li').first().getByLabel('Weight (%)')
  await testsWeight.fill('30')
  await expect(page.locator('#category-total')).toHaveText('Total 90%, should be 100%')
  await expect(page.locator('#problems li')).toHaveText(['The Category weights add up to 90%, not 100%.'])
  await testsWeight.fill('40')
  await expect(page.locator('#problems li')).toHaveCount(0)

  // An assessment needs a name before the download.
  await page.getByRole('button', { name: 'Add an assessment' }).click()
  await expect(page.locator('#assessment-list li')).toHaveCount(5)
  const added = page.locator('#assessment-list li').last()
  await added.getByLabel('Assessment').fill('')
  await expect(page.locator('#problems li.error-item')).toHaveText(['Assessment 5 needs a name.'])
  await expect(page.locator('#download')).toBeDisabled()
  await added.getByRole('button', { name: /^Remove/ }).click()
  await expect(page.locator('#download')).toBeEnabled()

  await page.getByLabel('Pass mark (%)').fill('40')
  const file = await download(page, () => page.getByRole('button', { name: 'Download Excel markbook' }).click())
  expect(file.name).toBe('Term 1 markbook.xlsx')
  const zip = unzipSync(new Uint8Array(file.bytes))
  const sheet = unescapeXml(strFromU8(zip['xl/worksheets/sheet1.xml']))
  const strings = unescapeXml(strFromU8(zip['xl/sharedStrings.xml']))
  for (const name of LEARNERS) expect(strings).toContain(name)
  expect(strings).toContain('Out of')
  expect(sheet).toContain('<f>IF(ISNUMBER(C4),C4/C$2*100,"")</f>')
  expect(sheet).toContain(
    '<f>IFERROR((IF(ISNUMBER(G6),G6*G$3,0)+IF(ISNUMBER(J6),J6*J$3,0)+IF(ISNUMBER(M6),M6*M$3,0))/(IF(ISNUMBER(G6),G$3,0)+IF(ISNUMBER(J6),J$3,0)+IF(ISNUMBER(M6),M$3,0)),"")</f>',
  )
  expect(sheet).toContain('<f>IF(ISNUMBER(N4),IF(N4>=40,"Pass","Fail"),"")</f>')
  expect(sheet).toContain('<f>IFERROR(LOOKUP(N5,{0,30,40,50,60,70,80},{1,2,3,4,5,6,7}),"")</f>')
  expect(sheet).toContain('<f>IFERROR(AVERAGE(N4:N6),"")</f>')
  const pane = sheet.match(/<pane [^>]*>/)?.[0] ?? ''
  for (const attr of ['ySplit="3"', 'xSplit="2"', 'state="frozen"']) expect(pane).toContain(attr)
  expect(sheet).toMatch(/<col [^>]*width="28"/)
  expect(Object.keys(zip)).toContain('xl/worksheets/sheet2.xml')

  // Save the design, start again and load it back. No learner names are stored.
  await page.locator('#save-name').fill('Grade 10 term')
  await page.getByRole('button', { name: 'Save design' }).click()
  await expect(page.locator('#download-status')).toHaveText('Saved the design as Grade 10 term.')
  await page.locator('#preset-select').selectOption('blank')
  await page.getByRole('button', { name: 'Use this layout' }).click()
  await expect(page.locator('#assessment-list li')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('#assessment-list li')).toHaveCount(1)
  await page.locator('#saved-select').selectOption('Grade 10 term')
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(page.locator('#assessment-list li')).toHaveCount(4)
  await expect(page.getByLabel('Pass mark (%)')).toHaveValue('40')
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).toContain('Grade 10 term')
  for (const name of LEARNERS) expect(stored).not.toContain(name)

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('pasted names and blank rows, on a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(MARKBOOK)
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
  await expect(page.getByLabel('Blank rows')).toBeChecked()
  await page.locator('#preset-select').selectOption('caps-fet')
  await page.getByRole('button', { name: 'Use this layout' }).click()
  await expect(page.locator('#learner-summary')).toHaveText('40 learner rows in the markbook.')
  await expect(page.locator('#preview tr.gap')).toContainText('35 more learner rows in the download')
  await noSidewaysScroll(page)
  // The sheet scrolls inside its own box.
  const box = page.locator('.sheet-scroll')
  const scrolls = await box.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrolls).toBe(true)

  await page.getByLabel('Paste names').check()
  await page.locator('#names-text').fill('Lerato Nkosi\n\nJohan van Wyk\n')
  await expect(page.locator('#learner-summary')).toHaveText('2 learner rows in the markbook.')
  await page.getByLabel('Group assessments into Categories').uncheck()
  await expect(page.locator('#categories-block')).toBeHidden()
  await expect(page.locator('#problems li')).toHaveText(['The assessment weights add up to 200%, not 100%.'])
  await noSidewaysScroll(page)

  const file = await download(page, () => page.locator('#download').click())
  expect(file.name).toBe('Grade 12 markbook.xlsx')
  const strings = strFromU8(unzipSync(new Uint8Array(file.bytes))['xl/sharedStrings.xml'])
  expect(strings).toContain('Johan van Wyk')
  expect(strings).toContain('No.')
})
