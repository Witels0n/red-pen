import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { DESIGNS, defaultSettings, type Product } from '../../src/certificates/model'
import { combinedFileName, perLearnerFileNames, renderPdf } from '../../src/certificates/render'
import { testFonts } from './fonts'

const people = ['Thandi Mokoena', 'Bartholomew Montgomery-Featherstonehaugh', 'Zoë du Plessis'].map((Name) => ({
  Name,
  Class: 'Grade 8A',
  Date: '17 November 2026',
}))

async function sizes(product: Product, change: (s: ReturnType<typeof defaultSettings>) => void = () => {}) {
  const settings = defaultSettings()
  settings.product = product
  change(settings)
  const doc = await PDFDocument.load(await renderPdf({ settings, recipients: people, fonts: testFonts, pictures: {} }))
  return doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`)
}

describe('renderPdf', () => {
  it('draws every certificate design, a page per learner, in either orientation', async () => {
    for (const d of DESIGNS) {
      expect(await sizes('certificate', (s) => (s.certificate.design = d.id))).toEqual(Array(3).fill('842x595'))
    }
    expect(await sizes('certificate', (s) => (s.certificate.orientation = 'portrait'))).toEqual(
      Array(3).fill('595x842'),
    )
  })

  it('puts two desk cards, four slips or a sheet of labels on each A4 page', async () => {
    expect(await sizes('desk')).toEqual(['595x842', '595x842'])
    expect(await sizes('slips')).toEqual(['595x842'])
    expect(await sizes('labels')).toEqual(['595x842'])
    expect(await sizes('labels', (s) => ((s.labels.skip = 20), (s.labels.copies = 2)))).toEqual(['595x842', '595x842'])
    expect(await sizes('book')).toEqual(['595x842'])
  })

  it('names the files', () => {
    expect(combinedFileName('labels', 'Grade 8A')).toBe('Grade 8A name labels.pdf')
    expect(perLearnerFileNames([{ Name: 'Mia' }, { Name: 'mia' }, { Name: '' }])).toEqual([
      'Mia.pdf',
      'mia 2.pdf',
      'learner-3.pdf',
    ])
  })
})
