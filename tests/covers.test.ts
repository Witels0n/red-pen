import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { newClassList } from '../src/shared/classes'
import { renderCoverSheetsPdf } from '../src/shared/omr'
import { coverFileName, coverSpecs } from '../src/covers/covers'

const list = newClassList('Grade 8A', 2, [
  { id: '01', name: '  Thandi Mokoena ' },
  { id: '02' },
  { id: '03', name: 'Sipho Dlamini' },
])

describe('coverSpecs', () => {
  it('makes one Cover sheet per learner with the name, class and test title', () => {
    expect(coverSpecs(list, { title: ' Term 3 test ', subject: 'Natural Sciences', includeNames: true })).toEqual([
      {
        learnerId: '01',
        learnerName: 'Thandi Mokoena',
        className: 'Grade 8A · Natural Sciences',
        title: 'Term 3 test',
      },
      { learnerId: '02', className: 'Grade 8A · Natural Sciences', title: 'Term 3 test' },
      { learnerId: '03', learnerName: 'Sipho Dlamini', className: 'Grade 8A · Natural Sciences', title: 'Term 3 test' },
    ])
  })

  it('prints the Learner ID only when names are left out, and leaves the test line blank without a title', () => {
    const specs = coverSpecs(list, { title: '', subject: ' ', includeNames: false })
    expect(specs).toEqual([
      { learnerId: '01', className: 'Grade 8A' },
      { learnerId: '02', className: 'Grade 8A' },
      { learnerId: '03', className: 'Grade 8A' },
    ])
  })

  it('prints one A4 page per learner', async () => {
    const pdf = await renderCoverSheetsPdf(coverSpecs(list, { title: 'Test', subject: '', includeNames: true }))
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(3)
  })
})

describe('coverFileName', () => {
  it('names the PDF after the class, safely', () => {
    expect(coverFileName(list)).toBe('Grade 8A cover sheets.pdf')
    expect(coverFileName({ ...list, name: 'Gr 9: A/B' })).toBe('Gr 9 A B cover sheets.pdf')
  })
})
