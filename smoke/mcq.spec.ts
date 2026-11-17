import { createCanvas } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { readSheet } from 'read-excel-file/node'
import { expect, test, type Download, type Page } from '@playwright/test'
import { drawMarks, rasterise, type Mark } from '../tests/omr/harness'
import { layoutSheet } from '../src/shared/omr/layout'
import type { SheetIdentity } from '../src/shared/omr/types'
import type { Assessment, VersionPlan } from '../src/mcq/core/model'

// The whole MCQ flow in the browser on the production build: build an assessment, print sheets,
// fill the bubbles on the printed pages, scan them back in, review, and check every download.
const MCQ = '/red-pen/mcq/'
const CLASSES = '/red-pen/classes/'
const LEARNERS = ['Thandi Mokoena', 'Sipho Dlamini', 'Ayesha Patel', 'Lerato Khumalo']
const MEMO = 'ABCDABCDABCD'
const N = 12

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

/** Fills one printed page: `answers` are original options per original question (null blank, or a list for two circles). */
function fillPage(
  page: Awaited<ReturnType<typeof rasterise>>[number],
  plan: VersionPlan,
  answers: (number | number[] | null)[],
  seed: number,
  identity: SheetIdentity = { mode: 'named-qr', learnerId: '01', idDigits: 2 },
) {
  const geometry = layoutSheet({
    assessmentCode: 'ABCDEF',
    title: 'x',
    version: plan.version,
    identity,
    questions: plan.questionOrder.map(() => ({ options: 4 })),
  })[0]
  const marks: Mark[] = []
  geometry.questions.forEach((g) => {
    const original = plan.questionOrder[g.index]
    const a = answers[original]
    for (const option of a === null ? [] : Array.isArray(a) ? a : [a]) {
      marks.push({ bubble: g.bubbles[plan.optionOrder[g.index].indexOf(option)], kind: 'fill', darkness: 0.9 })
    }
  })
  return drawMarks(page, marks, seed)
}

async function png(image: { width: number; height: number; data: Uint8ClampedArray }): Promise<Buffer> {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  const data = ctx.createImageData(image.width, image.height)
  data.data.set(image.data)
  ctx.putImageData(data, 0, 0)
  return canvas.encode('png')
}

