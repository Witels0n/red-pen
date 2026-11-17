import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { toPageSpace } from '../src/sign/geometry'

const SIGN = '/red-pen/sign/'

// ---- Fixtures, built in memory ----

/** A flat "scanned" form: printed labels, a line to write on, a text box and two tick boxes. */
async function scannedForm(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const black = rgb(0, 0, 0)
  page.drawText('Permission slip: Grade 7 trip to the Two Oceans Aquarium', { x: 60, y: 780, size: 14, font })
  page.drawText('Learner name:', { x: 60, y: 700, size: 12, font })
  page.drawLine({ start: { x: 150, y: 698 }, end: { x: 450, y: 698 }, thickness: 1, color: black })
  page.drawText('Medical notes:', { x: 60, y: 640, size: 12, font })
  page.drawRectangle({ x: 150, y: 600, width: 300, height: 50, borderWidth: 1, borderColor: black })
  page.drawRectangle({ x: 60, y: 540, width: 11, height: 11, borderWidth: 1, borderColor: black })
  page.drawText('I give permission', { x: 80, y: 541, size: 12, font })
  page.drawRectangle({ x: 260, y: 540, width: 11, height: 11, borderWidth: 1, borderColor: black })
  page.drawText('I do not give permission', { x: 280, y: 541, size: 12, font })
  return Buffer.from(await doc.save())
}

/** A real AcroForm with a text field, checkbox, dropdown and radio group. */
async function acroForm(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const form = doc.getForm()
  page.drawText('Name', { x: 60, y: 706, size: 12, font })
  form.createTextField('learner_name').addToPage(page, { x: 150, y: 700, width: 250, height: 22, font })
  form.createCheckBox('consent').addToPage(page, { x: 150, y: 650, width: 14, height: 14 })
  const grade = form.createDropdown('grade')
  grade.addOptions(['Grade 6', 'Grade 7'])
  grade.addToPage(page, { x: 150, y: 600, width: 120, height: 22, font })
  const trip = form.createRadioGroup('transport')
  trip.addOptionToPage('bus', page, { x: 150, y: 550, width: 14, height: 14 })
  trip.addOptionToPage('car', page, { x: 200, y: 550, width: 14, height: 14 })
  return Buffer.from(await doc.save())
}

/** Two pages; the second is turned a quarter and has a CropBox that does not start at 0,0. */
async function twoPages(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  const second = doc.addPage([600, 900])
  second.setCropBox(40, 30, 500, 800)
  second.setRotation(degrees(90))
  return Buffer.from(await doc.save())
}

async function encrypted(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard' })
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

// ---- Helpers ----

async function open(page: Page, buffer: Buffer, name = 'slip.pdf'): Promise<void> {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer })
  await expect(page.locator('#viewer[data-detection="done"]')).toBeVisible()
}

async function save(page: Page): Promise<{ name: string; bytes: Uint8Array }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()])
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile((await download.path())!)) }
}

async function pdfText(bytes: Uint8Array, pageNumber = 1) {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const content = await (await doc.getPage(pageNumber)).getTextContent()
  return content.items.flatMap((i) => ('str' in i ? [{ str: i.str, x: i.transform[4], y: i.transform[5] }] : []))
}

/** Centres (in PDF user space) of every image painted on a page. */
async function imageCentres(bytes: Uint8Array, pageNumber: number): Promise<{ x: number; y: number; width: number }[]> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const ops = await (await doc.getPage(pageNumber)).getOperatorList()
  type M = [number, number, number, number, number, number]
  let ctm: M = [1, 0, 0, 1, 0, 0]
  const stack: M[] = []
  const out: { x: number; y: number; width: number }[] = []
  const mul = (m: M, n: M): M => [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4],
    n[4] * m[1] + n[5] * m[3] + m[5],
  ]
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i] as M)
    else if (fn === OPS.paintImageXObject) {
      out.push({
        x: ctm[0] * 0.5 + ctm[2] * 0.5 + ctm[4],
        y: ctm[1] * 0.5 + ctm[3] * 0.5 + ctm[5],
        width: Math.hypot(ctm[0], ctm[1]),
      })
    }
  })
  return out
}

async function drawSignature(page: Page): Promise<void> {
  const pad = page.locator('#sig-pad')
  const box = (await pad.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 120)
  await page.mouse.down()
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + 120 - Math.sin(i / 2) * 40)
  await page.mouse.up()
}

