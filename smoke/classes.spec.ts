import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import writeXlsxFile from 'write-excel-file/node'

const CLASSES = '/red-pen/classes/'

async function chooseMethod(page: Page, label: string): Promise<void> {
  await page.locator('.segmented label', { hasText: label }).click()
}

async function newClass(page: Page, name: string): Promise<void> {
  await page.goto(CLASSES)
  await page.locator('#new-class').click()
  await expect(page.locator('#new-view')).toBeVisible()
  await page.locator('#new-name').fill(name)
}

/** The Learner IDs and names on the edit screen, as "01 Thandi Mokoena" (or just "01"). */
async function learnerRows(page: Page): Promise<string[]> {
  return page.locator('#learner-list .learner-row').evaluateAll((rows) =>
    rows.map((r) => {
      const id = r.querySelector('.id')!.textContent
      const name = (r.querySelector('.learner-name') as HTMLInputElement).value
      return name ? `${id} ${name}` : id!
    }),
  )
}

async function previewRows(page: Page): Promise<string[]> {
  return page
    .locator('#preview-table tbody tr')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
}

function columnRow(page: Page, title: string) {
  return page.locator('#column-list .column', { hasText: title })
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

test('opens on the list of classes with the privacy note', async ({ page }) => {
  await page.goto(CLASSES)
  await expect(page).toHaveTitle('Class lists · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Class lists')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Class lists')
  await expect(page.locator('.intro-hint')).toContainText('✓')
  await expect(page.locator('.privacy-note')).toContainText('never uploaded')
  await expect(page.locator('.privacy-note')).toContainText('numbers instead of names')
  await expect(page.locator('#no-classes')).toBeVisible()
})

test('pasted names become a class that survives a reload', async ({ page }) => {
  await newClass(page, 'Grade 8A')
  await page.locator('#names-text').fill('Thandi Mokoena\n\n  Sipho   Dlamini \nAyesha\tPatel\n')
  await expect(page.locator('#preview-summary')).toHaveText('3 learners')
  expect(await previewRows(page)).toEqual(['01 Thandi Mokoena', '02 Sipho Dlamini', '03 Ayesha Patel'])
  await page.locator('#save-new').click()

  await expect(page.locator('#edit-view')).toBeVisible()
  await expect(page.locator('#edit-title')).toHaveText('Grade 8A')
  expect(await learnerRows(page)).toEqual(['01 Thandi Mokoena', '02 Sipho Dlamini', '03 Ayesha Patel'])

  await page.reload()
  expect(await learnerRows(page)).toEqual(['01 Thandi Mokoena', '02 Sipho Dlamini', '03 Ayesha Patel'])
  await page.locator('#edit-view .back a').click()
  await expect(page.locator('.class-card')).toHaveCount(1)
  await expect(page.locator('.class-card .meta')).toContainText('3 learners · 2-digit IDs · changed today')
})

test('a numbers-only class has IDs and no names', async ({ page }) => {
  await newClass(page, 'Grade 9 exam')
  await chooseMethod(page, 'Numbers only')
  await page.locator('#learner-count').fill('120')
  await expect(page.locator('#preview-summary')).toContainText('need more than 2-digit IDs')
  await expect(page.locator('#save-new')).toBeDisabled()
  await page.locator('#new-digits').selectOption('3')
  await expect(page.locator('#preview-summary')).toHaveText('120 learners')
  await page.locator('#learner-count').fill('25')
  await page.locator('#new-digits').selectOption('2')
  await expect(page.locator('#preview-summary')).toHaveText('25 learners')
  await page.locator('#save-new').click()

  await expect(page.locator('#edit-summary')).toHaveText('25 learners · 2-digit Learner IDs')
  const rows = await learnerRows(page)
  expect(rows[0]).toBe('01')
  expect(rows[24]).toBe('25')
})

test('imports a semicolon CSV, picking two name columns in order, with problems shown', async ({ page }) => {
  await newClass(page, '')
  await chooseMethod(page, 'Import CSV or Excel')
  const csv = 'Number;Surname;First name\r\n3;Mokoena;Thandi\r\n12;Dlamini;Sipho\r\n12;Patel;Ayesha\r\n'
  await page
    .locator('#sheet-input')
    .setInputFiles({ name: 'Grade 10B.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  await expect(page.locator('#import-options')).toBeVisible()
  await expect(page.locator('#new-name')).toHaveValue('Grade 10B')
  await expect(page.locator('#header-row')).toBeChecked()
  await expect(page.locator('#sheet-field')).toBeHidden()
  // The guess: first name, then surname, and the Number column as the Learner ID.
  await expect(page.locator('#preview-table tr.problem')).toHaveCount(1)
  await expect(page.locator('#preview-summary')).toContainText('1 row has a problem')
  await expect(page.locator('#preview-table tr.problem')).toContainText('Learner ID 12 is also on row 3')
  await expect(page.locator('#save-new')).toBeDisabled()

  // Number the learners instead, and make the name read Surname First name.
  await page.getByLabel('No ID column').check()
  await columnRow(page, 'First name').getByRole('checkbox').uncheck()
  await columnRow(page, 'First name').getByRole('checkbox').check()
  await expect(columnRow(page, 'Surname')).toContainText('(1st)')
  await expect(columnRow(page, 'First name')).toContainText('(2nd)')
  expect(await previewRows(page)).toEqual(['01 Mokoena Thandi', '02 Dlamini Sipho', '03 Patel Ayesha'])
  await expect(page.locator('#preview-table tr.problem')).toHaveCount(0)

  await page.locator('#save-new').click()
  await expect(page.locator('#edit-title')).toHaveText('Grade 10B')
  expect(await learnerRows(page)).toEqual(['01 Mokoena Thandi', '02 Dlamini Sipho', '03 Patel Ayesha'])
})

test('imports an Excel file, choosing the sheet, the name columns and the ID column', async ({ page }) => {
  const xlsx = await writeXlsxFile([
    { sheet: 'Staff', data: [['Teacher'], ['Mr Naidoo']] },
    {
      sheet: 'Grade 11C',
      data: [
        ['Gender', 'First name', 'Surname', 'Admission'],
        ['F', 'Lerato', 'Khumalo', 1043],
        ['M', 'Johan', 'van Wyk', 87],
        [null, null, null, null],
        ['F', 'Naledi', null, 1044],
      ],
    },
  ]).toBuffer()
  await newClass(page, '')
  await chooseMethod(page, 'Import CSV or Excel')
  await page.locator('#sheet-input').setInputFiles({
    name: 'school.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(xlsx),
  })
  await expect(page.locator('#sheet-field')).toBeVisible()
  await expect(page.locator('#new-name')).toHaveValue('Staff')
  await page.locator('#sheet-select').selectOption({ label: 'Grade 11C (5 rows)' })
  await expect(page.locator('#new-name')).toHaveValue('Grade 11C')

  await columnRow(page, 'First name').getByRole('checkbox').check()
  await columnRow(page, 'Surname').getByRole('checkbox').check()
  expect(await previewRows(page)).toEqual(['01 Lerato Khumalo', '02 Johan van Wyk', '03 Naledi'])

  await columnRow(page, 'Admission').getByRole('radio').check()
  await expect(page.locator('#preview-table tr.problem')).toHaveCount(2)
  await expect(page.locator('#preview-summary')).toContainText('2 rows have problems')
  await page.locator('#new-digits').selectOption('4')
  expect(await previewRows(page)).toEqual(['1043 Lerato Khumalo', '0087 Johan van Wyk', '1044 Naledi'])

  await page.locator('#save-new').click()
  await expect(page.locator('#edit-summary')).toHaveText('3 learners · 4-digit Learner IDs')
  expect(await learnerRows(page)).toEqual(['1043 Lerato Khumalo', '0087 Johan van Wyk', '1044 Naledi'])
})

test('explains a file it cannot read', async ({ page }) => {
  await newClass(page, '')
  await chooseMethod(page, 'Import CSV or Excel')
  await page.locator('#sheet-input').setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0]),
  })
  await expect(page.locator('#import-error')).toContainText('Old .xls files cannot be read')
  await expect(page.locator('#import-options')).toBeHidden()
})

