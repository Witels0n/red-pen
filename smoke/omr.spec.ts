import { expect, test } from '@playwright/test'
import type { HarnessCase } from './omr-harness/main'

// The real OMR worker on the production code, under the production CSP, through a test-only page
// that exists only in the smoke build (npm run build:smoke). See docs/omr.md.
const HARNESS = '/red-pen/smoke/omr-harness/'

const named: HarnessCase['spec'] = {
  assessmentCode: 'K7QM2X',
  title: 'Smoke test',
  version: 'B',
  identity: { mode: 'named-qr', learnerId: '0042', learnerName: 'Thandiwe Mokoena', idDigits: 4 },
  questions: Array.from({ length: 40 }, (_, i) => ({ options: [4, 5, 3, 2][i % 4] })),
}
const answers = named.questions.map((q, i) => (i % 9 === 4 ? null : (i * 7) % q.options))

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(HARNESS)
  await expect(page.locator('#status')).toHaveText('Ready')
  expect(errors).toEqual([])
})

test('reads a straight scan in the worker', async ({ page }) => {
  const read = await page.evaluate((c) => window.omrHarness.run(c), { spec: named, answers })
  expect(read.ok).toBe(true)
  expect(read.identity).toEqual({ learnerId: '0042', source: 'qr' })
  expect(read.version).toBe('B')
  expect(read.answers).toEqual(answers)
  expect(read.needsReview).toBe(false)
  console.log(`worker read, straight scan: ${Math.round(read.millis)} ms`)
})

test('reads an upside-down JPEG photo decoded like an upload', async ({ page }) => {
  const read = await page.evaluate((c) => window.omrHarness.run(c), { spec: named, answers, photoRotate: 183 })
  expect(read.ok, read.problems.join(' ')).toBe(true)
  expect(read.identity.learnerId).toBe('0042')
  expect(read.answers).toEqual(answers)
  console.log(`worker read, photo: ${Math.round(read.millis)} ms`)
})

test('reads a Bubbled ID sheet', async ({ page }) => {
  const spec: HarnessCase['spec'] = { ...named, identity: { mode: 'bubbled-id', idDigits: 3 } }
  const read = await page.evaluate((c) => window.omrHarness.run(c), { spec, answers, idDigits: '907', photoRotate: -4 })
  expect(read.identity).toEqual({ learnerId: '907', source: 'bubbles' })
  expect(read.answers).toEqual(answers)
})

test('identifies a Cover sheet', async ({ page }) => {
  const id = await page.evaluate(() => window.omrHarness.identifyCover('0315'))
  expect(id).toMatchObject({ ok: true, qr: { kind: 'cover', learnerId: '0315' } })
})
