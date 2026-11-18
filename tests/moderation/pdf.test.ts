import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Fonts } from '../../src/shared/pdf/layout'
import { J2_SECTIONS, commentKey, type Values } from '../../src/moderation/core/forms'
import { buildJ1 } from '../../src/moderation/pdf/j1'
import { buildJ2 } from '../../src/moderation/pdf/j2'
import { buildJ3 } from '../../src/moderation/pdf/j3'
import { fitted, measureRow, wrapText } from '../../src/moderation/pdf/kit'

async function fonts(): Promise<Fonts> {
  const doc = await PDFDocument.create()
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
}

async function pages(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => ({ width: Math.round(p.getWidth()), height: Math.round(p.getHeight()) }))
}

const text = (line: { pieces: { text: string }[] }) => line.pieces.map((p) => p.text).join('')
const LONG = 'The paper, the marking guideline and the grid were submitted together and agree on every question. '

describe('wrapText', () => {
  it('wraps to the width and keeps line breaks', async () => {
    const f = await fonts()
    const lines = wrapText(f, 'one two three four\n\nfive', 45, { size: 10 })
    expect(lines.map(text)).toEqual(['one two', 'three four', '', 'five'])
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(45)
  })

  it('keeps the space between plain and bold runs', async () => {
    const f = await fonts()
    const [line] = wrapText(f, 'Evidence of **HISTORY** of the task', 400, { size: 10, markup: true })
    expect(text(line!)).toBe('Evidence of HISTORY of the task')
    expect(line!.pieces.find((p) => p.text === 'HISTORY')!.font).toBe(f.bold)
    expect(line!.pieces.find((p) => p.text === 'Evidence')!.font).toBe(f.regular)
  })

  it('does not read asterisks a teacher typed as bold', async () => {
    const f = await fonts()
    const [line] = wrapText(f, '**see** Q3', 400, { size: 10 })
    expect(text(line!)).toBe('**see** Q3')
  })

  it('breaks a word that is wider than the line', async () => {
    const f = await fonts()
    const lines = wrapText(f, 'x'.repeat(60), 50, { size: 10 })
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.map(text).join('')).toBe('x'.repeat(60))
  })

  it('drops characters the standard fonts cannot draw instead of failing', async () => {
    const f = await fonts()
    expect(wrapText(f, 'Naïve 日本 ok', 400, { size: 10 }).map(text)).toEqual(['Naïve ok'])
  })
})

describe('fitted and measureRow', () => {
  it('shrinks one line of text, then cuts it short', async () => {
    const f = await fonts()
    expect(fitted(f, 'Short', 100, { size: 9 }).size).toBe(9)
    const tight = fitted(f, 'Lerato Nkosi-Mahlangu van der Merwe', 80, { size: 9, min: 6 })
    expect(tight.size).toBe(6)
    expect(text(tight.line).endsWith('...')).toBe(true)
    expect(tight.line.width).toBeLessThanOrEqual(80)
  })

  it('makes a row as tall as its longest cell', async () => {
    const f = await fonts()
    const short = measureRow(f, [{ width: 200, text: 'One line' }])
    const tall = measureRow(f, [
      { width: 200, text: 'One line' },
      { width: 200, text: LONG.repeat(3) },
    ])
    expect(tall).toBeGreaterThan(short * 3)
  })
})

describe('the forms as PDFs', () => {
  it('fits a blank J1 on one A4 page, and runs on when comments are long', async () => {
    expect(await pages(await buildJ1({}))).toEqual([{ width: 595, height: 842 }])
    const long: Values = { school: 'A school', meets: 'yes', decision: 'conditional', date: '2026-11-18' }
    for (let s = 0; s < 4; s++) for (let i = 0; i < 7; i++) long[commentKey(s, i)] = LONG.repeat(3)
    expect((await pages(await buildJ1(long))).length).toBeGreaterThan(1)
  })

  it('lays J2 out over three pages blank, and more as it fills', async () => {
    expect(await pages(await buildJ2({}))).toHaveLength(3)
    const full: Values = { level: 'district', good: LONG.repeat(4), 'p7.q': '4.1' }
    J2_SECTIONS.forEach((section, s) => section.rows.forEach((_, i) => (full[commentKey(s, i)] = LONG.repeat(4))))
    const out = await pages(await buildJ2(full))
    expect(out.length).toBeGreaterThan(3)
    expect(out.every((p) => p.width === 595 && p.height === 842)).toBe(true)
  })

  it('keeps J3 on one landscape page however much is typed', async () => {
    const full: Values = { subject: 'Information Technology', grade: '12', year: '2026' }
    for (let m = 1; m <= 6; m++) {
      full[`m${m}.task`] = 'A task with a very long name indeed, far longer than its box'
      full[`m${m}.date`] = '2026-05-14'
      full[`m${m}.comments`] = LONG.repeat(5)
      full[`m${m}.record`] = LONG.repeat(3)
      for (let l = 1; l <= 6; l++) {
        full[`m${m}.l${l}`] = 'Lerato Nkosi-Mahlangu van der Merwe'
        full[`m${m}.t${l}`] = '100'
        full[`m${m}.h${l}`] = '99'
      }
    }
    expect(await pages(await buildJ3(full))).toEqual([{ width: 842, height: 595 }])
    expect(await pages(await buildJ3({}))).toEqual([{ width: 842, height: 595 }])
  })

  it('ignores a logo it cannot read', async () => {
    expect(await pages(await buildJ1({}, 'data:image/png;base64,AAAA'))).toHaveLength(1)
  })
})