test('edits a class: rename, add, remove and undo, reorder, sort, change ID digits', async ({ page }) => {
  await newClass(page, 'Grade 7')
  await page.locator('#names-text').fill('Zola\nAnele\nBongani')
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()

  await page.getByLabel('Name for Learner ID 02').fill('Anele Sithole')
  await page.getByLabel('Name for Learner ID 02').press('Enter')
  await expect(page.getByLabel('Name for Learner ID 03')).toBeFocused()

  await page.locator('#add-name').fill('Chris')
  await page.locator('#add-name').press('Enter')
  await page.locator('#add-learner').click() // a learner with no name
  expect(await learnerRows(page)).toEqual(['01 Zola', '02 Anele Sithole', '03 Bongani', '04 Chris', '05'])

  await page.getByRole('button', { name: 'Remove 03 Bongani' }).click()
  await expect(page.locator('#edit-status')).toContainText('Removed Bongani (03).')
  await page.locator('#edit-status').getByRole('button', { name: 'Undo' }).click()
  expect(await learnerRows(page)).toEqual(['01 Zola', '02 Anele Sithole', '03 Bongani', '04 Chris', '05'])
  await page.getByRole('button', { name: 'Remove 05' }).click()

  await page.getByRole('button', { name: 'Move 01 Zola down' }).click()
  await expect(page.getByRole('button', { name: 'Move 01 Zola down' })).toBeFocused()
  expect(await learnerRows(page)).toEqual(['02 Anele Sithole', '01 Zola', '03 Bongani', '04 Chris'])
  await page.locator('#sort-names').click()
  expect(await learnerRows(page)).toEqual(['02 Anele Sithole', '03 Bongani', '04 Chris', '01 Zola'])

  await page.locator('#edit-digits').selectOption('3')
  expect(await learnerRows(page)).toEqual(['002 Anele Sithole', '003 Bongani', '004 Chris', '001 Zola'])
  await expect(page.locator('#digits-warning')).toContainText('now have 3 digits')

  await page.locator('#edit-name').fill('Grade 7 Life Skills')
  await page.locator('#edit-name').blur()
  await expect(page.locator('#edit-title')).toHaveText('Grade 7 Life Skills')
  await expect(page.locator('#edit-status')).toHaveText('Saved.')

  await page.reload()
  await expect(page.locator('#edit-title')).toHaveText('Grade 7 Life Skills')
  expect(await learnerRows(page)).toEqual(['002 Anele Sithole', '003 Bongani', '004 Chris', '001 Zola'])
  await expect(page.locator('#edit-digits')).toHaveValue('3')
})

