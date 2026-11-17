import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, rgb } from 'pdf-lib'

// Builds a small fixture Test in memory: 3 pages, each with a solid black block so a
// rendered canvas is distinguishable from a blank one.
async function fixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842])
    page.drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  }
  return Buffer.from(await doc.save())
}

const pdfFile = async () => ({ name: 'learner-1.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() })

async function trackRequests(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  const bad: string[] = []
  page.on('request', (r) => {
    const url = r.url()
    if (!url.startsWith('http')) return // data: and blob: never leave the browser
    const foreign = new URL(url).origin !== origin
    if (foreign || r.method() !== 'GET' || r.postData()) bad.push(`${r.method()} ${url}`)
  })
  return bad
}

async function renderedCanvasHasInk(page: Page, index: number): Promise<boolean> {
  return page
    .locator('.page-canvas')
    .nth(index)
    .evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      for (let i = 0; i < data.length; i += 4) if (data[i] < 50 && data[i + 3] > 0) return true
      return false
    })
}

test('open screen states the privacy guarantee', async ({ page }) => {
  await page.goto('./')
  const note = page.locator('#privacy-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('not uploaded')
  await expect(note).toContainText('not stored on any server')
  await expect(note).toContainText('only in your browser')
})

test('opening a PDF via the file picker renders pages with no network request', async ({ page, baseURL }) => {
  const bad = await trackRequests(page, baseURL!)
  await page.goto('./')
  await page.waitForLoadState('networkidle')
  const blocked: string[] = []
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) blocked.push(m.text())
  })

  await page.locator('#file-input').setInputFiles(await pdfFile())

  await expect(page.locator('.page')).toHaveCount(3)
  await expect(page.locator('#file-name')).toHaveText('learner-1.pdf')
  await expect(page.locator('.page[data-rendered="true"]').first()).toBeVisible()
  expect(await renderedCanvasHasInk(page, 0)).toBe(true)
  await page.waitForLoadState('networkidle')

  expect(bad).toEqual([])
  expect(blocked).toEqual([])
})

test('opening a PDF by drag and drop works', async ({ page }) => {
  await page.goto('./')
  const file = await pdfFile()
  await page.evaluate(
    ({ name, type, bytes }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { name: file.name, type: file.mimeType, bytes: [...file.buffer] },
  )
  await expect(page.locator('.page')).toHaveCount(3)
})

test('pages fit the window width by default and zoom in and out', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto('./')
  await page.locator('#file-input').setInputFiles(await pdfFile())
  const first = page.locator('.page').first()
  await expect(first).toBeVisible()

  const width = async () => (await first.boundingBox())!.width
  const fit = await width()
  expect(fit).toBeCloseTo(1000 - 2 * 20 - 0, -1) // container minus gutters (scrollbar may take a few px)

  await page.locator('#zoom-in').click()
  const zoomedIn = await width()
  expect(zoomedIn).toBeGreaterThan(fit * 1.2)

  await page.locator('#zoom-out').click()
  await page.locator('#zoom-out').click()
  expect(await width()).toBeLessThan(fit)

  await page.locator('#zoom-fit').click()
  expect(await width()).toBeCloseTo(fit, 0)
  // The page still renders after zooming.
  await expect(page.locator('.page[data-rendered="true"]').first()).toBeVisible()
  expect(await renderedCanvasHasInk(page, 0)).toBe(true)
})

test('pages render on demand as they scroll into view', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 })
  await page.goto('./')
  await page.locator('#file-input').setInputFiles(await pdfFile())
  await expect(page.locator('.page[data-rendered="true"]').first()).toBeVisible()
  // Page 3 starts well beyond the viewport and the render margin.
  expect(await page.locator('.page').nth(2).getAttribute('data-rendered')).toBeNull()
  await page.locator('#viewer').evaluate((v) => (v.scrollTop = v.scrollHeight))
  await expect(page.locator('.page').nth(2)).toHaveAttribute('data-rendered', 'true')
})

test('a non-PDF file shows a clear error and leaves the app usable', async ({ page }) => {
  await page.goto('./')
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('just some text'),
  })
  await expect(page.locator('#open-error')).toContainText('not a PDF')
  await expect(page.locator('#open-screen')).toBeVisible()

  // Still usable: a real PDF opens afterwards and clears the error.
  await page.locator('#file-input').setInputFiles(await pdfFile())
  await expect(page.locator('.page')).toHaveCount(3)
  await expect(page.locator('#open-error')).toBeHidden()
})

test('a corrupt PDF shows an error, and an already open Test stays on screen', async ({ page }) => {
  await page.goto('./')
  await page.locator('#file-input').setInputFiles(await pdfFile())
  await expect(page.locator('.page')).toHaveCount(3)

  await page.locator('#file-input').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nthis is not really a pdf'),
  })
  await expect(page.locator('#viewer-error')).toContainText('broken.pdf')
  await expect(page.locator('.page')).toHaveCount(3)
  await expect(page.locator('#file-name')).toHaveText('learner-1.pdf')
})
