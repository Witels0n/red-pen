import { expect, test } from '@playwright/test'

test('page ships a CSP with connect-src none', async ({ page }) => {
  await page.goto('./')
  const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(content).toContain("connect-src 'none'")
})

test('browser refuses network requests from the page', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    try {
      await fetch(location.href)
      return 'allowed'
    } catch {
      return 'blocked'
    }
  })
  expect(result).toBe('blocked')
})

test('no request leaves the page to a third-party origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const foreign: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) foreign.push(r.url())
  })
  await page.goto('./')
  await page.waitForLoadState('networkidle')
  expect(foreign).toEqual([])
})