test('refuses fewer ID digits when an ID would not fit', async ({ page }) => {
  await newClass(page, 'Big class')
  await chooseMethod(page, 'Numbers only')
  await page.locator('#learner-count').fill('12')
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  await page.locator('#edit-digits').selectOption('1')
  await expect(page.locator('#digits-warning')).toContainText('Learner IDs 10, 11, 12 would not fit in 1 digit')
  await expect(page.locator('#edit-digits')).toHaveValue('2')
})

test('renames, duplicates, exports, imports and deletes classes from the list', async ({ page }) => {
  page.on('dialog', () => {
    throw new Error('The page must not use browser dialogs.')
  })
  await newClass(page, 'Grade 12A')
  await page.locator('#names-text').fill('Mokoena, Thandi\nSipho "Spoon" Dlamini')
  await page.locator('#new-digits').selectOption('3')
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  await page.locator('#edit-view .back a').click()

  await page.getByRole('button', { name: 'Rename Grade 12A' }).click()
  await page.getByLabel('New name for the class').fill('Grade 12A History')
  await page.getByLabel('New name for the class').press('Enter')
  await expect(page.locator('.class-name')).toHaveText(['Grade 12A History'])
  await expect(page.getByRole('button', { name: 'Rename Grade 12A History' })).toBeFocused()

  await page.getByRole('button', { name: 'Duplicate Grade 12A History' }).click()
  await expect(page.locator('.class-name')).toHaveText(['Grade 12A History (copy)', 'Grade 12A History'])

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV of Grade 12A History', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('Grade 12A History.csv')
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).toBe('﻿Learner ID,Name\r\n001,"Mokoena, Thandi"\r\n002,"Sipho ""Spoon"" Dlamini"\r\n')

  // Delete asks inside the page first.
  await page.getByRole('button', { name: 'Delete Grade 12A History (copy)' }).click()
  await expect(page.locator('.confirm')).toContainText('This cannot be undone.')
  await page.getByRole('button', { name: 'Keep Grade 12A History (copy)' }).click()
  await expect(page.locator('.class-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Delete Grade 12A History (copy)' }).click()
  await page.getByRole('button', { name: 'Yes, delete Grade 12A History (copy)' }).click()
  await expect(page.locator('.class-name')).toHaveText(['Grade 12A History'])
  await page.getByRole('button', { name: 'Delete Grade 12A History', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, delete Grade 12A History', exact: true }).click()
  await expect(page.locator('.class-card')).toHaveCount(0)
  await expect(page.locator('#no-classes')).toBeVisible()

  // The exported file brings the class back, IDs and all.
  await page
    .locator('#class-file-input')
    .setInputFiles({ name: 'Grade 12A History.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.locator('#edit-title')).toHaveText('Grade 12A History')
  await expect(page.locator('#edit-digits')).toHaveValue('3')
  expect(await learnerRows(page)).toEqual(['001 Mokoena, Thandi', '002 Sipho "Spoon" Dlamini'])

  await page.reload()
  await page.locator('#edit-view .back a').click()
  await expect(page.locator('.class-name')).toHaveText(['Grade 12A History'])
})

test('a file that is not a class file is refused with a reason', async ({ page }) => {
  await page.goto(CLASSES)
  await page
    .locator('#class-file-input')
    .setInputFiles({ name: 'marks.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Mark\nAnn,7\n') })
  await expect(page.locator('#home-error')).toContainText('the first column must be "Learner ID"')
  await expect(page.locator('.class-card')).toHaveCount(0)
})

test('makes no network requests beyond its own files', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const requests: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url())
  })
  await page.goto(CLASSES)
  await page.waitForLoadState('networkidle')
  const afterLoad = requests.length
  expect(requests.every((u) => new URL(u).origin === origin)).toBe(true)

  await page.locator('#new-class').click()
  await page.locator('#new-name').fill('Private class')
  await chooseMethod(page, 'Import CSV or Excel')
  const xlsx = await writeXlsxFile([['Name'], ['Thandi Mokoena']]).toBuffer()
  await page
    .locator('#sheet-input')
    .setInputFiles({ name: 'c.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(xlsx) })
  await expect(page.locator('#preview-summary')).toHaveText('1 learner')
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.locator('#export-csv').click()
  await pending

  // Only the lazily loaded Excel reader, from this site, may load after the page.
  const later = requests.slice(afterLoad)
  expect(later.every((u) => new URL(u).origin === origin && new URL(u).pathname.startsWith('/red-pen/assets/'))).toBe(
    true,
  )
  expect(later.join(' ')).not.toContain('Thandi')
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await newClass(page, 'A class with a rather long name for a small phone screen')
  await chooseMethod(page, 'Import CSV or Excel')
  const csv =
    'Learner number,First name,Surname,Home language,Gender\n1,Thandiwe Nomvula Precious,Mokoena-Hlongwane,isiZulu,F\n'
  await page.locator('#sheet-input').setInputFiles({ name: 'long.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.locator('#import-options')).toBeVisible()
  await noSidewaysScroll(page)
  await page.locator('#save-new').click()
  await expect(page.locator('#edit-view')).toBeVisible()
  await noSidewaysScroll(page)
  await page.locator('#edit-view .back a').click()
  await expect(page.locator('.class-card')).toHaveCount(1)
  await noSidewaysScroll(page)
})