// ---- Tests ----

test('the open screen explains privacy and rejects broken or encrypted files', async ({ page }) => {
  await page.goto(SIGN)
  await expect(page.locator('.site-header .tool-name')).toHaveText('Sign and fill')
  await expect(page.locator('#privacy-note')).toContainText('never uploaded')
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 nonsense') })
  await expect(page.locator('#open-error')).toContainText('damaged')
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: await encrypted() })
  await expect(page.locator('#open-error')).toContainText('password protected or encrypted')
  // Still usable.
  await open(page, await scannedForm())
  await expect(page.locator('.page')).toHaveCount(1)
})

test('detected boxes on a flat form can be clicked, filled in and saved', async ({ page }) => {
  await page.goto(SIGN)
  await open(page, await scannedForm())
  await expect(page.locator('.detected-line')).toHaveCount(1)
  await expect(page.locator('.detected-box')).toHaveCount(1)
  await expect(page.locator('.detected-tick')).toHaveCount(2)

  await page.locator('.detected-line').click({ force: true })
  await page.keyboard.type('Thandi Mokoena')
  await page.keyboard.press('Enter')
  await page.locator('.detected-box').click({ force: true })
  await page.keyboard.type('Allergic to peanuts')
  await page.keyboard.press('Enter')
  await page.locator('.detected-tick').first().click({ force: true })
  await expect(page.locator('.item-tick')).toHaveCount(1)
  await expect(page.locator('.item-text')).toHaveCount(2)

  // The toggle hides the outlines.
  await page.locator('#show-detected').uncheck()
  await expect(page.locator('.detected-line')).toBeHidden()
  await page.locator('#show-detected').check()

  // Undo and redo the tick.
  await page.locator('#viewer').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.item-tick')).toHaveCount(0)
  await page.keyboard.press('Control+y')
  await expect(page.locator('.item-tick')).toHaveCount(1)

  const out = await save(page)
  expect(out.name).toBe('slip-signed.pdf')
  const text = await pdfText(out.bytes)
  const name = text.find((t) => t.str === 'Thandi Mokoena')
  expect(name, 'typed name is in the saved PDF').toBeTruthy()
  // It sits on the line (drawn at y = 698), a little above it, to the right of the label.
  expect(name!.y).toBeGreaterThan(698)
  expect(name!.y).toBeLessThan(704)
  expect(name!.x).toBeGreaterThan(148)
  const notes = text.find((t) => t.str === 'Allergic to peanuts')
  expect(notes!.y).toBeGreaterThan(600)
  expect(notes!.y).toBeLessThan(650)
})

test('real form fields are filled and flattened', async ({ page }) => {
  await page.goto(SIGN)
  await open(page, await acroForm(), 'form.pdf')
  await expect(page.locator('.form-field')).toHaveCount(5)
  await page.locator('[data-field="learner_name"]').fill('Sipho Dlamini')
  await page.locator('[data-field="consent"]').check()
  await page.locator('[data-field="grade"]').selectOption('Grade 7')
  await page.locator('[data-field="transport"]').nth(1).check()

  const out = await save(page)
  expect(out.name).toBe('form-signed.pdf')
  const doc = await PDFDocument.load(out.bytes)
  expect(doc.getForm().getFields()).toHaveLength(0)
  const strings = (await pdfText(out.bytes)).map((t) => t.str)
  expect(strings).toContain('Sipho Dlamini')
  expect(strings).toContain('Grade 7')
})

test('a drawn signature is embedded on the right page, where it was placed, also on a rotated page', async ({
  page,
}) => {
  await page.goto(SIGN)
  await open(page, await twoPages(), 'letter.pdf')
  await page.locator('#tools [data-tool="signature"]').click()
  await expect(page.locator('#signature-dialog')).toBeVisible()
  await drawSignature(page)
  await page.locator('#sig-done').click()
  await expect(page.locator('#signature-dialog')).toHaveCount(0)

  const second = page.locator('.page').nth(1)
  await second.scrollIntoViewIfNeeded()
  const box = (await second.boundingBox())!
  const at = { x: box.width * 0.4, y: box.height * 0.3 }
  await second.click({ position: at })
  await expect(page.locator('.item-signature')).toHaveCount(1)

  const out = await save(page)
  expect(await imageCentres(out.bytes, 1)).toEqual([])
  const images = await imageCentres(out.bytes, 2)
  expect(images).toHaveLength(1)
  // The displayed page is 800 x 500 points (the 500 x 800 CropBox turned a quarter).
  const scale = box.width / 800
  const expected = toPageSpace({ x: 40, y: 30, width: 500, height: 800 }, 90, at.x / scale, at.y / scale)
  expect(Math.abs(images[0].x - expected.x)).toBeLessThan(4)
  expect(Math.abs(images[0].y - expected.y)).toBeLessThan(4)
  expect(images[0].width).toBeCloseTo(150, 0)
})