test('builds, prints, scans, reviews and returns an MCQ assessment', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  const foreign: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('request', (r) => {
    const url = r.url()
    if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== new URL(baseURL!).origin) {
      foreign.push(url)
    }
  })

  // A Class list, made on the Class lists page.
  await page.goto(CLASSES)
  await page.locator('#new-class').click()
  await page.locator('#new-name').fill('Grade 7B')
  await page.locator('#names-text').fill(LEARNERS.join('\n'))
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()

  // Build: 12 questions, two Topics, the Memo typed in, two Versions.
  await page.goto(MCQ)
  await expect(page).toHaveTitle('MCQ assessments · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('MCQ assessments')
  await page.locator('#new-assessment').click()
  await expect(page.locator('#step-build')).toBeVisible()
  await page.locator('#build-title').fill('Fractions and decimals')
  await page.locator('#question-count').fill(String(N))
  await page.locator('#question-count').press('Tab')
  await expect(page.locator('.q-row')).toHaveCount(N)
  await page.locator('.memo-input').first().click()
  await page.keyboard.type(MEMO)
  await expect(page.locator('#total-marks')).toContainText('Memo complete')
  for (let i = 0; i < N; i++) {
    await page.getByLabel(`Question ${i + 1} Topic`).fill(i < 6 ? 'Fractions' : 'Decimals')
  }
  await page.locator('#versions-details summary').click()
  await page.locator('label', { hasText: /^2$/ }).click()
  await expect(page.locator('.version-preview li')).toHaveCount(1)
  await page.locator('.q-row').first().getByRole('button', { name: 'Add text' }).click()
  await page.getByLabel('Question 1 text').fill('Which fraction is the biggest?')
  await expect(page.locator('#work-meta')).toContainText('12 questions · 2 Versions')
  await expect(page.locator('#save-state')).toHaveText('Saved on this device')

  // Print: named QR sheets from the Class list, two Versions in turns, one spare.
  await page.locator('#tab-print').click()
  await page.locator('#class-select').selectOption({ label: 'Grade 7B (4 learners)' })
  await page.locator('#spares').fill('1')
  await page.locator('#spares').press('Tab')
  await expect(page.locator('#print-summary')).toHaveText(
    '5 answer sheets (3 Version A, 2 Version B), including 1 spare. Each sheet is 1 page.',
  )
  await expect(page.locator('.sheet-preview')).toBeVisible()
  const sheetsPdf = await bytesOf(await downloadFrom(page, () => page.locator('#download-sheets').click()))
  const memoPdf = await bytesOf(await downloadFrom(page, () => page.locator('#download-memo').click()))
  expect((await PDFDocument.load(memoPdf)).getPageCount()).toBe(2)
  const booklet = await downloadFrom(page, () => page.locator('[data-version="B"]').click())
  expect(booklet.suggestedFilename()).toBe('Fractions and decimals questions Version B.pdf')
  const file = await downloadFrom(page, () => page.locator('#export-assessment').click())
  const assessment = JSON.parse((await bytesOf(file)).toString('utf8')).assessment as Assessment
  const [planA, planB] = assessment.versions.plans

  // Learners fill in their sheets: Thandi all right; Sipho wrong on Q1 and Q2; Ayesha leaves Q3
  // blank and fills two circles on Q12; Lerato lost her sheet and uses the spare, all Decimals wrong.
  const memo = [...MEMO].map((l) => 'ABCD'.indexOf(l))
  const wrong = (q: number) => (memo[q] + 1) % 4
  const sheets = [
    { plan: planA, answers: memo },
    { plan: planB, answers: memo.map((m, q) => (q < 2 ? wrong(q) : m)) },
    { plan: planA, answers: memo.map((m, q) => (q === 2 ? null : q === 11 ? [m, wrong(q)] : m)) },
    null, // Lerato's named sheet is not handed in
    { plan: planA, answers: memo.map((m, q) => (q >= 6 ? wrong(q) : m)) },
  ]
  const pages = await rasterise(new Uint8Array(sheetsPdf))
  expect(pages).toHaveLength(5)
  const filled = await Promise.all(
    sheets.map((s, i) => (s ? png(fillPage(pages[i], s.plan, s.answers, i + 1).image) : null)),
  )
  // Two sheets come from the copier as one PDF, the other two as phone photos.
  const copier = await PDFDocument.create()
  for (const image of [filled[0]!, filled[1]!]) {
    const embedded = await copier.embedPng(image)
    copier.addPage([595.28, 841.89]).drawImage(embedded, { x: 0, y: 0, width: 595.28, height: 841.89 })
  }

  // Mark
  await page.locator('#tab-mark').click()
  await expect(page.locator('.privacy-note.small')).toContainText('kept only while this page is open')
  await page.locator('#scan-input').setInputFiles([
    { name: 'copier.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await copier.save()) },
    { name: 'ayesha.png', mimeType: 'image/png', buffer: filled[2]! },
    { name: 'spare.png', mimeType: 'image/png', buffer: filled[4]! },
  ])
  await expect(page.locator('#read-progress')).toContainText('4 pages read', { timeout: 60_000 })
  await expect(page.locator('#pages-summary')).toHaveText('4 pages read, 3 learners marked, 2 to review.')
  await expect(page.locator('#review-badge')).toHaveText('2')

  // Review: give the spare to Lerato, then settle Ayesha's double answer with one key.
  await page.locator('#tab-review').click()
  await expect(page.locator('#review-left')).toHaveText('2 left to review')
  await expect(page.locator('#review-card h3')).toHaveText('Whose sheet?')
  await expect(page.locator('#review-card .crop-canvas')).toBeVisible()
  await page.getByLabel('Learner', { exact: true }).selectOption({ label: 'Lerato Khumalo (04)' })
  await page.locator('#review-card').getByRole('button', { name: 'Assign' }).click()
  await expect(page.locator('#review-left')).toHaveText('1 left to review')
  await expect(page.locator('#review-card h3')).toHaveText('Question 12, Version A')
  await expect(page.locator('#review-card .read-line')).toContainText('more than one circle')
  await expect(page.locator('#review-card .crop-canvas')).toBeVisible()
  // The letters in Review are as printed: Version A's options are shuffled too.
  await page.keyboard.press('abcd'[planA.optionOrder[11].indexOf(memo[11])])
  await expect(page.locator('#review-left')).toHaveText('Nothing left to review.')

  // Results
  await page.locator('#tab-results').click()
  const rows = await page
    .locator('#marksheet-table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => [...tr.children].slice(0, 5).map((c) => (c as HTMLElement).innerText.trim())))
  expect(rows).toEqual([
    ['Ayesha Patel', '03', 'A', '11 / 12', '92%'],
    ['Lerato Khumalo', '04', 'A', '6 / 12', '50%'],
    ['Sipho Dlamini', '02', 'B', '10 / 12', '83%'],
    ['Thandi Mokoena', '01', 'A', '12 / 12', '100%'],
  ])
  await expect(page.locator('.tile-value').first()).toHaveText('4')
  await expect(page.locator('.heatmap tbody tr')).toHaveCount(4)
  await expect(page.locator('#item-analysis tbody tr')).toHaveCount(N)
  await expect(page.locator('#topics tbody tr').first()).toContainText('Fractions')
  await expect(page.locator('#topics tbody tr').nth(1)).toContainText('Lerato Khumalo')

  const csv = (await bytesOf(await downloadFrom(page, () => page.locator('#download-csv').click()))).toString('utf8')
  const csvLines = csv.trim().split('\r\n')
  expect(csvLines[0]).toBe(
    'Learner ID,Name,Version,Total,Out of,Percentage,Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8,Q9,Q10,Q11,Q12,Fractions %,Decimals %,Note',
  )
  expect(csvLines).toContain('02,Sipho Dlamini,B,10,12,83,0,0,1,1,1,1,1,1,1,1,1,1,67,100,')
  const xlsx = await bytesOf(await downloadFrom(page, () => page.locator('#download-xlsx').click()))
  const sheet = await readSheet(xlsx, 'Marksheet')
  expect(sheet[0].slice(0, 4)).toEqual(['Learner ID', 'Name', 'Version', 'Total'])
  expect(sheet.find((r) => r[1] === 'Lerato Khumalo')?.slice(3, 6)).toEqual([6, 12, 50])

  // Memo correction: say Q1's answer is B. Sipho chose B there, Thandi chose A.
  await page.locator('.memo-correction summary').click()
  await page.getByLabel('Memo correction: question 1, A to D').click()
  await page.keyboard.type('B')
  await expect(page.locator('#marksheet-table tbody tr', { hasText: 'Sipho Dlamini' })).toContainText('11 / 12')
  await expect(page.locator('#marksheet-table tbody tr', { hasText: 'Thandi Mokoena' })).toContainText('11 / 12')
  await page.getByLabel('Memo correction: question 1, A to D').click()
  await page.keyboard.type('A')
  await expect(page.locator('#marksheet-table tbody tr', { hasText: 'Thandi Mokoena' })).toContainText('12 / 12')

  // Return
  await page.locator('#tab-return').click()
  const slips = await bytesOf(await downloadFrom(page, () => page.locator('#download-feedback').click()))
  expect((await PDFDocument.load(slips)).getPageCount()).toBe(2)
  const zip = await downloadFrom(page, () => page.locator('#download-marked').click())
  expect(zip.suggestedFilename()).toBe('Fractions and decimals marked sheets.zip')
  const files = unzipSync(new Uint8Array(await bytesOf(zip)))
  expect(Object.keys(files).sort()).toEqual(LEARNERS.map((n) => `${n} marked.pdf`).sort())
  expect((await PDFDocument.load(files['Thandi Mokoena marked.pdf'])).getPageCount()).toBe(1)

  // Results survive a reload (reads and decisions are saved; the scans are not).
  await page.reload()
  await page.locator('#tab-results').click()
  await expect(page.locator('#marksheet-table tbody tr')).toHaveCount(4)

  // Phone width: Review and Results fit without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#tab-review').click()
  await noSidewaysScroll(page)
  await page.locator('#tab-results').click()
  await noSidewaysScroll(page)
  await page.locator('#tab-build').click()
  await noSidewaysScroll(page)

  // "Analyse these marks" hands the percentages and names to Marks analysis.
  await page.locator('#tab-results').click()
  await page.locator('#analyse-marks').click()
  await expect(page).toHaveURL(/\/red-pen\/marks\/$/)
  await expect(page.locator('#cards .card-name')).toHaveValue('Fractions and decimals')
  await expect(page.locator('#cards .card-counts')).toHaveText('4 marks, 0 absent')
  await expect(page.locator('#marks-text')).toHaveValue(/Lerato Khumalo\t50%/)

  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})

test('lists, duplicates and deletes assessments, and refuses a broken Assessment file', async ({ page }) => {
  await page.goto(MCQ)
  await expect(page.locator('#no-assessments')).toBeVisible()
  await page.locator('#new-assessment').click()
  await expect(page.locator('#step-build')).toBeVisible()
  await page.locator('#build-title').fill('Term test')
  await expect(page.locator('#save-state')).toHaveText('Saved on this device')
  await page.locator('#work-view .back a').click()
  await expect(page.locator('.card')).toHaveCount(1)
  await page.locator('.card').getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.card')).toHaveCount(2)
  await expect(page.locator('.card-title').first()).toHaveText('Term test (copy)')
  await page.locator('.card').first().getByRole('button', { name: 'Delete' }).click()
  await page.locator('.confirm').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.card')).toHaveCount(1)

  await page.locator('#assessment-file-input').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"red-pen-mcq-assessment","schema":1,"assessment":{"questions":[]}}'),
  })
  await expect(page.locator('#home-error')).toContainText('This Assessment file has problems')
  await noSidewaysScroll(page)
})

