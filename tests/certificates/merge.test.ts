import { describe, expect, it } from 'vitest'
import { fieldKey, fillTemplate, parseTemplate, templateFields, unknownFields } from '../../src/certificates/merge'

const thandi = { Name: 'Thandi Mokoena', Award: 'Top achiever', 'Learner ID': '07', Subject: '' }

describe('fillTemplate', () => {
  it('fills in fields, ignoring case and spacing in the field name', () => {
    expect(fillTemplate('{Name} wins {award} ({ learner  id })', thandi)).toBe('Thandi Mokoena wins Top achiever (07)')
  })

  it('leaves a field no column has as typed, so a typo shows', () => {
    expect(fillTemplate('for {Awrd}', thandi)).toBe('for {Awrd}')
  })

  it('drops a blank field and tidies the spaces and punctuation around it', () => {
    expect(fillTemplate('for {Subject} excellence', thandi)).toBe('for excellence')
    expect(fillTemplate('Well done, {Subject}!', thandi)).toBe('Well done,!')
    expect(fillTemplate('{Subject}', thandi)).toBe('')
  })

  it('collapses runs of spaces and line breaks inside a value', () => {
    expect(fillTemplate('{Name}', { Name: '  Sipho \n  Dlamini ' })).toBe('Sipho Dlamini')
  })

  it('treats doubled braces as literal braces', () => {
    expect(fillTemplate('{{Name}} is {Name}', thandi)).toBe('{Name} is Thandi Mokoena')
    expect(fillTemplate('a }} b', thandi)).toBe('a } b')
  })

  it('keeps braces that do not make a field', () => {
    expect(fillTemplate('{ } and {open', thandi)).toBe('{ } and {open')
    expect(fillTemplate('{}', thandi)).toBe('{}')
  })

  it('does not fill values in again: a value with braces prints as it is', () => {
    expect(fillTemplate('{Name}', { Name: '{Award}', Award: 'x' })).toBe('{Award}')
  })

  it('keeps line breaks in the template', () => {
    expect(fillTemplate('{Name}\nGrade 8', thandi)).toBe('Thandi Mokoena\nGrade 8')
  })
})

describe('template fields', () => {
  it('lists each field once, in order', () => {
    expect(templateFields('{Name} {Award} {name} {{Not}}')).toEqual(['Name', 'Award'])
    expect(parseTemplate('Hi {Name}!')).toEqual([{ text: 'Hi ' }, { field: 'Name' }, { text: '!' }])
  })

  it('finds fields that no column provides', () => {
    expect(unknownFields(['{Name} {Mark}', '{AWARD} {Date}'], ['Name', 'Award'])).toEqual(['Mark', 'Date'])
    expect(fieldKey('  Learner   ID ')).toBe('learner id')
  })
})
