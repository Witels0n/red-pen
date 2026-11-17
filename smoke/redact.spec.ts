import { createCanvas } from '@napi-rs/canvas'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fromPageSpace } from '../src/shared/pdf/page-geometry'
import { download, expectNetworkBlocked, trackRequests, type FixtureFile } from './pdf-fixtures'

const REDACT = '/red-pen/redact/'
const WIDTH = 595
const HEIGHT = 842

/** A two-page test: the learner's name at the top of page 1 and an answer on page 2. Made-up names only. */
async function test2Pages(name: string, file: string, rotation = 0): Promise<FixtureFile> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const first = doc.addPage([WIDTH, HEIGHT])
  first.drawText(`Name: ${name}`, { x: 100, y: 760, size: 14, font })
  first.drawText('Question 1. Explain photosynthesis.', { x: 100, y: 600, size: 12, font })
  if (rotation) first.setRotation(degrees(rotation))
  const second = doc.addPage([WIDTH, HEIGHT])
  second.drawText('Page two answer', { x: 100, y: 600, size: 12, font })
  return { name: file, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

/** How dark the displayed page is at a point (in points), 0 white to 1 black, rendered by pdf.js. */
async function darkness(bytes: Uint8Array, pageNumber: number, at: { x: number; y: number }): Promise<number> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const pdfPage = await doc.getPage(pageNumber)
  const viewport = pdfPage.getViewport({ scale: 1 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await pdfPage.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
  const [r, g, b] = canvas.getContext('2d').getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data
  return 1 - (r + g + b) / (3 * 255)
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    out.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '))
  }
  return out
}

/** Drag a box on page `pageIndex` from one displayed-page point to another (in points). */
async function drawBox(
  page: Page,
  pageIndex: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  displayedWidth = WIDTH,
): Promise<void> {
  const el = page.locator('.page').nth(pageIndex)
  await expect(el).toHaveAttribute('data-rendered', 'true')
  const r = (await el.boundingBox())!
  const s = r.width / displayedWidth
  await page.mouse.move(r.x + from.x * s, r.y + from.y * s)
  await page.mouse.down()
  await page.mouse.move(r.x + to.x * s, r.y + to.y * s, { steps: 6 })
  await page.mouse.up()
}

// "Name: ..." sits at x 100 to about 300, baseline 760 (82 from the top), 14 pt high.
const NAME_FROM = { x: 90, y: 60 }
const NAME_TO = { x: 340, y: 90 }

test('truly removes the text under a box, copies other pages as they are, and sends nothing anywhere', async ({
  page,
  baseURL,
}) => {
  const outside = trackRequests(page, baseURL!)
  await page.goto(REDACT)
  await expect(page.locator('#open-screen.paper h1')).toHaveText('Redact and anonymise')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await page.locator('#file-input').setInputFiles([await test2Pages('Sipho Dlamini', 'Dlamini Sipho.pdf')])
  await expect(page.locator('.true-redaction')).toContainText('gone from the file')
  await expect(page.locator('#download')).toBeDisabled()

  await drawBox(page, 0, NAME_FROM, NAME_TO)
  await expect(page.locator('.rbox.selected')).toHaveCount(1)
  await expect(page.locator('#delete')).toBeEnabled()
  await expect(page.locator('.file-to')).toHaveText('Learner 01.pdf, 2 pages')

  const out = await download(page, () => page.getByRole('button', { name: 'Download redacted PDF' }).click())
  expect(out.name).toBe('Learner 01.pdf')
  const bytes = new Uint8Array(out.bytes)
  const texts = await pageTexts(bytes)
  expect(texts).toHaveLength(2)
  expect(texts[0]).not.toContain('Sipho')
  expect(texts[0]).not.toContain('Dlamini')
  // The whole redacted page is now a picture, so none of its text survives.
  expect(texts[0]).not.toContain('Question')
  expect(texts[1]).toContain('Page two answer')
  const doc = await PDFDocument.load(bytes)
  expect(doc.getTitle()).toBe('Learner 01')
  expect(Math.round(doc.getPage(0).getWidth())).toBe(WIDTH)
  expect(await darkness(bytes, 1, { x: 150, y: HEIGHT - 765 })).toBeGreaterThan(0.9)
  expect(await darkness(bytes, 1, { x: 150, y: HEIGHT - 300 })).toBeLessThan(0.1)

  await expectNetworkBlocked(page)
  expect(outside).toEqual([])
})

test('redacts a turned page where the teacher sees the name', async ({ page }) => {
  await page.goto(REDACT)
  await page.locator('#file-input').setInputFiles([await test2Pages('Anele Khumalo', 'turned.pdf', 90)])
  // Where the name shows on the page as turned: from its PDF position to displayed units.
  const box = { x: 0, y: 0, width: WIDTH, height: HEIGHT }
  const a = fromPageSpace(box, 90, 90, 790)
  const b = fromPageSpace(box, 90, 340, 750)
  await drawBox(
    page,
    0,
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    HEIGHT,
  )
  const out = await download(page, () => page.locator('#download').click())
  const bytes = new Uint8Array(out.bytes)
  expect((await pageTexts(bytes))[0]).not.toContain('Khumalo')
  expect((await PDFDocument.load(bytes)).getPage(0).getRotation().angle).toBe(90)
  // The box is painted where the name was, and the rest of the page is still white.
  const name = fromPageSpace(box, 90, 150, 765)
  expect(await darkness(bytes, 1, name)).toBeGreaterThan(0.9)
  expect(await darkness(bytes, 1, fromPageSpace(box, 90, 500, 300))).toBeLessThan(0.1)
})

test('applies one layout to a class set, renames the files and gives a separate key', async ({ page }) => {
  await page.goto(REDACT)
  await page
    .locator('#file-input')
    .setInputFiles([
      await test2Pages('Anna Botha', 'Botha Anna.pdf'),
      await test2Pages('Sipho Dlamini', 'Dlamini Sipho.pdf'),
      await test2Pages('Priya Naidoo', 'Naidoo Priya.pdf'),
    ])
  await expect(page.locator('#file-list li')).toHaveCount(3)
  await page.getByLabel('Mix up the order').uncheck()

  await drawBox(page, 0, NAME_FROM, NAME_TO)
  await page.getByLabel('On every page').check()
  await page.getByLabel('Label', { exact: true }).check()
  await expect(page.locator('.rbox')).toHaveCount(2) // shown on both pages
  await expect(page.locator('.rbox-label').first()).toHaveText('Learner 01')

  // The same box shows on another file.
  await page.locator('#view-file').selectOption({ label: 'Naidoo Priya.pdf' })
  await expect(page.locator('#viewer[data-file="2"] .rbox')).toHaveCount(2)
  await expect(page.locator('.rbox-label').first()).toHaveText('Learner 03')

  const out = await download(page, () => page.getByRole('button', { name: 'Download .zip' }).click())
  expect(out.name).toBe('anonymised-pdfs.zip')
  const files = unzipSync(new Uint8Array(out.bytes))
  expect(Object.keys(files).sort()).toEqual(['Learner 01.pdf', 'Learner 02.pdf', 'Learner 03.pdf'])
  const second = await pageTexts(files['Learner 02.pdf'])
  expect(second.join(' ')).not.toContain('Dlamini')
  expect(second[0]).toContain('Learner 02') // the label is real text in the box
  expect(second[1]).not.toContain('Page two answer') // the box is on every page, so this page is a picture too

  const key = await download(page, () =>
    page.getByRole('button', { name: 'Download the anonymisation key (CSV)' }).click(),
  )
  expect(key.name).toBe('anonymised-key.csv')
  expect(key.bytes.toString('utf8').replace(/^﻿/, '')).toBe(
    [
      'Original file,Anonymised name,Anonymised file',
      'Botha Anna.pdf,Learner 01,Learner 01.pdf',
      'Dlamini Sipho.pdf,Learner 02,Learner 02.pdf',
      'Naidoo Priya.pdf,Learner 03,Learner 03.pdf',
      '',
    ].join('\r\n'),
  )
})

test('boxes can be moved, undone and deleted', async ({ page }) => {
  await page.goto(REDACT)
  await page.locator('#file-input').setInputFiles([await test2Pages('Anna Botha', 'a.pdf')])
  await drawBox(page, 0, { x: 100, y: 100 }, { x: 200, y: 150 })
  const rbox = page.locator('.rbox')
  const before = (await rbox.boundingBox())!
  await page.mouse.move(before.x + 10, before.y + 10)
  await page.mouse.down()
  await page.mouse.move(before.x + 60, before.y + 40, { steps: 4 })
  await page.mouse.up()
  const after = (await rbox.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(50, 0)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await rbox.boundingBox())!.x).toBeCloseTo(before.x, 0)
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(rbox).toHaveCount(0)
  await expect(page.locator('#download')).toBeDisabled()
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(REDACT)
  await page.locator('#file-input').setInputFiles([await test2Pages('Anna Botha', 'a.pdf')])
  await expect(page.locator('.page').first()).toHaveAttribute('data-rendered', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})