const PASTED = ['Nomsa Zulu', 'Johan van Wyk', 'Priya Naidoo']
const SHARED_MEMO = 'ABCDABCD'

/** Eight questions with text and options, Memo ABCDABCD, and no topic column at all. */
function sharedCsv(): string {
  const rows = [...SHARED_MEMO].map(
    (answer, i) =>
      `${i + 1},Question ${i + 1}: which is it?,First ${i + 1},Second ${i + 1},Third ${i + 1},Fourth ${i + 1},${answer}`,
  )
  return ['number,question,A,B,C,D,answer', ...rows].join('\n')
}

test('one shared, shuffled paper for pasted names: printed, filled, marked, with names and no Topics', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  // Build: no Class list on this device. The questions come from a CSV without a topic column.
  await page.goto(MCQ)
  await page.locator('#new-assessment').click()
  await page.locator('#build-title').fill('Plants')
  await page.locator('#questions-csv-input').setInputFiles({
    name: 'plants.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(sharedCsv()),
  })
  await expect(page.locator('#questions-status')).toContainText('Imported 8 questions')
  await expect(page.locator('#work-meta')).toContainText('8 questions · One Version')
  await expect(page.locator('#total-marks')).toContainText('Memo complete')
  // The default: one shared paper with the options shuffled once.
  await expect(page.locator('#shuffle-shared')).toBeChecked()
  await expect(page.locator('#versions-details')).not.toHaveAttribute('open', '')
  const printedAs = await page.locator('.q-printed').allInnerTexts()
  expect(printedAs).toHaveLength(8)
  const printedLetters = printedAs.map((t) => t.replace('Printed as ', ''))
  expect(printedLetters.some((l, i) => l !== SHARED_MEMO[i])).toBe(true)
  await expect(page.locator('.mini.grow span').first()).toHaveText('Topic (optional)')
  await expect(page.locator('#save-state')).toHaveText('Saved on this device')

  // Print: "Who is writing?" defaults to pasted names when there are no Class lists.
  await page.locator('#tab-print').click()
  await expect(page.locator('input[name="learner-source"][value="pasted"]')).toBeChecked()
  await expect(page.locator('#print-summary')).toContainText('Paste the names')
  await page.locator('#paste-names').fill(PASTED.join('\n'))
  await expect(page.locator('#paste-summary')).toHaveText('3 learners, Learner IDs 1 to 3 (1 digit).')
  await page.locator('#use-names').click()
  await expect(page.locator('#learner-summary')).toContainText('In use: 3 learners')
  await page.locator('#spares').fill('0')
  await page.locator('#spares').press('Tab')
  await expect(page.locator('#print-summary')).toHaveText('3 answer sheets. Each sheet is 1 page.')
  const sheetsPdf = await bytesOf(await downloadFrom(page, () => page.locator('#download-sheets').click()))
  const memoPdf = await bytesOf(await downloadFrom(page, () => page.locator('#download-memo').click()))
  expect((await PDFDocument.load(memoPdf)).getPageCount()).toBe(1)
  const booklet = await downloadFrom(page, () => page.locator('[data-version="A"]').click())
  expect(booklet.suggestedFilename()).toBe('Plants questions.pdf')
  const file = await downloadFrom(page, () => page.locator('#export-assessment').click())
  const saved = JSON.parse((await bytesOf(file)).toString('utf8'))
  expect(saved.schema).toBe(2)
  const assessment = saved.assessment as Assessment
  expect(assessment.learnerList?.learners.map((l) => l.name)).toEqual(PASTED)
  const plan = assessment.versions.plans[0]
  // The printed letters in Build are the shared paper's: the Memo letters move, the entry order stays.
  const memo = [...SHARED_MEMO].map((l) => 'ABCD'.indexOf(l))
  expect(memo.map((m, q) => 'ABCD'[plan.optionOrder[q].indexOf(m)])).toEqual(printedLetters)

  // Save the pasted names as a Class list for next time.
  await page.locator('#save-class-name').fill('Grade 4A')
  await page.locator('#save-as-class').click()
  await expect(page.locator('#learners-panel .status')).toContainText('Saved as the Class list "Grade 4A"')

  // Nomsa answers everything right (as printed); Johan gets Q1 wrong; Priya fills the letters in
  // the teacher's entry order, so she is right only where the shuffle left the answer in place.
  const asTyped = memo.map((m, q) => plan.optionOrder[q][m])
  const sheets = [memo, memo.map((m, q) => (q === 0 ? (m + 1) % 4 : m)), asTyped]
  const pages = await rasterise(new Uint8Array(sheetsPdf))
  expect(pages).toHaveLength(3)
  const filled = await Promise.all(
    sheets.map((answers, i) =>
      png(fillPage(pages[i], plan, answers, i + 7, { mode: 'named-qr', learnerId: String(i + 1), idDigits: 1 }).image),
    ),
  )
  await page.locator('#tab-mark').click()
  await page
    .locator('#scan-input')
    .setInputFiles(filled.map((buffer, i) => ({ name: `sheet-${i + 1}.png`, mimeType: 'image/png', buffer })))
  await expect(page.locator('#read-progress')).toContainText('3 pages read', { timeout: 60_000 })
  await expect(page.locator('#pages-summary')).toContainText('3 learners marked')

  await page.locator('#tab-results').click()
  const priyaScore = asTyped.filter((a, q) => a === memo[q]).length
  expect(priyaScore).toBeLessThan(8)
  await expect(page.locator('#marksheet-table tbody tr')).toHaveCount(3)
  const rows = await page
    .locator('#marksheet-table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => [...tr.children].slice(0, 3).map((c) => (c as HTMLElement).innerText.trim())))
  expect(rows).toEqual([
    ['Johan van Wyk', '2', '7 / 8'],
    ['Nomsa Zulu', '1', '8 / 8'],
    ['Priya Naidoo', '3', `${priyaScore} / 8`],
  ])
  // No Topics: no Topic section, columns or jump link.
  await expect(page.locator('#topics')).toHaveCount(0)
  await expect(page.locator('.jump a', { hasText: 'Topics' })).toHaveCount(0)
  await expect(page.locator('#item-analysis thead th', { hasText: 'Topic' })).toHaveCount(0)
  await expect(page.locator('#item-analysis .help').first()).toContainText('in the order you entered them')
  const csv = (await bytesOf(await downloadFrom(page, () => page.locator('#download-csv').click()))).toString('utf8')
  expect(csv.split('\r\n')[0]).toBe('Learner ID,Name,Version,Total,Out of,Percentage,Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8,Note')
  await page.locator('#tab-return').click()
  await expect(page.locator('#step-return .help').first()).toContainText('Add Topics in Build')

  // The saved Class list is there for the next assessment.
  await page.goto(CLASSES)
  await expect(page.getByText('Grade 4A').first()).toBeVisible()
  expect(errors).toEqual([])
})