test('a signature is remembered after a reload only when the teacher ticks the box', async ({ page }) => {
  await page.goto(SIGN)
  await open(page, await scannedForm())

  // Not ticked: nothing stored.
  await page.locator('#tools [data-tool="signature"]').click()
  await expect(page.locator('#sig-remember')).not.toBeChecked()
  await drawSignature(page)
  await page.locator('#sig-done').click()
  await expect(page.locator('#signature-dialog')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('red-pen.sign.')))).toEqual([])
  await page.reload()
  await open(page, await scannedForm())
  await page.locator('#tools [data-tool="signature"]').click()
  await expect(page.locator('#sig-use-current')).toHaveCount(0)

  // Ticked: it survives a reload.
  await page.locator('#sig-remember').check()
  await drawSignature(page)
  await page.locator('#sig-done').click()
  await expect(page.locator('#signature-dialog')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('red-pen.sign.signature'))).toMatch(/^data:image\/png;base64,/)
  await page.reload()
  await open(page, await scannedForm())
  await page.locator('#tools [data-tool="signature"]').click()
  await expect(page.locator('#sig-use-current')).toBeVisible()

  // Forget removes it.
  await page.locator('#sig-forget').click()
  expect(await page.evaluate(() => localStorage.getItem('red-pen.sign.signature'))).toBeNull()
})

test('typed signature, date stamp and the unsaved-changes warning', async ({ page }) => {
  await page.goto(SIGN)
  await open(page, await scannedForm())
  await page.locator('#tools [data-tool="signature"]').click()
  await page.locator('#sig-tab-type').click()
  await page.locator('#sig-typed').fill('N. Pillay')
  await page.locator('#sig-done').click()
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 300, y: 600 } })
  await expect(page.locator('.item-signature')).toHaveCount(1)

  await page.locator('#date-style').selectOption('iso')
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 100, y: 700 } })
  const iso = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await expect(page.locator('.item-input')).toHaveValue(iso)

  const warned = page.waitForEvent('dialog').then(async (d) => {
    const isWarning = d.type() === 'beforeunload'
    await d.accept()
    return isWarning
  })
  await page.close({ runBeforeUnload: true })
  expect(await warned).toBe(true)
})

test('makes no network requests and is refused any connection', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const foreign: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) foreign.push(r.url())
  })
  await page.goto(SIGN)
  await open(page, await scannedForm())
  await page.locator('.detected-line').click({ force: true })
  await page.keyboard.type('Offline')
  await save(page)
  expect(foreign).toEqual([])
  expect(
    await page.evaluate(() =>
      fetch(location.href).then(
        () => 'allowed',
        () => 'blocked',
      ),
    ),
  ).toBe('blocked')
})

test('added items can be moved, resized and deleted, with undo', async ({ page }) => {
  await page.goto(SIGN)
  await open(page, await scannedForm())
  await page.locator('#tools [data-tool="tick"]').click()
  await page
    .locator('.page')
    .first()
    .click({ position: { x: 400, y: 450 } })
  const tick = page.locator('.item-tick')
  await expect(tick).toHaveCount(1)

  // Move.
  const before = (await tick.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  const moved = (await tick.boundingBox())!
  expect(Math.abs(moved.x - before.x - 60)).toBeLessThan(2)
  expect(Math.abs(moved.y - before.y - 40)).toBeLessThan(2)

  // Resize with the handle.
  const handle = (await tick.locator('.item-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 30, handle.y + 30, { steps: 5 })
  await page.mouse.up()
  expect((await tick.boundingBox())!.width).toBeGreaterThan(moved.width + 15)

  // Delete with the key, then undo brings it back.
  await page.keyboard.press('Delete')
  await expect(tick).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(tick).toHaveCount(1)
})
