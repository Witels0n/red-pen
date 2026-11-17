import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { PDFDocument, rgb } from 'pdf-lib'
import { TOOLS, groupTools } from '../src/landing/tools'

const HOME = '/red-pen/'
const MARK = '/red-pen/mark/'

async function fixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  page.drawRectangle({ x: 50, y: 700, width: 300, height: 80, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

function trackForeignRequests(page: Page, baseURL: string): string[] {
  const origin = new URL(baseURL).origin
  const foreign: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) foreign.push(r.url())
  })
  return foreign
}

/** Waits until the service worker has installed and precached the whole site. */
async function waitForOfflineReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (reg.active?.state !== 'activated') {
      await new Promise<void>((resolve) => reg.active!.addEventListener('statechange', () => resolve()))
    }
  })
}

test.describe('landing page', () => {
  test('lists the marker and links to it', async ({ page }) => {
    await page.goto(HOME)
    await expect(page).toHaveTitle('Red Pen')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Less admin, more teaching.')
    const card = page.locator('.tool-card', { hasText: 'Mark a test' })
    await expect(card).toBeVisible()
    await card.click()
    await expect(page).toHaveURL(new RegExp(`${MARK}$`))
    await expect(page.locator('#drop-zone')).toBeVisible()
  })

  test('only shows tool groups that have tools', async ({ page }) => {
    await page.goto(HOME)
    await expect(page.locator('.tool-group h3')).toHaveText(groupTools(TOOLS).map((g) => g.group))
  })

  test('explains privacy, install and how to give feedback', async ({ page }) => {
    await page.goto(HOME)
    await expect(page.locator('#privacy')).toContainText('Nothing is uploaded')
    await expect(page.locator('#privacy li')).toHaveCount(3)
    await expect(page.locator('#install-manual')).toBeVisible() // no install prompt in a test browser
    await expect(page.locator('#install-available')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Suggest a tool' })).toHaveAttribute('href', /github\.com\/Witels0n\/red-pen\/issues\/new/)
    await expect(page.getByRole('link', { name: 'Report a problem' })).toHaveAttribute('target', '_blank')
  })

  test('the shared header links home from a tool page', async ({ page }) => {
    await page.goto(MARK)
    await expect(page.locator('.site-header .tool-name')).toHaveText('Mark a test')
    await page.locator('.site-header .wordmark').click()
    await expect(page).toHaveURL(new RegExp(`${HOME}$`))
  })

  test('makes no request to another site and is refused any connection', async ({ page, baseURL }) => {
    const foreign = trackForeignRequests(page, baseURL!)
    await page.goto(HOME)
    await page.waitForLoadState('networkidle')
    expect(foreign).toEqual([])
    const result = await page.evaluate(() => fetch(location.href).then(() => 'allowed', () => 'blocked'))
    expect(result).toBe('blocked')
  })
})

test('settings saved on the old site carry over to the moved marker', async ({ page }) => {
  // The old /pdf-marker/ site was on the same origin, so its local storage is still there.
  await page.goto(HOME)
  await page.evaluate(() => localStorage.setItem('pdf-marker.reasons', JSON.stringify(['From the old site'])))
  await page.goto(MARK)
  await page.locator('#file-input').setInputFiles({ name: 't.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() })
  await expect(page.locator('.page')).toHaveCount(1)
  await page.locator('#edit-reasons').click()
  await expect(page.locator('#reasons-text')).toHaveValue('From the old site')
})

test.describe('offline', () => {
  let context: BrowserContext

  test.afterEach(async () => {
    await context?.setOffline(false)
  })

  test('after one visit, the landing page and the marker work with no connection', async ({ page }) => {
    context = page.context()
    await page.goto(HOME)
    await waitForOfflineReady(page)

    await context.setOffline(true)
    await page.reload()
    await expect(page.locator('.tool-card')).toHaveCount(TOOLS.length)

    await page.goto(MARK)
    await page.locator('#file-input').setInputFiles({ name: 'learner.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() })
    await expect(page.locator('.page[data-rendered="true"]')).toHaveCount(1)
    await page.locator('.page').first().click({ position: { x: 100, y: 100 } })
    await expect(page.locator('.annotation-tick')).toHaveCount(1)

    const download = page.waitForEvent('download')
    await page.locator('#export').click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  })
})
