import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'
import jsQR from 'jsqr'

const QR = '/red-pen/qr/'

/** A 64 by 64 PNG logo: a solid red square, made in the browser so no fixture file is needed. */
async function logoPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#d3212d'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(16, 16, 32, 32)
    return c.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/** Decodes a PNG with jsQR: the page turns it into pixels, Node does the decoding. */
async function decodePng(page: Page, png: Buffer): Promise<string | null> {
  const { width, height, pixels } = await page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let binary = ''
    for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
    return { width: c.width, height: c.height, pixels: btoa(binary) }
  }, `data:image/png;base64,${png.toString('base64')}`)
  const result = jsQR(new Uint8ClampedArray(Buffer.from(pixels, 'base64')), width, height)
  return result?.data ?? null
}

async function downloadPng(page: Page): Promise<{ download: Download; png: Buffer }> {
  const pending = page.waitForEvent('download')
  await page.locator('#download-png').click()
  const download = await pending
  return { download, png: readFileSync((await download.path())!) }
}

async function chooseType(page: Page, label: string): Promise<void> {
  await page.locator('.segmented label', { hasText: label }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto(QR)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // Smaller exports keep the decoding quick.
  await page.locator('#export-size').selectOption('512')
})

test('opens with an example link already in the preview', async ({ page }) => {
  await expect(page).toHaveTitle('QR codes · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('QR codes')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('QR codes')
  await expect(page.locator('#link-url')).toHaveValue('https://example.com')
  await expect(page.locator('#preview svg')).toBeVisible()
  await expect(page.locator('#payload-info')).toContainText('19 of 2331 bytes')
  const { png } = await downloadPng(page)
  expect(await decodePng(page, png)).toBe('https://example.com')
})

test('typing updates the preview and the file name', async ({ page }) => {
  const before = await page.locator('#preview').innerHTML()
  await page.locator('#link-url').fill('www.school.example/term-2')
  await expect.poll(() => page.locator('#preview').innerHTML()).not.toBe(before)
  const { download, png } = await downloadPng(page)
  expect(download.suggestedFilename()).toBe('qr-school-example-term-2.png')
  expect(await decodePng(page, png)).toBe('https://www.school.example/term-2')

  await page.locator('#link-url').fill('')
  await expect(page.locator('#preview-empty')).toHaveText('Type a web address to make a code.')
  await expect(page.locator('#download-png')).toBeDisabled()
})

test('a Wi-Fi code decodes to the escaped WIFI: payload', async ({ page }) => {
  await chooseType(page, 'Wi-Fi')
  await page.locator('#wifi-ssid').fill('Room 12; Staff')
  await page.locator('#wifi-password').fill('pa:ss"word')
  await page.locator('#wifi-hidden').check()
  const { download, png } = await downloadPng(page)
  expect(download.suggestedFilename()).toBe('qr-wifi-room-12-staff.png')
  expect(await decodePng(page, png)).toBe('WIFI:T:WPA;S:Room 12\\; Staff;P:pa\\:ss\\"word;H:true;;')
})

test('warns when the content is too long to encode', async ({ page }) => {
  await chooseType(page, 'Text')
  await page.locator('#text-body').fill('x'.repeat(2400))
  await expect(page.locator('#warnings')).toContainText('too long to encode')
  await expect(page.locator('#preview-empty')).toHaveText('Too long to fit in a QR code.')
  await page.locator('#ecl').selectOption('L')
  await expect(page.locator('#preview svg')).toBeVisible()
})

test('warns about colours that may not scan', async ({ page }) => {
  await page.locator('#swap-colours').click()
  await expect(page.locator('#warnings')).toContainText('lighter than the background')
})

test('a logo forces error correction H, and the code still scans with rounded and dot modules', async ({ page }) => {
  await page.locator('#ecl').selectOption('L')
  await page.locator('#logo-input').setInputFiles({ name: 'crest.png', mimeType: 'image/png', buffer: await logoPng(page) })
  await expect(page.locator('#preview svg image')).toHaveCount(1)
  await expect(page.locator('#ecl')).toHaveValue('H')
  await expect(page.locator('#ecl')).toBeDisabled()
  await expect(page.locator('#ecl-note')).toBeVisible()
  await page.locator('#logo-size').fill('0.22')

  for (const [shape, eyes] of [
    ['square', 'square'],
    ['rounded', 'rounded'],
    ['dots', 'rounded'],
  ]) {
    await page.locator('#module-shape').selectOption(shape)
    await page.locator('#eye-style').selectOption(eyes)
    const { png } = await downloadPng(page)
    expect(await decodePng(page, png), `${shape} modules with a logo`).toBe('https://example.com')
  }

  // The SVG carries the logo inline, so it works anywhere without the original file.
  const pending = page.waitForEvent('download')
  await page.locator('#download-svg').click()
  const svgDownload = await pending
  expect(svgDownload.suggestedFilename()).toBe('qr-example-com.svg')
  const svg = readFileSync((await svgDownload.path())!, 'utf8')
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  expect(svg).toContain('href="data:image/png;base64,')
  expect(svg).toContain('width="512" height="512"')

  await page.locator('#remove-logo').click()
  await expect(page.locator('#preview svg image')).toHaveCount(0)
  await expect(page.locator('#ecl')).toHaveValue('L')
  await expect(page.locator('#ecl')).toBeEnabled()
})

test('the SVG download decodes too', async ({ page }) => {
  await page.locator('#module-shape').selectOption('rounded')
  const pending = page.waitForEvent('download')
  await page.locator('#download-svg').click()
  const svg = readFileSync((await (await pending).path())!, 'utf8')
  const png = await page.evaluate(async (svgText) => {
    const img = new Image()
    img.src = `data:image/svg+xml;base64,${btoa(svgText)}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 512
    c.getContext('2d')!.drawImage(img, 0, 0, 512, 512)
    return c.toDataURL('image/png').split(',')[1]
  }, svg)
  expect(await decodePng(page, Buffer.from(png, 'base64'))).toBe('https://example.com')
})

test('remembers style settings across a reload, but not the content or logo', async ({ page }) => {
  await page.locator('#fg').fill('#1a4d2e')
  await page.locator('#module-shape').selectOption('dots')
  await page.locator('#eye-style').selectOption('rounded')
  await page.locator('#margin').fill('2')
  await page.locator('#link-url').fill('example.org/secret')
  await page.locator('#logo-input').setInputFiles({ name: 'crest.png', mimeType: 'image/png', buffer: await logoPng(page) })
  await expect(page.locator('#preview svg image')).toHaveCount(1)

  await page.reload()
  await expect(page.locator('#fg')).toHaveValue('#1a4d2e')
  await expect(page.locator('#module-shape')).toHaveValue('dots')
  await expect(page.locator('#eye-style')).toHaveValue('rounded')
  await expect(page.locator('#margin')).toHaveValue('2')
  await expect(page.locator('#export-size')).toHaveValue('512')
  await expect(page.locator('#link-url')).toHaveValue('https://example.com')
  await expect(page.locator('#preview svg image')).toHaveCount(0)
  const stored = await page.evaluate(() => Object.keys(localStorage))
  expect(stored.every((k) => k.startsWith('red-pen.qr.'))).toBe(true)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('secret')
})

test('makes no network requests while editing and exporting', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const requests: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url())
  })
  await page.goto(QR)
  await page.waitForLoadState('networkidle')
  const afterLoad = requests.length
  expect(requests.every((u) => new URL(u).origin === origin)).toBe(true)

  await chooseType(page, 'Contact')
  await page.locator('#contact-name').fill('Thandi Mokoena')
  await page.locator('#contact-org').fill('Hill School')
  await page.locator('#logo-input').setInputFiles({ name: 'crest.png', mimeType: 'image/png', buffer: await logoPng(page) })
  const { download } = await downloadPng(page)
  expect(download.suggestedFilename()).toBe('qr-thandi-mokoena.png')
  expect(requests.slice(afterLoad)).toEqual([])
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.reload()
  await expect(page.locator('#preview svg')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
})
