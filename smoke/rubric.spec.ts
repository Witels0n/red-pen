import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { download, expectNetworkBlocked, trackRequests } from './pdf-fixtures'

// Rubric builder, end to end: an analytic rubric with weights, levels from a scale and cognitive
// levels, the .xlsx with a sheet per learner and real formulas, the other three styles, and a
// saved rubric.
const RUBRIC = '/red-pen/rubric/'

async function ready(page: Page): Promise<void> {
  await page.goto(RUBRIC)
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

function unescapeXml(xml: string): string {
  return xml
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

const weights = (page: Page) =>
  page
    .locator('#criterion-list input[data-field="weight"]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value))

test('builds a weighted analytic rubric and downloads a workbook that marks itself, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await ready(page)
  await expect(page).toHaveTitle('Rubric maker with weights and Excel marking sheets · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Rubric builder')

  // It opens on a worked example with nothing wrong with it.
  await expect(page.locator('#title')).toHaveValue('Oral presentation')
  await expect(page.locator('#problems li')).toHaveCount(0)
  await expect(page.locator('#criterion-total')).toHaveText('Out of 20')
  await expect(page.locator('#grid thead th')).toHaveText([
    'Criterion',
    /^Advanced/,
    /^Proficient/,
    /^Developing/,
    /^Beginning/,
  ])
  await expect(page.locator('#grid tbody tr').first().locator('.band')).toHaveText(['8', '6', '4', '2'])

  // Weighting tools: scale to a total, switch to percentages, share evenly.
  await page.locator('#scale-total').fill('50')
  await page.getByRole('button', { name: 'Scale', exact: true }).click()
  expect(await weights(page)).toEqual(['20', '10', '10', '10'])
  await expect(page.locator('#criterion-total')).toHaveText('Out of 50')
  await page.getByLabel('Weigh in percentages').check()
  expect(await weights(page)).toEqual(['40', '20', '20', '20'])
  await expect(page.locator('#criterion-total')).toHaveText('Weights 100% ✓')
  await expect(page.locator('#criterion-list .derived').first()).toHaveText('= 20 marks')
  await page.locator('#criterion-list input[data-field="weight"]').first().fill('50')
  await expect(page.locator('#problems li')).toHaveText(['The weights add up to 110%, not 100%.'])
  await page.getByRole('button', { name: 'Share evenly' }).click()
  expect(await weights(page)).toEqual(['25', '25', '25', '25'])
  await page.getByLabel('Weigh in marks').check()
  expect(await weights(page)).toEqual(['12.5', '12.5', '12.5', '12.5'])

  // Cognitive levels, and the SOLO scale for the levels.
  await page.locator('#taxonomy').selectOption('bloom')
  await page.locator('#criterion-list select[data-field="cognitive"]').first().selectOption('Analyse')
  await expect(page.locator('#cognitive-summary span')).toHaveText(['Analyse 25%', 'No level 75%'])
  await page.locator('#scale-select').selectOption('solo')
  await page.getByRole('button', { name: 'Use these levels' }).click()
  await expect(page.locator('#grid thead th').nth(1)).toContainText('Extended abstract')
  await expect(page.locator('#problems li')).toHaveText(['4 descriptor boxes are still empty.'])
  // Descriptors already written stay with their position.
  await expect(page.locator('#grid tbody textarea').first()).toHaveValue(/^Accurate and detailed/)

  await page.getByLabel('Paste names').check()
  await page.locator('#names-text').fill("Thandi Mokoena\nSipho O'Brien\n")
  await expect(page.locator('#learner-summary')).toHaveText('2 learner sheets in the workbook.')
  await expect(page.locator('#file-summary')).toHaveText(
    'The file has the Rubric to print, a class Summary and Levels, 2 learner sheets to mark and Notes.',
  )

  const file = await download(page, () => page.getByRole('button', { name: 'Download Excel rubric' }).click())
  expect(file.name).toBe('Oral presentation rubric.xlsx')
  const zip = unzipSync(file.bytes)
  const workbook = unescapeXml(strFromU8(zip['xl/workbook.xml']!))
  for (const name of ['Rubric', 'Summary', 'Levels', '01 Thandi Mokoena', "02 Sipho O'Brien", 'Notes']) {
    expect(workbook).toContain(`name="${name}"`)
  }
  const learner = unescapeXml(strFromU8(zip['xl/worksheets/sheet4.xml']!))
  expect(learner).toContain('<f>IF(COUNT(M7:M10)<4,"",SUM(M7:M10))</f>')
  expect(learner).toContain('(D7<>"")*$B7*D$6')
  // Every sheet that prints as a page fits one page across.
  expect(learner).toContain('<pageSetUpPr fitToPage="1"/>')
  expect(learner).toContain('fitToWidth="1"')
  const summary = unescapeXml(strFromU8(zip['xl/worksheets/sheet2.xml']!))
  expect(summary).toContain("<f>IF('02 Sipho O''Brien'!B13=\"Marked\",'02 Sipho O''Brien'!M11,\"\")</f>")
  expect(summary).toContain("<f>COUNTIF('Levels'!C$3:C$4,$B18)</f>")
  await expect(page.locator('#download-status')).toHaveText('Downloaded Oral presentation rubric.xlsx with 6 sheets.')

  // Saved without learner names.
  await page.locator('#save-name').fill('Orals')
  await page.getByRole('button', { name: 'Save rubric' }).click()
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).toContain('Orals')
  expect(stored).not.toContain('Thandi')

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('the other three styles, a saved rubric, and a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await ready(page)
  await noSidewaysScroll(page)

  await page.getByLabel('Holistic').check()
  await expect(page.locator('#style-help')).toContainText('One scale for the whole piece of work')
  await page.getByRole('button', { name: 'Start a new rubric' }).click()
  await expect(page.locator('#title')).toHaveValue('Paragraph answer')
  await expect(page.locator('#grid tbody tr')).toHaveCount(4)
  await expect(page.locator('#grid tbody .band')).toHaveText(['10', '7.5', '5', '2.5'])
  await page.getByLabel('Give each level a band of marks').check()
  await expect(page.locator('#grid tbody .band')).toHaveText(['9-10', '6-8', '4-5', '0-3'])
  await page.locator('#save-name').fill('Paragraphs')
  await page.getByRole('button', { name: 'Save rubric' }).click()

  await page.getByLabel('Single-point').check()
  await page.getByRole('button', { name: 'Start a new rubric' }).click()
  await expect(page.locator('#grid tbody tr')).toHaveCount(3)
  await page.getByLabel('Give each criterion a mark').uncheck()
  await expect(page.locator('#criterion-total')).toHaveText('3 criteria')
  await expect(page.locator('#mark-options')).toBeHidden()

  await page.getByLabel('Checklist').check()
  await page.getByRole('button', { name: 'Start a new rubric' }).click()
  await expect(page.locator('#grid-panel')).toBeHidden()
  await expect(page.locator('#levels-block')).toBeHidden()
  await expect(page.locator('#criterion-total')).toHaveText('Out of 10')
  await page.getByRole('button', { name: 'Add an item' }).click()
  await expect(page.locator('#problems li.error-item')).toHaveText(['Item 6 needs a name.'])
  await expect(page.getByRole('button', { name: 'Download Excel rubric' })).toBeDisabled()
  await page.locator('#criterion-list li:last-child input[data-field="name"]').fill('Units are given')
  await expect(page.locator('#problems li')).toHaveCount(0)
  await noSidewaysScroll(page)

  // The rubric alone, without marking sheets.
  await page.getByLabel('Add a sheet per learner').uncheck()
  await expect(page.locator('#file-summary')).toHaveText('The file has one sheet: the rubric, ready to print.')
  const file = await download(page, () => page.locator('#download').click())
  expect(file.name).toBe('Practical write-up rubric.xlsx')
  const zip = unzipSync(file.bytes)
  expect(Object.keys(zip).filter((k) => k.startsWith('xl/worksheets/sheet'))).toHaveLength(1)

  // The work is still there after a reload, and the saved rubric loads back.
  await page.reload()
  await expect(page.locator('body[data-ready="true"]')).toBeAttached()
  await expect(page.locator('#title')).toHaveValue('Practical write-up')
  await page.locator('#saved-select').selectOption('Paragraphs')
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(page.locator('#title')).toHaveValue('Paragraph answer')
  await expect(page.getByLabel('Give each level a band of marks')).toBeChecked()
})
