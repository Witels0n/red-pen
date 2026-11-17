import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import jsQR from 'jsqr'
import { PDFDocument } from 'pdf-lib'
import { decodeSheetQr } from '../src/shared/omr/qr-payload'
import { rasterise } from '../tests/omr/harness'
import { describePdf, download, expectNetworkBlocked, trackRequests, type FixtureFile } from './pdf-fixtures'

// Cover sheets, end to end: print them from a Class list, staple them (in a PDF) on top of tests of
// different lengths, scan the batch, and split it at the Cover sheets in Split a PDF.
const COVERS = '/red-pen/covers/'
const CLASSES = '/red-pen/classes/'
const SPLIT = '/red-pen/split/'
const LEARNERS = ['Thandi Mokoena', 'Sipho Dlamini', 'Ayesha Patel']
/** A4 width in points, rounded: how a Cover sheet shows up in describePdf. */
const COVER = 595

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

/** The text of the QR code on each page, read from a 200 dpi rendering. */
async function qrTexts(pdf: Uint8Array): Promise<string[]> {
  return (await rasterise(pdf)).map(({ image }) => jsQR(image.data, image.width, image.height)?.data ?? '')
}

/**
 * A batch scan: two stray pages, then each learner's Cover sheet on top of their test.
 * Test pages are told apart by their width (101, 102, ...).
 */
async function batchScan(covers: Uint8Array): Promise<FixtureFile> {
  const source = await PDFDocument.load(covers)
  const doc = await PDFDocument.create()
  const [c1, c2, c3] = await doc.copyPages(source, [0, 1, 2])
  const test = (width: number) => {
    const p = doc.addPage([width, 500])
    p.drawRectangle({ x: 10, y: 10, width: width / 2, height: 100 })
  }
  test(101)
  test(102)
  doc.addPage(c1)
  test(103)
  test(104)
  test(105)
  doc.addPage(c2)
  test(106)
  doc.addPage(c3)
  test(107)
  test(108)
  return { name: 'Grade 8A batch.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

async function unzip(bytes: Buffer): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {}
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(bytes))))
    out[name] = (await describePdf(data)).widths
  return out
}