/** A plain picture of the given size, as PNG bytes. */
async function picture(width: number, height: number, colour: string): Promise<Buffer> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2)
  return canvas.encode('png')
}

/** The sizes of the images drawn on each page of a PDF. */
async function imageSizesPerPage(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) return []
    return xobjects.keys().flatMap((k) => {
      const obj = xobjects.lookup(k)
      if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) return []
      return [`${obj.dict.get(PDFName.of('Width'))}x${obj.dict.get(PDFName.of('Height'))}`]
    })
  })
}

test('adds pictures to questions and options, and the booklet PDF embeds them on the right pages', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(MCQ)
  await page.locator('#new-assessment').click()
  await page.locator('#build-title').fill('Animals')
  await page.locator('#question-count').fill('3')
  await page.locator('#question-count').press('Tab')
  await expect(page.locator('.q-row')).toHaveCount(3)
  await page.locator('.memo-input').first().click()
  await page.keyboard.type('ABC')

  // Answers only so far: the shared shuffle is off, and says why.
  await expect(page.locator('#shuffle-shared')).toBeDisabled()
  await expect(page.locator('#shuffle-help')).toContainText('no question text or picture yet')

  const sizes = [
    [960, 960],
    [900, 900],
  ]
  for (const [q, [w, h]] of sizes.entries()) {
    await page.locator('.q-row').nth(q).getByRole('button', { name: 'Add text or pictures' }).click()
    for (const [k, letter] of ['A', 'B', 'C', 'D'].entries()) {
      const slot = page.getByRole('group', {
        name: `Question ${q + 1} option ${letter} picture. Drop or paste a picture here.`,
      })
      await slot.locator('input[type="file"]').setInputFiles({
        name: `${letter}.png`,
        mimeType: 'image/png',
        buffer: await picture(w + k, h, ['#c33', '#3a3', '#33c', '#c93'][k]),
      })
      await expect(slot.locator('img.thumb')).toBeVisible()
    }
  }
  // Question 3: a picture in the stem, and option text only.
  await page.locator('.q-row').nth(2).getByRole('button', { name: 'Add text or pictures' }).click()
  await page.getByLabel('Question 3 text').fill('Which animal is in the picture?')
  const stem = page.getByRole('group', { name: 'Question 3 picture. Drop or paste a picture here.' })
  await stem.locator('input[type="file"]').setInputFiles({
    name: 'zebra.png',
    mimeType: 'image/png',
    buffer: await picture(800, 400, '#222'),
  })
  await expect(stem.locator('img.thumb')).toBeVisible()
  // Not a picture: refused with a sentence.
  await page
    .getByRole('group', { name: 'Question 3 option A picture. Drop or paste a picture here.' })
    .locator('input[type="file"]')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.locator('.q-row').nth(2).locator('.picture-status')).toContainText('is not a picture')
  // Remove and add back: the slot goes back to "Add picture".
  await page.getByRole('button', { name: 'Remove Question 1 option D picture' }).click()
  await expect(
    page.getByRole('group', { name: 'Question 1 option D picture. Drop or paste a picture here.' }).locator('img'),
  ).toHaveCount(0)
  await page
    .getByRole('group', { name: 'Question 1 option D picture. Drop or paste a picture here.' })
    .locator('input[type="file"]')
    .setInputFiles({ name: 'D.png', mimeType: 'image/png', buffer: await picture(963, 960, '#c93') })
  await expect(page.locator('img.thumb')).toHaveCount(9)

  // Pictures count as a question paper: the shared shuffle is on, with "Printed as" letters.
  await expect(page.locator('#shuffle-shared')).toBeEnabled()
  await expect(page.locator('#shuffle-shared')).toBeChecked()
  await expect(page.locator('.q-printed')).toHaveCount(3)
  await expect(page.locator('#csv-pictures-note')).toContainText('leaves out the pictures')
  await expect(page.locator('#save-state')).toHaveText('Saved on this device')

  // The pictures survive a reload (they are stored in the assessment).
  await page.reload()
  await page.locator('.q-row').first().getByRole('button', { name: 'Edit text and pictures' }).click()
  await expect(page.locator('.q-row').first().locator('img.thumb')).toHaveCount(4)

  await page.locator('#tab-print').click()
  const bytes = await bytesOf(await downloadFrom(page, () => page.locator('[data-version="A"]').click()))
  const perPage = await imageSizesPerPage(new Uint8Array(bytes))
  expect(perPage.length).toBeGreaterThan(1)
  const pageOf = (size: string) => perPage.findIndex((p) => p.includes(size))
  const q1 = ['960x960', '961x960', '962x960', '963x960'].map(pageOf)
  const q2 = ['900x900', '901x900', '902x900', '903x900'].map(pageOf)
  const q3 = pageOf('800x400')
  // Every picture is there, each question's pictures on one page, in question order.
  expect([...q1, ...q2, q3].every((p) => p >= 0)).toBe(true)
  expect(new Set(q1).size).toBe(1)
  expect(new Set(q2).size).toBe(1)
  expect(q1[0]).toBeLessThanOrEqual(q2[0])
  expect(q2[0]).toBeLessThanOrEqual(q3)
  expect(perPage.flat()).toHaveLength(9)
  expect(errors).toEqual([])
})

