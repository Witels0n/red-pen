import { createCanvas } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { readSheet } from 'read-excel-file/node'
import { expect, test, type Download, type Page } from '@playwright/test'
import { drawMarks, rasterise, type Mark } from '../tests/omr/harness'
import { layoutSheet } from '../src/shared/omr/layout'
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
) {
  const geometry = layoutSheet({
    assessmentCode: 'ABCDEF',
    title: 'x',
    version: plan.version,
    identity: { mode: 'named-qr', learnerId: '01', idDigits: 2 },
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
  await page.keyboard.press('d')
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
