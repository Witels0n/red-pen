import { expect, test, type Page } from '@playwright/test'

const PICKER = '/red-pen/picker/'
const NAMES = ['Thandi Mokoena', 'Sipho Dlamini', 'Ayesha Patel', 'Lerato Nkosi', 'Pieter van Wyk', 'Zanele Khumalo']

async function pasteNames(page: Page, text: string): Promise<void> {
  await page.locator('.segmented label', { hasText: 'Paste names' }).click()
  await page.locator('#paste-text').fill(text)
  await page.locator('#use-paste').click()
}

async function spinOnce(page: Page): Promise<string> {
  await page.locator('#spin').click()
  await expect(page.locator('#reveal')).toBeVisible({ timeout: 10_000 })
  return (await page.locator('#reveal-name').textContent()) ?? ''
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

test.beforeEach(async ({ page }) => {
  // A short spin keeps the test quick; the maths is the same.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(PICKER)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
})

test('spins the wheel, removes picked learners, undoes and resets', async ({ page }) => {
  await expect(page).toHaveTitle('Class picker · Red Pen')
  await expect(page.locator('.site-header .tool-name')).toHaveText('Class picker')
  await pasteNames(page, NAMES.join('\n'))
  await expect(page.locator('#roster-summary')).toContainText('6 of 6 here')

  // Lerato is away today, so she is never on the wheel.
  await page.locator('.learner-row', { hasText: 'Lerato Nkosi' }).locator('input[type="checkbox"]').uncheck()
  await expect(page.locator('#roster-summary')).toContainText('5 of 6 here')
  await expect(page.locator('#wheel-count')).toHaveText('5 on the wheel')

  const first = await spinOnce(page)
  expect(NAMES).toContain(first)
  expect(first).not.toBe('Lerato Nkosi')
  await expect(page.locator('#reveal-note')).toHaveText('Comes off the wheel.')
  await page.locator('#reveal-close').click()
  await expect(page.locator('#wheel-count')).toHaveText('4 on the wheel (1 picked off)')
  await expect(page.locator('#history li')).toHaveText([first])

  // Undo puts them back.
  await page.locator('#undo').click()
  await expect(page.locator('#wheel-count')).toHaveText('5 on the wheel')
  await expect(page.locator('#no-history')).toBeVisible()

  // Everyone gets exactly one turn.
  const picked = new Set<string>()
  for (let i = 0; i < 5; i++) {
    picked.add(await spinOnce(page))
    await page.locator('#reveal-close').click()
  }
  expect(picked.size).toBe(5)
  expect(picked.has('Lerato Nkosi')).toBe(false)
  await expect(page.locator('#wheel-empty')).toContainText('Everyone has been picked')
  await expect(page.locator('#spin')).toBeDisabled()

  await page.locator('#reset').click()
  await expect(page.locator('#wheel-count')).toHaveText('5 on the wheel')

  // Keep in: the learner stays on the wheel.
  await page.locator('#default-after').selectOption('keep')
  await spinOnce(page)
  await expect(page.locator('#reveal-note')).toHaveText('Stays on the wheel.')
  await page.keyboard.press('Escape')
  await expect(page.locator('#wheel-count')).toHaveText('5 on the wheel')

  // Attendance is remembered for the session.
  await page.reload()
  await expect(page.locator('#roster-summary')).toContainText('5 of 6 here')
  await expect(page.locator('#history li')).toHaveCount(1)
})

test('a custom wheel is saved on the device', async ({ page }) => {
  await page.locator('#custom-wheels summary').click()
  await page.locator('#wheel-name').fill('Revision topics')
  await page.locator('#wheel-options').fill('Fractions\nDecimals\nPercentages')
  await page.locator('#save-wheel').click()
  await expect(page.locator('#wheel-select')).toHaveValue(/^w/)
  await expect(page.locator('#wheel-count')).toHaveText('3 on the wheel')
  expect(['Fractions', 'Decimals', 'Percentages']).toContain(await spinOnce(page))

  await page.reload()
  await expect(page.locator('#wheel-select option', { hasText: 'Revision topics' })).toHaveCount(1)
  const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])
  expect(keys.every((k) => k.startsWith('red-pen.picker.'))).toBe(true)
})

test('makes groups with rules, locks one and re-shuffles', async ({ page }) => {
  const levelled = ['Name\tLevel', ...NAMES.map((n, i) => `${n}\t${i % 2 ? 'B' : 'A'}`)].join('\n')
  await pasteNames(page, levelled)
  await page.locator('#tab-groups').click()
  await expect(page.locator('#groups-panel')).toBeVisible()

  await page.locator('#group-value').fill('2')
  await expect(page.locator('#group-preview')).toHaveText('6 learners here: 3 groups of 2.')
  await page.locator('#balance').check()

  // Thandi and Sipho must be apart.
  await page.locator('#rules summary').click()
  await page.locator('#rule-picker .chip', { hasText: 'Thandi Mokoena' }).click()
  await page.locator('#rule-picker .chip', { hasText: 'Sipho Dlamini' }).click()
  await page.locator('#add-apart').click()
  await expect(page.locator('#rule-list li')).toContainText('Keep apart: Thandi Mokoena, Sipho Dlamini')

  await page.locator('#make-groups').click()
  const cards = page.locator('#group-grid .group-card')
  await expect(cards).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    const text = await cards.nth(i).innerText()
    expect(text.includes('Thandi Mokoena') && text.includes('Sipho Dlamini')).toBe(false)
    // Balanced by level: one A and one B in each pair.
    expect((await cards.nth(i).locator('.members .tag').allTextContents()).sort()).toEqual(['A', 'B'])
  }

  // Lock the first group; re-shuffling keeps it.
  await cards.nth(0).locator('.lock').click()
  const lockedText = (await cards.nth(0).locator('.members').textContent()) ?? ''
  for (let i = 0; i < 3; i++) {
    await page.locator('#reshuffle').click()
    await expect(cards.nth(0).locator('.members')).toHaveText(lockedText)
  }

  await page.locator('#name-style').selectOption('colours')
  await expect(cards.nth(0).locator('h3')).toHaveText('Red')

  // An impossible rule gets a clear message.
  await cards.nth(0).locator('.lock').click()
  await expect(cards.nth(0).locator('.lock')).toHaveAttribute('aria-pressed', 'false')
  await page.locator('#rule-picker .chip', { hasText: 'Ayesha Patel' }).click()
  await page.locator('#rule-picker .chip', { hasText: 'Lerato Nkosi' }).click()
  await page.locator('#rule-picker .chip', { hasText: 'Pieter van Wyk' }).click()
  await page.locator('#rule-picker .chip', { hasText: 'Zanele Khumalo' }).click()
  await page.locator('#add-apart').click()
  await page.locator('#make-groups').click()
  await expect(page.locator('#group-error')).toContainText(
    'must be kept apart, which needs at least 4 groups, but there are only 3',
  )
})

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.reload()
  await page.locator('.segmented label', { hasText: 'Numbers' }).click()
  await page.locator('#numbers-count').fill('45')
  await page.locator('#use-numbers').click()
  await expect(page.locator('#wheel-count')).toHaveText('45 on the wheel')
  await noSidewaysScroll(page)
  const name = await spinOnce(page)
  expect(Number(name)).toBeGreaterThanOrEqual(1)
  expect(Number(name)).toBeLessThanOrEqual(45)
  await page.locator('#reveal-close').click()
  await page.locator('#tab-groups').click()
  await page.locator('#make-groups').click()
  await expect(page.locator('#group-grid .group-card')).toHaveCount(12)
  await noSidewaysScroll(page)
})