test('shows the "Who is writing?" choices in Print', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(MCQ)
  await page.locator('#new-assessment').click()
  await page.locator('#tab-print').click()
  await expect(page.locator('input[name="learner-source"]')).toHaveCount(4)
  await page.locator('#paste-names').fill(LEARNERS.join('\n'))
  await page.locator('#use-names').click()
  await expect(page.locator('#learner-summary')).toContainText('In use: 4 learners')

  // Numbers only, and Bubbled ID with no list at all.
  await page.locator('input[name="learner-source"][value="numbers"]').check()
  await page.locator('#learner-count').fill('31')
  await page.locator('#learner-count').press('Tab')
  await expect(page.locator('#learner-summary')).toContainText(
    '31 learners (no names), Learner IDs 01 to 31 (2 digits)',
  )
  await page.locator('input[name="identity-mode"][value="bubbled-id"]').check()
  await page.locator('input[name="learner-source"][value="none"]').check()
  await expect(page.locator('#id-digits')).toBeEnabled()
  await expect(page.locator('#print-summary')).toContainText('30 answer sheets')

  // Import a CSV: pick the columns, see the problems, then use the learners.
  await page.locator('input[name="identity-mode"][value="id-qr"]').check()
  await page.locator('input[name="learner-source"][value="imported"]').check()
  await page.locator('#learners-file').setInputFiles({
    name: 'grade 7b.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Learner ID,First name,Surname\n4,Thandi,Mokoena\n9,Sipho,Dlamini\n9,Ayesha,Patel\n'),
  })
  await expect(page.locator('#import-summary')).toContainText('1 row has a problem')
  await expect(page.locator('#use-imported')).toBeDisabled()
  await page.locator('input[name="learners-id-column"][value=""]').check()
  await expect(page.locator('#import-summary')).toHaveText('3 learners, Learner IDs 1 to 3 (1 digit).')
  await page.locator('#use-imported').click()
  await expect(page.locator('#learner-summary')).toContainText('In use: 3 learners')
  await expect(page.locator('#print-summary')).toContainText('5 answer sheets')
  await noSidewaysScroll(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await noSidewaysScroll(page)
})