test('prints Cover sheets from a Class list and splits a batch scan at them, with nothing sent anywhere', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const outside = trackRequests(page, baseURL!)
  await makeClass(page, 'Grade 8A', LEARNERS)

  // Print
  await page.goto(COVERS)
  await expect(page).toHaveTitle('Cover sheets · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Cover sheets')
  await expect(page.locator('.intro.paper h1')).toHaveText('Cover sheets')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await expect(page.locator('.steps li')).toHaveCount(4)
  await expect(page.locator('.steps')).toContainText('At cover sheets')
  await expect(page.locator('#class-select option:checked')).toHaveText('Grade 8A (3 learners)')
  await expect(page.locator('#class-summary')).toHaveText('3 learners, one page each.')
  await page.locator('#test-title').fill('Term 3 test')
  await page.locator('#subject').fill('Natural Sciences')
  await expect(page.locator('#preview-canvas[data-rendered="true"]')).toBeVisible()
  await expect(page.locator('#preview-caption')).toHaveText('First page: Learner ID 01, Thandi Mokoena.')

  const printed = await download(page, () => page.getByRole('button', { name: 'Download 3 Cover sheets' }).click())
  expect(printed.name).toBe('Grade 8A cover sheets.pdf')
  const covers = new Uint8Array(printed.bytes)
  expect((await PDFDocument.load(covers)).getPageCount()).toBe(3)
  const texts = await qrTexts(covers)
  expect(texts).toEqual(['RP1|COVER|-|01|1/1', 'RP1|COVER|-|02|1/1', 'RP1|COVER|-|03|1/1'])
  expect(texts.map((t) => decodeSheetQr(t))).toEqual(
    ['01', '02', '03'].map((learnerId) => ({ kind: 'cover', learnerId })),
  )
  await expectNetworkBlocked(page)

  // Split
  await page.goto(SPLIT)
  await page.locator('#file-input').setInputFiles([await batchScan(covers)])
  await expect(page.locator('#summary')).toHaveText('Grade 8A batch.pdf, 11 pages')
  await page.getByLabel('At cover sheets').check()
  await expect(page.locator('#cover-status')).toHaveText('Found 3 Cover sheets in 11 pages.', { timeout: 60_000 })
  // The class whose Learner IDs match is chosen for the names.
  await expect(page.locator('#cover-class option:checked')).toHaveText('Grade 8A (3 learners)')
  await expect(page.locator('#preview li .part-name')).toHaveText([
    'unassigned.pdf',
    'Thandi Mokoena.pdf',
    'Sipho Dlamini.pdf',
    'Ayesha Patel.pdf',
  ])
  await expect(page.locator('#preview li .part-range')).toHaveText([
    'Pages 1-2',
    'Pages 3-6',
    'Pages 7-8',
    'Pages 9-11',
  ])
  await expect(page.locator('#preview li.unassigned .part-flag')).toHaveText('Unassigned')
  await expect(page.locator('#preview li .part-id')).toHaveText(['Learner ID 01', 'Learner ID 02', 'Learner ID 03'])
  await expect(page.locator('#plan-warnings li')).toHaveText([/^Pages 1-2 come before the first Cover sheet/])
  await expect(page.locator('#preview-count')).toHaveText('4 PDFs in Grade 8A batch-split.zip')

  const zipped = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(zipped.name).toBe('Grade 8A batch-split.zip')
  expect(await unzip(zipped.bytes)).toEqual({
    'unassigned.pdf': [101, 102],
    'Thandi Mokoena.pdf': [COVER, 103, 104, 105],
    'Sipho Dlamini.pdf': [COVER, 106],
    'Ayesha Patel.pdf': [COVER, 107, 108],
  })

  // Covers left out, and names by Learner ID when no class is chosen.
  await page.getByLabel('Leave the Cover sheets out of the files').check()
  await page.getByLabel('Names from').selectOption({ label: 'None: name the files by Learner ID' })
  await expect(page.locator('#preview li .part-range')).toHaveText(['Pages 1-2', 'Pages 4-6', 'Page 8', 'Pages 10-11'])
  const ids = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(await unzip(ids.bytes)).toEqual({
    'unassigned.pdf': [101, 102],
    'learner-01.pdf': [103, 104, 105],
    'learner-02.pdf': [106],
    'learner-03.pdf': [107, 108],
  })

  // Other modes still work on the same PDF.
  await page.getByLabel('One file per page').check()
  await expect(page.locator('#cover-options')).toBeHidden()
  await expect(page.locator('#preview li')).toHaveCount(11)
  await expect(page.locator('#plan-warnings')).toBeHidden()

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('a PDF without Cover sheets says so and offers no download', async ({ page }) => {
  await page.goto(SPLIT)
  const doc = await PDFDocument.create()
  for (const w of [101, 102, 103]) doc.addPage([w, 500])
  await page
    .locator('#file-input')
    .setInputFiles([{ name: 'plain.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }])
  await page.getByLabel('At cover sheets').check()
  await expect(page.locator('#plan-error')).toContainText('No Cover sheets were found in this PDF.', {
    timeout: 30_000,
  })
  await expect(page.locator('#download')).toBeDisabled()
  await expect(page.locator('#cover-no-classes')).toBeVisible()
})

test('the search for Cover sheets can be stopped and started again', async ({ page }) => {
  test.setTimeout(120_000)
  const doc = await PDFDocument.create()
  for (let i = 0; i < 40; i++) doc.addPage([400, 560])
  await page.goto(SPLIT)
  await page
    .locator('#file-input')
    .setInputFiles([{ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }])
  await page.getByLabel('At cover sheets').check()
  await expect(page.locator('#cover-status')).toContainText('Looking for Cover sheets')
  await expect(page.locator('#download')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('#cover-status')).toHaveText('Stopped before every page was checked.')
  await expect(page.locator('#cover-progress')).toBeHidden()
  await page.getByRole('button', { name: 'Look again' }).click()
  await expect(page.locator('#plan-error')).toContainText('No Cover sheets were found', { timeout: 90_000 })
})

test('without a Class list, the page points to Class lists', async ({ page }) => {
  await page.goto(COVERS)
  await expect(page.locator('#no-classes')).toBeVisible()
  await expect(page.locator('#covers-form')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Go to Class lists' })).toHaveAttribute('href', '../classes/#new')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await makeClass(page, 'Grade 9 with a rather long class name for a small screen', LEARNERS)
  await page.goto(COVERS)
  await expect(page.locator('#preview-canvas[data-rendered="true"]')).toBeVisible()
  await noSidewaysScroll(page)

  const covers = await download(page, () => page.locator('#download').click())
  await page.goto(SPLIT)
  await page.locator('#file-input').setInputFiles([await batchScan(new Uint8Array(covers.bytes))])
  await page.getByLabel('At cover sheets').check()
  await expect(page.locator('#preview li')).toHaveCount(4, { timeout: 60_000 })
  await noSidewaysScroll(page)
})
