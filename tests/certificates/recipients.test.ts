import { describe, expect, it } from 'vitest'
import { newClassList } from '../../src/shared/classes'
import { fromClassList, fromPasted, fromRows, withShared } from '../../src/certificates/recipients'
import { defaultSettings, longDate, productTemplates, readSettings } from '../../src/certificates/model'

describe('Recipient lists', () => {
  it('come from a Class list with Name, Learner ID and Class', () => {
    const list = newClassList('Grade 8A', 2, [{ id: '01', name: 'Thandi Mokoena' }, { id: '02' }])
    expect(fromClassList(list)).toEqual({
      fields: ['Name', 'Learner ID', 'Class'],
      recipients: [
        { Name: 'Thandi Mokoena', 'Learner ID': '01', Class: 'Grade 8A' },
        { Name: 'Learner 02', 'Learner ID': '02', Class: 'Grade 8A' },
      ],
    })
  })

  it('come from one name per line', () => {
    expect(fromPasted('Thandi Mokoena\n\nSipho Dlamini\n')).toEqual({
      fields: ['Name'],
      recipients: [{ Name: 'Thandi Mokoena' }, { Name: 'Sipho Dlamini' }],
    })
  })

  it('keep "Surname, First name" lines whole when the commas do not line up as columns', () => {
    expect(fromPasted('Mokoena, Thandi\nDlamini, Sipho\nPatel').recipients.map((r) => r.Name)).toEqual([
      'Mokoena, Thandi',
      'Dlamini, Sipho',
      'Patel',
    ])
  })

  it('come from rows pasted from a spreadsheet, with titles as merge fields', () => {
    const list = fromPasted('Name\tAward\tMark\nThandi Mokoena\tTop achiever\t92\nSipho Dlamini\t\t71')
    expect(list.fields).toEqual(['Name', 'Award', 'Mark'])
    expect(list.recipients[1]).toEqual({ Name: 'Sipho Dlamini', Award: '', Mark: '71' })
  })

  it('make a Name from first name and surname columns', () => {
    const list = fromRows([
      ['First name', 'Surname', 'Award'],
      ['Thandi', 'Mokoena', 'Gold'],
    ])
    expect(list.fields).toEqual(['Name', 'First name', 'Surname', 'Award'])
    expect(list.recipients[0].Name).toBe('Thandi Mokoena')
  })

  it('name untitled and repeated columns so every field is distinct', () => {
    const list = fromRows(
      [
        ['Name', 'Award', 'Award', ''],
        ['Ayesha Patel', 'Gold', 'Silver', 'x'],
      ],
      true,
    )
    expect(list.fields).toEqual(['Name', 'Award', 'Award 2', 'Column D'])
  })

  it('without titles, call the name column Name and the rest by letter', () => {
    const list = fromRows([['Thandi Mokoena', 'Gold']], false)
    expect(list.fields).toEqual(['Name', 'Column B'])
  })

  it('get shared fields such as Date unless a column already has them', () => {
    const list = withShared(fromPasted('Name\tDate\nMia\t1 June'), { Date: '17 November 2026', Class: '' })
    expect(list.fields).toEqual(['Name', 'Date', 'Class'])
    expect(list.recipients[0]).toEqual({ Name: 'Mia', Date: '1 June', Class: '' })
  })
})

describe('settings', () => {
  it('read back safely from storage', () => {
    expect(readSettings(null)).toEqual(defaultSettings())
    expect(readSettings('not json')).toEqual(defaultSettings())
    const saved = readSettings(
      JSON.stringify({ product: 'labels', theme: 'nope', certificate: { title: 'Merit', design: 'odd' } }),
    )
    expect(saved.product).toBe('labels')
    expect(saved.theme).toBe('navy')
    expect(saved.certificate.title).toBe('Merit')
    expect(saved.certificate.design).toBe('classic')
    expect(saved.certificate.signatories).toHaveLength(2)
  })

  it('list every template a product prints', () => {
    const s = defaultSettings()
    s.product = 'labels'
    expect(productTemplates(s)).toEqual(['{Name}', '{Class}'])
  })

  it('write dates in full', () => {
    expect(longDate('2026-11-17')).toBe('17 November 2026')
    expect(longDate('2026-01-05')).toBe('5 January 2026')
    expect(longDate('')).toBe('')
    expect(longDate('2026-13-01')).toBe('')
  })
})
